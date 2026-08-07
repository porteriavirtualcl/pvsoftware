import React, { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Llamada de audio ENTRANTE desde la portería (kiosco) hacia el residente.
// El kiosco crea un doc en `calls` con la oferta WebRTC; aquí escuchamos las
// llamadas dirigidas a este usuario, mostramos un overlay para contestar y
// establecemos el audio bidireccional (WebRTC + señalización por Firestore).
// No-trickle: se espera a completar el gathering de ICE y se envía la SDP
// completa (con candidatos), para una señalización simple.
// ─────────────────────────────────────────────────────────────────────────────

// PILOTO: la llamada entrante SOLO se activa para estos residentes (evita
// cualquier impacto en el resto de usuarios de producción). Ampliar/quitar
// esta lista cuando se libere la función a todos.
const ENABLED_UIDS = ['MB17vqfRMohh6BSCntu4bBlX1jo1']; // pp@aa.cl (Depto 100)

// STUN sirve en la misma red; TURN es necesario para residentes en otra red
// (celular/casa) porque el NAT bloquea el P2P. (TURN público de prueba Open
// Relay; para producción conviene un TURN dedicado.)
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:2.24.85.59:3478', username: 'porteria', credential: 'PvTurn2026Kx9r' },
    { urls: 'turn:2.24.85.59:3478?transport=tcp', username: 'porteria', credential: 'PvTurn2026Kx9r' },
  ],

};

interface CallDoc {
  id: string;
  from?: string;
  fromName?: string;
  to?: string;
  status?: string;
  offerSdp?: string;
  offerType?: string;
  createdAt?: { toMillis?: () => number } | null;
}

function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, 3000); // fallback por si el gathering se demora
  });
}

export default function IncomingCall() {
  const { user } = useAuth();
  const [incoming, setIncoming] = useState<CallDoc | null>(null);
  const [inCall, setInCall] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);

  // Escuchar llamadas dirigidas a este usuario (solo filtro por `to` para no
  // requerir índice compuesto; el estado se filtra en el cliente).
  useEffect(() => {
    if (!user?.uid || !ENABLED_UIDS.includes(user.uid)) return;  // piloto: solo residentes habilitados
    const q = query(collection(db, 'calls'), where('to', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (pcRef.current) return; // ya estoy en una llamada
        const now = Date.now();
        const fresh = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CallDoc, 'id'>) }))
          .filter((c) => c.status === 'ringing' && !!c.offerSdp)
          .filter((c) => {
            const t = c.createdAt?.toMillis ? c.createdAt.toMillis() : 0;
            return !t || now - t < 60000; // solo llamadas recientes (< 60s)
          });
        setIncoming(fresh[0] || null);
      },
      () => {},
    );
    return () => unsub();
  }, [user?.uid]);

  const cleanup = useCallback(() => {
    try { pcRef.current?.close(); } catch { /* noop */ }
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setInCall(false);
    setConnecting(false);
    setMuted(false);
    callIdRef.current = null;
  }, []);

  const hangup = useCallback(async () => {
    const id = callIdRef.current;
    cleanup();
    setIncoming(null);
    if (id) {
      try { await updateDoc(doc(db, 'calls', id), { status: 'ended', endedBy: 'resident' }); } catch { /* noop */ }
    }
  }, [cleanup]);

  const reject = useCallback(async () => {
    const c = incoming;
    setIncoming(null);
    if (c) {
      try { await updateDoc(doc(db, 'calls', c.id), { status: 'rejected', endedBy: 'resident' }); } catch { /* noop */ }
    }
  }, [incoming]);

  const answer = useCallback(async () => {
    const c = incoming;
    if (!c || !c.offerSdp) return;
    setConnecting(true);
    callIdRef.current = c.id;
    try {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
          audioRef.current.play().catch(() => { /* autoplay */ });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') { setConnecting(false); setInCall(true); }
        else if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { hangup(); }
      };

      await pc.setRemoteDescription({ type: (c.offerType as RTCSdpType) || 'offer', sdp: c.offerSdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await waitIceComplete(pc);

      await updateDoc(doc(db, 'calls', c.id), {
        answerSdp: pc.localDescription?.sdp || '',
        answerType: pc.localDescription?.type || 'answer',
        status: 'answered',
      });
      setIncoming(null);
      setInCall(true);
      setConnecting(false);
    } catch (err) {
      console.error('Error al contestar la llamada:', err);
      cleanup();
      setIncoming(null);
    }
  }, [incoming, hangup, cleanup]);

  // Colgado remoto: escuchar el doc de la llamada activa.
  useEffect(() => {
    const id = callIdRef.current;
    if ((!inCall && !connecting) || !id) return;
    const unsub = onSnapshot(doc(db, 'calls', id), (snap) => {
      const st = (snap.data() as { status?: string } | undefined)?.status;
      if (st === 'ended' || st === 'rejected') hangup();
    });
    return () => unsub();
  }, [inCall, connecting, hangup]);

  const toggleMute = () => {
    const s = localStreamRef.current;
    if (!s) return;
    const nextMuted = !muted;
    s.getAudioTracks().forEach((t) => { t.enabled = !nextMuted; });
    setMuted(nextMuted);
  };

  // Audio siempre montado (para reproducir el remoto en cuanto llegue).
  const audioEl = <audio ref={audioRef} autoPlay hidden />;

  if (!incoming && !inCall && !connecting) return audioEl;

  const titulo = inCall ? 'En llamada' : connecting ? 'Conectando…' : 'Llamada entrante';

  return (
    <>
      {audioEl}
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl p-8 text-center">
          <div className={`w-20 h-20 mx-auto rounded-full bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 ${!inCall ? 'animate-pulse' : ''}`}>
            <Phone size={36} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-1">{titulo}</p>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">{incoming?.fromName || 'Portería'}</h2>

          {inCall ? (
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={toggleMute}
                aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
                className={`w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-colors ${muted ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10'}`}
              >
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <button
                onClick={hangup}
                aria-label="Colgar"
                className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg cursor-pointer"
              >
                <PhoneOff size={26} />
              </button>
            </div>
          ) : connecting ? (
            <button
              onClick={hangup}
              aria-label="Cancelar"
              className="w-16 h-16 mx-auto rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg cursor-pointer"
            >
              <PhoneOff size={26} />
            </button>
          ) : (
            <div className="flex items-center justify-center gap-8">
              <button onClick={reject} className="flex flex-col items-center gap-2 cursor-pointer">
                <span className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg"><PhoneOff size={26} /></span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Rechazar</span>
              </button>
              <button onClick={answer} className="flex flex-col items-center gap-2 cursor-pointer">
                <span className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg animate-bounce"><Phone size={26} /></span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Contestar</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
