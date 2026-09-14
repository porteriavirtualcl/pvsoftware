import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import { authedFetch } from '../lib/apiBase';
import { ICE_SERVERS, waitIceComplete, webrtcDisponible, pedirMicrofono } from '../lib/webrtc';

// ─────────────────────────────────────────────────────────────────────────────
// Llamadas por WhatsApp (Calling API de Meta) — estado global del operador.
//
// El servidor deja en `waCalls/{id}` la señalización (oferta/respuesta SDP y el
// estado) y este proveedor hace el WebRTC en el navegador:
//   entrante : Meta → webhook → waCalls 'ringing' → aquí suena → Contestar crea la
//              respuesta SDP → POST accept (pre_accept en Meta) → al conectar el
//              audio POST confirm (accept definitivo).
//   saliente : Llamar crea la oferta → POST conversations/:id/call → Meta timbra
//              al contacto → su respuesta SDP llega al doc → se aplica aquí.
// Se monta una sola vez (App) para que la llamada siga viva al cambiar de página.
// ─────────────────────────────────────────────────────────────────────────────

export interface WaCallDoc {
  id: string;
  waCallId?: string;
  waNumberId: string;
  conversationId?: string;
  contactPhone: string;
  contactName: string;
  condoName?: string;
  unit?: string;
  direction: 'inbound' | 'outbound';
  status: 'ringing' | 'connecting' | 'active' | 'calling' | 'ended' | 'missed' | 'rejected' | 'unanswered' | 'cancelled' | 'failed';
  offerSdp?: string;
  offerType?: string;
  answerSdp?: string;
  answerType?: string;
  acceptedBy?: { uid: string; name: string } | null;
  startedBy?: { uid: string; name: string } | null;
  startedAt?: Timestamp | null;
  endedAt?: Timestamp | null;
  duration?: number;
  finalizado?: boolean;
  ringingAt?: Timestamp | null;
  createdAt?: Timestamp | null;
}

export type WaCallPhase = 'idle' | 'connecting' | 'calling' | 'ringing' | 'active' | 'ended';

export interface StartCallResult { ok: boolean; error?: string; code?: number | null }

interface WaCallValue {
  /** Llamadas entrantes sonando en mis números (la primera es la que se muestra). */
  incoming: WaCallDoc[];
  /** La llamada que estoy atendiendo o haciendo. */
  current: WaCallDoc | null;
  phase: WaCallPhase;
  seconds: number;
  muted: boolean;
  busy: boolean;
  supported: boolean;
  error: string | null;
  ended: { status: string; duration: number; contactName: string } | null;
  answer: (call: WaCallDoc) => Promise<void>;
  reject: (call: WaCallDoc) => Promise<void>;
  hangup: () => Promise<void>;
  startCall: (conversationId: string) => Promise<StartCallResult>;
  toggleMute: () => void;
  dismissError: () => void;
  dismissEnded: () => void;
}

const STAFF_ROLES = ['super_admin', 'condo_admin', 'administrador', 'operator'];
const TERMINALES = new Set(['ended', 'missed', 'rejected', 'unanswered', 'cancelled', 'failed']);
const RING_MAX_MS = 90_000; // Meta corta la entrante si nadie contesta en 30-60 s

const noop = async () => {};
const WaCallContext = createContext<WaCallValue>({
  incoming: [], current: null, phase: 'idle', seconds: 0, muted: false, busy: false,
  supported: false, error: null, ended: null,
  answer: noop, reject: noop, hangup: noop,
  startCall: async () => ({ ok: false, error: 'No disponible' }),
  toggleMute: () => {}, dismissError: () => {}, dismissEnded: () => {},
});
export const useWaCall = () => useContext(WaCallContext);

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await authedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

// Tono de llamada sintetizado (sin archivos de audio): dos notas para la entrante,
// un tono largo intermitente para la saliente.
function useTono(kind: 'ring' | 'ringback' | null) {
  useEffect(() => {
    if (!kind) return;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    try { ctx = new Ctx(); } catch { return; }
    const beep = (freq: number, at: number, dur: number, gain = 0.08) => {
      if (!ctx) return;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.02);
      g.gain.setValueAtTime(gain, at + dur - 0.05); g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + dur);
    };
    const ciclo = () => {
      if (!ctx) return;
      const t = ctx.currentTime + 0.05;
      if (kind === 'ring') { beep(880, t, 0.35); beep(660, t + 0.45, 0.35); beep(880, t + 0.9, 0.35); beep(660, t + 1.35, 0.35); }
      else { beep(440, t, 1.0, 0.05); }
    };
    ciclo();
    timer = setInterval(ciclo, kind === 'ring' ? 3000 : 3500);
    return () => { if (timer) clearInterval(timer); try { ctx?.close(); } catch { /* noop */ } };
  }, [kind]);
}

export const WaCallProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, profile } = useAuth();
  const esStaff = !!profile && STAFF_ROLES.includes(profile.role);
  const supported = useMemo(() => webrtcDisponible(), []);

  const [allowedNumbers, setAllowedNumbers] = useState<Set<string> | null>(null); // null = todos
  const [ringing, setRinging] = useState<WaCallDoc[]>([]);
  const [current, setCurrent] = useState<WaCallDoc | null>(null);
  const [phase, setPhase] = useState<WaCallPhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<WaCallValue['ended']>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const answerAppliedRef = useRef(false);
  const confirmedRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const phaseRef = useRef<WaCallPhase>('idle');
  phaseRef.current = phase;

  // ── Números que puedo atender: asignados (operador) o todos (admins) ────────
  useEffect(() => {
    if (!esStaff || !user?.uid) { setAllowedNumbers(new Set()); return; }
    if (profile?.role === 'super_admin' || profile?.role === 'condo_admin') { setAllowedNumbers(null); return; }
    const unsub = onSnapshot(collection(db, 'waNumbers'), snap => {
      const ids = new Set<string>();
      snap.docs.forEach(d => {
        const n = d.data() as { assignedUsers?: { uid: string }[] };
        if ((n.assignedUsers || []).some(u => u.uid === user.uid)) ids.add(d.id);
      });
      setAllowedNumbers(ids);
    }, () => setAllowedNumbers(new Set()));
    return () => unsub();
  }, [esStaff, user?.uid, profile?.role]);

  // ── Llamadas entrantes sonando ──────────────────────────────────────────────
  useEffect(() => {
    if (!esStaff || !supported) { setRinging([]); return; }
    const q = query(collection(db, 'waCalls'), where('status', '==', 'ringing'));
    const unsub = onSnapshot(q, snap => {
      const now = Date.now();
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<WaCallDoc, 'id'>) }))
        .filter(c => c.direction === 'inbound' && !c.finalizado && !!c.offerSdp)
        .filter(c => { const t = c.ringingAt?.toMillis?.() || c.createdAt?.toMillis?.() || 0; return !t || now - t < RING_MAX_MS; })
        .sort((a, b) => (a.ringingAt?.toMillis?.() || 0) - (b.ringingAt?.toMillis?.() || 0));
      setRinging(list);
    }, err => console.warn('[WA-Call] listener waCalls:', err.message));
    return () => unsub();
  }, [esStaff, supported]);

  const incoming = useMemo(
    () => ringing.filter(c => allowedNumbers === null || allowedNumbers.has(c.waNumberId)),
    [ringing, allowedNumbers],
  );

  // ── Limpieza del WebRTC ─────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    try { pcRef.current?.close(); } catch { /* noop */ }
    pcRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    currentIdRef.current = null;
    answerAppliedRef.current = false;
    confirmedRef.current = false;
    startedAtRef.current = null;
    setMuted(false);
    setSeconds(0);
  }, []);

  const terminarLocal = useCallback((call: WaCallDoc | null, status: string) => {
    const dur = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : (call?.duration || 0);
    cleanup();
    setCurrent(null);
    setPhase('ended');
    setEnded({ status, duration: call?.duration || dur, contactName: call?.contactName || '' });
    setTimeout(() => setPhase(p => (p === 'ended' ? 'idle' : p)), 300);
  }, [cleanup]);

  // ── Crear el RTCPeerConnection con micrófono ────────────────────────────────
  const crearPc = useCallback(async () => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    const stream = await pedirMicrofono();
    streamRef.current = stream;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.ontrack = (e) => {
      if (audioRef.current) {
        audioRef.current.srcObject = e.streams[0];
        audioRef.current.play().catch(() => { /* autoplay: ya hubo gesto del usuario */ });
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        if (!startedAtRef.current) startedAtRef.current = Date.now();
        // Entrante: el audio ya fluye → accept definitivo en Meta.
        const id = currentIdRef.current;
        if (id && !confirmedRef.current && phaseRef.current === 'connecting') {
          confirmedRef.current = true;
          postJson(`/api/wa/calls/${id}/confirm`).catch(() => {});
        }
        setPhase(p => (p === 'connecting' || p === 'calling' || p === 'ringing') ? 'active' : p);
      } else if (st === 'failed' || st === 'closed') {
        if (currentIdRef.current) {
          const id = currentIdRef.current;
          postJson(`/api/wa/calls/${id}/terminate`).catch(() => {});
          terminarLocal(null, 'failed');
        }
      }
    };
    return pc;
  }, [terminarLocal]);

  // ── Contestar una entrante ──────────────────────────────────────────────────
  const answer = useCallback(async (call: WaCallDoc) => {
    if (busy || currentIdRef.current || !call.offerSdp) return;
    setBusy(true); setError(null); setEnded(null);
    try {
      const pc = await crearPc();
      await pc.setRemoteDescription({ type: (call.offerType as RTCSdpType) || 'offer', sdp: call.offerSdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await waitIceComplete(pc);
      const sdp = pc.localDescription?.sdp || '';
      const r = await postJson(`/api/wa/calls/${call.id}/accept`, { sdp });
      if (!r.ok) throw new Error(r.data?.error || 'No se pudo contestar la llamada');
      currentIdRef.current = call.id;
      setCurrent({ ...call, status: 'connecting' });
      setPhase('connecting');
    } catch (e: any) {
      cleanup();
      setError(e?.name === 'NotAllowedError' ? 'Debes permitir el micrófono para contestar.' : (e?.message || 'No se pudo contestar la llamada'));
    } finally { setBusy(false); }
  }, [busy, crearPc, cleanup]);

  // ── Rechazar una entrante ───────────────────────────────────────────────────
  const reject = useCallback(async (call: WaCallDoc) => {
    setError(null);
    const r = await postJson(`/api/wa/calls/${call.id}/reject`);
    if (!r.ok) setError(r.data?.error || 'No se pudo rechazar la llamada');
  }, []);

  // ── Llamar a un contacto ────────────────────────────────────────────────────
  const startCall = useCallback(async (conversationId: string): Promise<StartCallResult> => {
    if (busy || currentIdRef.current) return { ok: false, error: 'Ya hay una llamada en curso.' };
    setBusy(true); setError(null); setEnded(null);
    try {
      const pc = await crearPc();
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      const sdp = pc.localDescription?.sdp || '';
      const r = await postJson(`/api/wa/conversations/${conversationId}/call`, { sdp });
      if (!r.ok) { cleanup(); return { ok: false, error: r.data?.error || 'No se pudo iniciar la llamada', code: r.data?.code ?? null }; }
      currentIdRef.current = r.data.callId;
      setCurrent({ id: r.data.callId, waNumberId: '', contactPhone: '', contactName: '', direction: 'outbound', status: 'calling', conversationId });
      setPhase('calling');
      return { ok: true };
    } catch (e: any) {
      cleanup();
      const msg = e?.name === 'NotAllowedError' ? 'Debes permitir el micrófono para llamar.' : (e?.message || 'No se pudo iniciar la llamada');
      return { ok: false, error: msg };
    } finally { setBusy(false); }
  }, [busy, crearPc, cleanup]);

  // ── Colgar / cancelar ───────────────────────────────────────────────────────
  const hangup = useCallback(async () => {
    const id = currentIdRef.current;
    const call = current;
    const estado = phaseRef.current === 'active' ? 'ended' : (call?.direction === 'outbound' ? 'cancelled' : 'ended');
    terminarLocal(call, estado);
    if (id) await postJson(`/api/wa/calls/${id}/terminate`).catch(() => {});
  }, [current, terminarLocal]);

  const toggleMute = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    const next = !muted;
    s.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
  }, [muted]);

  // ── Seguir el doc de la llamada actual ──────────────────────────────────────
  useEffect(() => {
    const id = current?.id;
    if (!id) return;
    const unsub = onSnapshot(doc(db, 'waCalls', id), async (snap) => {
      if (!snap.exists()) return;
      const d = { id: snap.id, ...(snap.data() as Omit<WaCallDoc, 'id'>) };
      setCurrent(prev => (prev && prev.id === d.id ? { ...prev, ...d } : prev));
      const pc = pcRef.current;
      if (currentIdRef.current !== d.id) return;

      // Saliente: llegó la respuesta SDP del contacto → aplicarla una vez.
      if (d.direction === 'outbound' && d.answerSdp && pc && !answerAppliedRef.current && pc.signalingState === 'have-local-offer') {
        answerAppliedRef.current = true;
        try { await pc.setRemoteDescription({ type: (d.answerType as RTCSdpType) || 'answer', sdp: d.answerSdp }); }
        catch (e: any) { console.warn('[WA-Call] setRemoteDescription:', e.message); }
      }
      if (d.status === 'ringing' && d.direction === 'outbound') setPhase(p => (p === 'calling' ? 'ringing' : p));
      if (d.status === 'connecting' && d.direction === 'outbound') setPhase(p => (p === 'calling' || p === 'ringing') ? 'connecting' : p);
      if (d.status === 'active') {
        if (!startedAtRef.current) startedAtRef.current = d.startedAt?.toMillis?.() || Date.now();
        setPhase(p => (p === 'ended' || p === 'idle') ? p : 'active');
      }
      // Entrante: otro operador la tomó (no debería pasar por la transacción, pero por si acaso).
      if (d.direction === 'inbound' && d.acceptedBy && user?.uid && d.acceptedBy.uid !== user.uid && d.status !== 'rejected') {
        terminarLocal(d, 'taken');
        return;
      }
      if (d.finalizado || TERMINALES.has(d.status)) terminarLocal(d, d.status);
    }, err => console.warn('[WA-Call] listener llamada:', err.message));
    return () => unsub();
  }, [current?.id, user?.uid, terminarLocal]);

  // ── Cronómetro ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active') return;
    const t = setInterval(() => {
      if (startedAtRef.current) setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(t);
  }, [phase]);

  // ── Tonos ───────────────────────────────────────────────────────────────────
  useTono(
    phase === 'idle' && incoming.length > 0 ? 'ring'
    : (phase === 'calling' || phase === 'ringing') ? 'ringback'
    : null,
  );

  // Si la llamada que sonaba la tomó otro / se cortó, el panel se cierra solo por el listener.
  useEffect(() => () => cleanup(), [cleanup]);

  const value = useMemo<WaCallValue>(() => ({
    incoming, current, phase, seconds, muted, busy, supported, error, ended,
    answer, reject, hangup, startCall, toggleMute,
    dismissError: () => setError(null),
    dismissEnded: () => setEnded(null),
  }), [incoming, current, phase, seconds, muted, busy, supported, error, ended, answer, reject, hangup, startCall, toggleMute]);

  return (
    <WaCallContext.Provider value={value}>
      {children}
      {/* Audio remoto siempre montado para reproducir apenas llegue la pista. */}
      <audio ref={audioRef} autoPlay hidden />
    </WaCallContext.Provider>
  );
};
