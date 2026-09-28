import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, DoorOpen, Search, RefreshCw, History, Volume2 } from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { authedFetch, api } from '../lib/apiBase';
import { Button, PageHeader, Badge, Input, EmptyState, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

/*
 * Intercomunicador (sólo super_admin por ahora).
 * Conversación bidireccional con controladores faciales Dahua a través del servidor y el DSS.
 * Audio por WebSocket: se envía el micrófono en PCM16 LE 8 kHz y se recibe el del equipo en PCM16 LE 16 kHz.
 */

interface Equipo { deviceCode: string; name: string; model: string; online: boolean; prefix: string | null; enUso: boolean }
interface Llamada { id: string; deviceCode: string; deviceName: string; by?: { name?: string; email?: string }; startedAt: number | null; durationS?: number; endReason?: string }
type Estado = 'idle' | 'connecting' | 'connected' | 'ended' | 'error';

function wsUrl(): string {
  const u = api('/ws/intercom');
  if (/^https?:\/\//.test(u)) return u.replace(/^http/, 'ws');
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${u}`;
}
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const Intercom: React.FC = () => {
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [llamadas, setLlamadas] = useState<Llamada[]>([]);
  const [activo, setActivo] = useState<Equipo | null>(null);
  const [estado, setEstado] = useState<Estado>('idle');
  const [mensaje, setMensaje] = useState('');
  const [mute, setMute] = useState(false);
  const [nivelMic, setNivelMic] = useState(0);
  const [nivelEquipo, setNivelEquipo] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const [abriendo, setAbriendo] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const playheadRef = useRef(0);
  const muteRef = useRef(false);
  const t0Ref = useRef(0);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [d, c] = await Promise.all([
        authedFetch('/api/intercom/devices').then(r => r.json()),
        authedFetch('/api/intercom/calls').then(r => r.json()),
      ]);
      setEquipos(d.devices || []); setLlamadas(c.calls || []);
    } catch { /* */ } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { muteRef.current = mute; }, [mute]);
  useEffect(() => {
    if (estado !== 'connected') return;
    const t = setInterval(() => setSegundos(Math.round((Date.now() - t0Ref.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [estado]);

  const limpiarAudio = useCallback(() => {
    try { procRef.current?.disconnect(); } catch { /* */ }
    streamRef.current?.getTracks().forEach(t => t.stop());
    try { ctxRef.current?.close(); } catch { /* */ }
    procRef.current = null; streamRef.current = null; ctxRef.current = null;
    setNivelMic(0); setNivelEquipo(0);
  }, []);

  const colgar = useCallback((razon?: string) => {
    const ws = wsRef.current; wsRef.current = null;
    if (ws) { try { ws.readyState === 1 && ws.send(JSON.stringify({ type: 'hangup' })); ws.close(); } catch { /* */ } }
    limpiarAudio();
    setEstado(e => (e === 'error' ? e : 'ended'));
    if (razon) setMensaje(razon);
    setTimeout(cargar, 1500);
  }, [limpiarAudio, cargar]);
  useEffect(() => () => { colgar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const llamar = async (eq: Equipo) => {
    if (wsRef.current) return;
    setActivo(eq); setEstado('connecting'); setMensaje('Pidiendo el micrófono…'); setSegundos(0); setMute(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setEstado('error'); setMensaje('El navegador no dio acceso al micrófono.'); return;
    }
    const ctx = new AudioContext();
    streamRef.current = stream; ctxRef.current = ctx; playheadRef.current = 0;
    const idToken = await getAuth().currentUser?.getIdToken();
    const ws = new WebSocket(wsUrl()); ws.binaryType = 'arraybuffer'; wsRef.current = ws;
    setMensaje('Conectando con el equipo… (puede tardar ~15 s)');

    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', idToken, deviceCode: eq.deviceCode, deviceName: eq.name }));
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let m: any; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'connected') {
          setEstado('connected'); setMensaje('En conversación'); t0Ref.current = Date.now();
          // Micrófono → servidor (PCM16 8 kHz, bloques de ~20-40 ms).
          const src = ctx.createMediaStreamSource(stream);
          const proc = ctx.createScriptProcessor(2048, 1, 1); procRef.current = proc;
          const ratio = ctx.sampleRate / 8000;
          proc.onaudioprocess = (e) => {
            const inp = e.inputBuffer.getChannelData(0);
            let peak = 0; for (let i = 0; i < inp.length; i += 16) peak = Math.max(peak, Math.abs(inp[i]));
            setNivelMic(muteRef.current ? 0 : peak);
            if (muteRef.current || ws.readyState !== 1) return;
            const n = Math.floor(inp.length / ratio); const out = new Int16Array(n);
            for (let i = 0; i < n; i++) {
              const a = Math.floor(i * ratio), b = Math.min(inp.length, Math.floor((i + 1) * ratio));
              let s = 0; for (let k = a; k < b; k++) s += inp[k];
              out[i] = Math.max(-32768, Math.min(32767, Math.round((s / Math.max(1, b - a)) * 32767)));
            }
            ws.send(out.buffer);
          };
          const mudo = ctx.createGain(); mudo.gain.value = 0;
          src.connect(proc); proc.connect(mudo); mudo.connect(ctx.destination);
        } else if (m.type === 'connecting') setMensaje('Abriendo audio con el equipo…');
        else if (m.type === 'error') { setEstado('error'); setMensaje(m.error || 'Error'); }
        else if (m.type === 'ended') { colgar(m.reason ? `Conversación terminada: ${m.reason}` : undefined); }
        return;
      }
      // Audio del equipo: PCM16 LE 16 kHz.
      const pcm = new Int16Array(ev.data as ArrayBuffer); if (!pcm.length) return;
      const buf = ctx.createBuffer(1, pcm.length, 16000); const ch = buf.getChannelData(0);
      let peak = 0; for (let i = 0; i < pcm.length; i++) { ch[i] = pcm[i] / 32768; if (i % 16 === 0) peak = Math.max(peak, Math.abs(ch[i])); }
      setNivelEquipo(peak);
      const now = ctx.currentTime;
      if (playheadRef.current < now + 0.04 || playheadRef.current > now + 0.6) playheadRef.current = now + 0.08; // re-sincroniza si se atrasa o acumula
      const node = ctx.createBufferSource(); node.buffer = buf; node.connect(ctx.destination); node.start(playheadRef.current);
      playheadRef.current += buf.duration;
    };
    ws.onclose = () => { if (wsRef.current === ws) colgar(); };
    ws.onerror = () => { setEstado('error'); setMensaje('Se perdió la conexión con el servidor.'); };
  };

  const abrirPuerta = async () => {
    if (!activo) return;
    if (!window.confirm(`¿Abrir la puerta de ${activo.name}?`)) return;
    setAbriendo(true);
    try {
      const r = await authedFetch('/api/door/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: `${activo.deviceCode}$7$0$0` }) });
      const d = await r.json().catch(() => ({}));
      setMensaje(r.ok && d.ok ? 'Puerta abierta' : `No se pudo abrir: ${d.error || r.status}`);
    } catch { setMensaje('No se pudo abrir la puerta'); } finally { setAbriendo(false); }
  };

  const lista = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return equipos.filter(e => !f || e.name.toLowerCase().includes(f) || e.deviceCode.includes(f));
  }, [equipos, filtro]);

  const enLlamada = estado === 'connecting' || estado === 'connected';

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader eyebrow="Prueba · sólo super administrador" title="Intercomunicador" icon={Phone}
        description="Conversación en vivo con los controladores faciales a través del DSS."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={cargar} disabled={cargando}>Actualizar</Button>} />

      {activo && estado !== 'idle' && (
        <div className={cn('rounded-2xl border p-5 mb-6', estado === 'connected' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30'
          : estado === 'error' ? 'border-red-300 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30' : 'border-slate-200 bg-white dark:bg-white/5 dark:border-white/10')}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wide text-slate-500">{activo.model} · {activo.deviceCode}</p>
              <p className="text-lg font-bold truncate">{activo.name}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                {estado === 'connecting' && <Spinner size={14} />}{mensaje}{estado === 'connected' && <span className="font-mono">· {fmtDur(segundos)}</span>}
              </p>
              {estado === 'connected' && (
                <div className="mt-3 grid grid-cols-2 gap-3 max-w-md">
                  <Nivel icon={Mic} label="Tu voz" valor={nivelMic} />
                  <Nivel icon={Volume2} label="Equipo" valor={nivelEquipo} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {estado === 'connected' && <Button variant="secondary" icon={mute ? MicOff : Mic} onClick={() => setMute(m => !m)}>{mute ? 'Activar micrófono' : 'Silenciar'}</Button>}
              {estado === 'connected' && <Button variant="secondary" icon={DoorOpen} loading={abriendo} onClick={abrirPuerta}>Abrir puerta</Button>}
              {enLlamada
                ? <Button variant="danger" icon={PhoneOff} onClick={() => colgar('Colgaste la llamada')}>Colgar</Button>
                : <Button variant="secondary" onClick={() => { setActivo(null); setEstado('idle'); setMensaje(''); }}>Cerrar</Button>}
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2">
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar equipo (ej. MB_, EV_, Prueba)" className="pl-9" />
          </div>
          {cargando ? <div className="py-10 flex justify-center"><Spinner /></div>
            : lista.length === 0 ? <EmptyState icon={Phone} title="Sin equipos" description="No se encontraron controladores con audio en el DSS." />
            : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] overflow-hidden">
                {lista.map(e => (
                  <li key={e.deviceCode} className="flex items-center gap-3 px-4 py-3">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', e.online ? 'bg-emerald-500' : 'bg-slate-300')} title={e.online ? 'En línea' : 'Desconectado'} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{e.name}</p>
                      <p className="text-xs text-slate-500">{e.model} · {e.deviceCode}</p>
                    </div>
                    {e.enUso && <Badge variant="warn">En uso</Badge>}
                    {!e.online && <Badge>Desconectado</Badge>}
                    <Button size="sm" icon={Phone} disabled={!e.online || enLlamada || e.enUso} onClick={() => llamar(e)}>Hablar</Button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <aside>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><History size={15} /> Últimas conversaciones</h2>
          {llamadas.length === 0 ? <p className="text-sm text-slate-500">Aún no hay conversaciones.</p> : (
            <ul className="space-y-2">
              {llamadas.map(c => (
                <li key={c.id} className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-sm">
                  <p className="font-medium truncate">{c.deviceName || c.deviceCode}</p>
                  <p className="text-xs text-slate-500">
                    {c.startedAt ? new Date(c.startedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    {typeof c.durationS === 'number' ? ` · ${fmtDur(c.durationS)}` : ' · en curso'} · {c.by?.name || c.by?.email || ''}
                  </p>
                  {c.endReason && <p className="text-[11px] text-slate-400 truncate">{c.endReason}</p>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
};

function Nivel({ icon: Icon, label, valor }: { icon: typeof Mic; label: string; valor: number }) {
  return (
    <div>
      <p className="text-xs text-slate-500 flex items-center gap-1 mb-1"><Icon size={12} /> {label}</p>
      <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(valor * 140))}%` }} />
      </div>
    </div>
  );
}

export default Intercom;
