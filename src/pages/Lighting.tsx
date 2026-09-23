import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit, Timestamp } from 'firebase/firestore';
import { motion } from 'motion/react';
import {
  Lightbulb, Power, AlertTriangle, WifiOff, RefreshCw, Settings2, ShieldAlert, Zap,
  Building2, Check, History, ChevronDown, ChevronUp, Thermometer, Clock, Eye,
} from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLightingAlert } from '../hooks/lightingAlert';
import { authedFetch } from '../lib/apiBase';
import { Button, PageHeader, Badge, Modal, Input, Field } from '../components/ui';
import { cn } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Iluminación y Alertas — interruptores Shelly de todos los condominios.
// Lectura en vivo desde `shellyDevices` (el servidor los lee cada minuto), control
// con confirmación para los equipos críticos (Reseteos PV), alertas en rojo y
// bitácora. Pensado para mirarlo en un segundo: primero lo crítico, luego lo que
// tiene alerta, luego cada condominio.
// ─────────────────────────────────────────────────────────────────────────────

interface Estado { on: boolean | null; online: boolean; apower: number | null; voltage: number | null; temperature: number | null; energyWh: number | null; ts: Timestamp }
interface Alerta { level: 'critico' | 'alerta'; code: string; reason: string; since: Timestamp; ackedAt?: Timestamp | null; ackedBy?: { name: string } | null }
interface Dev {
  id: string; shellyId: string; baseId: string; channel: number; name: string; shellyName?: string; model: string; gen: number;
  category: string; roomId: string; roomName: string; condoId: string; condoName: string; zona: string;
  tipo: 'luces' | 'reseteo' | 'motor' | 'medidor' | 'otro'; critico: boolean; horario: { on?: string; off?: string; modo?: 'solar'; offsetMin?: number } | null;
  umbralW: number; hidden: boolean; state: Estado | null; alert: Alerta | null;
  lastChangeAt?: Timestamp | null; lastChangeBy?: { uid: string; name: string } | null;
}
interface Evento { id: string; deviceId: string; name: string; condoName: string; type: string; from?: any; to?: any; by?: { name: string } | null; reason?: string; level?: string; ts: Timestamp }
interface Condo { id: string; name: string }

const TIPO_LABEL: Record<Dev['tipo'], string> = { luces: 'Luces', reseteo: 'Reseteo', motor: 'Motor', medidor: 'Medidor', otro: 'Otro' };

function hace(ts?: Timestamp | null): string {
  if (!ts?.toMillis) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts.toMillis()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return ts.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const fmtW = (w: number | null | undefined) => (w == null ? '—' : `${w >= 100 ? Math.round(w) : w.toFixed(1)} W`);

// Semáforo de un condominio según sus equipos.
function tono(devs: Dev[]): 'rojo' | 'ambar' | 'verde' | 'gris' {
  if (devs.some(d => d.alert && !d.alert.ackedAt)) return 'rojo';
  if (devs.some(d => d.alert)) return 'ambar';
  if (devs.some(d => d.state && !d.state.online)) return 'ambar';
  if (!devs.length) return 'gris';
  return 'verde';
}

const Lighting: React.FC = () => {
  const { user, profile } = useAuth();
  const { status } = useLightingAlert();
  const isSuper = profile?.role === 'super_admin' || profile?.condoScope === 'all';

  const [devs, setDevs] = useState<Dev[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);        // condoId expandido
  const [verBitacora, setVerBitacora] = useState(false);
  const [verOcultos, setVerOcultos] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<{ dev: Dev; on: boolean } | null>(null);
  const [editar, setEditar] = useState<Dev | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // ── Datos en vivo ────────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'shellyDevices'),
      snap => setDevs(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Dev, 'id'>) }))),
      e => setError(`No se pudieron leer los equipos: ${e.message}`));
    const u2 = onSnapshot(query(collection(db, 'shellyEvents'), orderBy('ts', 'desc'), limit(60)),
      snap => setEventos(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Evento, 'id'>) }))), () => {});
    const u3 = onSnapshot(collection(db, 'condos'),
      snap => setCondos(snap.docs.map(d => ({ id: d.id, name: String(d.data().name || '').trim() })).sort((a, b) => a.name.localeCompare(b.name))), () => {});
    return () => { u1(); u2(); u3(); };
  }, []);

  // ── Alcance: super ve todo; el resto, sus condominios ───────────────────
  const misCondos = useMemo<Set<string> | null>(() => {
    if (isSuper) return null;
    const ids = new Set<string>();
    if (profile?.condoId) ids.add(profile.condoId);
    (profile?.condoIds || []).forEach(i => ids.add(i));
    return ids;
  }, [isSuper, profile?.condoId, profile?.condoIds]);

  const visibles = useMemo(() => devs
    .filter(d => (verOcultos && isSuper) || !d.hidden)
    .filter(d => misCondos === null || misCondos.has(d.condoId))
    .sort((a, b) => a.name.localeCompare(b.name)), [devs, misCondos, verOcultos, isSuper]);

  const criticos = useMemo(() => visibles.filter(d => d.tipo === 'reseteo' || d.critico), [visibles]);
  const conAlerta = useMemo(() => visibles.filter(d => d.alert), [visibles]);
  const porCondo = useMemo(() => {
    const m = new Map<string, { id: string; name: string; devs: Dev[] }>();
    for (const d of visibles) {
      if (d.tipo === 'reseteo' || d.critico) continue; // los críticos van en su propia sección
      const key = d.condoId || '';
      if (!m.has(key)) m.set(key, { id: key, name: d.condoName || (key ? key : 'Sin asignar'), devs: [] });
      m.get(key)!.devs.push(d);
    }
    const orden = { rojo: 0, ambar: 1, verde: 2, gris: 3 };
    return [...m.values()].sort((a, b) => orden[tono(a.devs)] - orden[tono(b.devs)] || a.name.localeCompare(b.name));
  }, [visibles]);

  // ── Acciones ─────────────────────────────────────────────────────────────
  const post = async (path: string, body?: unknown) => {
    const res = await authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };

  const conmutar = async (dev: Dev, on: boolean, confirm = false) => {
    setError(null);
    // Apagar siempre se confirma (un toque accidental deja un acceso a oscuras o, en
    // los críticos, equipos sin energía). Encender va directo.
    if (!on && !confirm) { setConfirmar({ dev, on }); return; }
    setPending(p => new Set(p).add(dev.id));
    try {
      const r = await post(`/api/lighting/devices/${dev.id}/switch`, { on, confirm });
      if (!r.ok) {
        if (r.data?.code === 'confirm_required') { setConfirmar({ dev, on }); return; }
        throw new Error(r.data?.error || 'No se pudo cambiar el interruptor');
      }
    } catch (e: any) { setError(e.message); }
    finally { setPending(p => { const n = new Set(p); n.delete(dev.id); return n; }); }
  };

  const revisar = async (dev: Dev) => {
    const r = await post(`/api/lighting/devices/${dev.id}/ack`);
    if (!r.ok) setError(r.data?.error || 'No se pudo marcar la alerta');
  };

  const leerAhora = async () => {
    setBusy('poll'); setError(null);
    try { const r = await post('/api/lighting/poll'); if (!r.ok) throw new Error(r.data?.error || 'Error al leer'); }
    catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const sincronizar = async () => {
    setBusy('sync'); setError(null);
    try {
      const r = await post('/api/lighting/sync');
      if (!r.ok) throw new Error(r.data?.error || 'Error al sincronizar');
      setAviso(`Sincronizado: ${r.data.total} equipos (${r.data.nuevos} nuevos, ${r.data.salas} salas).`);
      setTimeout(() => setAviso(null), 5000);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const guardarEdicion = async (cambios: Partial<Dev>) => {
    if (!editar) return;
    setBusy('edit'); setError(null);
    try {
      const res = await authedFetch(`/api/lighting/devices/${editar.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cambios) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo guardar');
      setEditar(null);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  // ── Piezas ───────────────────────────────────────────────────────────────
  const BotonPower = ({ dev, grande = true }: { dev: Dev; grande?: boolean }) => {
    const st = dev.state; const on = st?.on === true; const offline = !!st && !st.online;
    const espera = pending.has(dev.id);
    return (
      <button
        type="button"
        onClick={() => conmutar(dev, !on)}
        disabled={espera || offline || dev.tipo === 'medidor'}
        aria-label={on ? 'Apagar' : 'Encender'}
        title={offline ? 'Sin conexión' : on ? 'Apagar' : 'Encender'}
        className={cn(
          'rounded-full flex items-center justify-center shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed',
          grande ? 'w-20 h-20 ring-[6px]' : 'w-12 h-12 ring-4',
          offline ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 ring-slate-300/40'
          : on ? 'bg-white text-blue-600 ring-blue-500 shadow-blue-500/30'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-300 dark:ring-slate-600 hover:ring-slate-400',
          espera && 'opacity-60',
        )}
      >
        {espera ? <span className={cn('border-2 border-current border-t-transparent rounded-full animate-spin', grande ? 'w-7 h-7' : 'w-4 h-4')} />
          : offline ? <WifiOff size={grande ? 30 : 18} /> : <Power size={grande ? 34 : 20} strokeWidth={2.5} />}
      </button>
    );
  };

  const ChipAlerta = ({ a }: { a: Alerta }) => (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full',
      a.ackedAt ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      : a.level === 'critico' ? 'bg-red-600 text-white animate-pulse' : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300')}>
      <AlertTriangle size={11} /> {a.reason}{a.ackedAt ? ' · revisada' : ''}
    </span>
  );

  const TarjetaEquipo = ({ dev }: { dev: Dev }) => {
    const st = dev.state; const on = st?.on === true; const offline = !!st && !st.online;
    const critico = dev.tipo === 'reseteo' || dev.critico;
    return (
      <div className={cn(
        'relative rounded-2xl border p-4 flex flex-col gap-3 bg-white dark:bg-slate-900/70 shadow-sm transition-colors',
        dev.alert && !dev.alert.ackedAt ? 'border-red-400 dark:border-red-500/60 ring-2 ring-red-500/20'
        : critico ? 'border-red-200 dark:border-red-500/30'
        : offline ? 'border-amber-300 dark:border-amber-500/40'
        : on ? 'border-blue-200 dark:border-blue-500/30' : 'border-slate-200 dark:border-white/10',
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <Badge variant={critico ? 'danger' : dev.tipo === 'motor' ? 'brand' : 'muted'}>
                {critico ? <><ShieldAlert size={11} /> CRÍTICO</> : TIPO_LABEL[dev.tipo]}
              </Badge>
              {offline && <Badge variant="warn"><WifiOff size={11} /> Sin conexión</Badge>}
              {!offline && st && <Badge variant={on ? 'success' : 'muted'}>{on ? (critico ? 'Energizado' : 'Encendido') : 'Apagado'}</Badge>}
            </div>
            <p className="font-semibold text-slate-900 dark:text-white leading-tight truncate">{dev.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
              <Building2 size={11} /> {dev.condoName || 'Sin asignar'}{dev.zona ? ` · ${dev.zona}` : ''}
            </p>
          </div>
          {isSuper && (
            <button type="button" onClick={() => setEditar(dev)} aria-label="Configurar"
              className="shrink-0 w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
              <Settings2 size={15} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 grid grid-cols-2 gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-white/5 px-2 py-1.5 text-slate-700 dark:text-slate-200 font-semibold"><Zap size={12} className="text-amber-500" /> {fmtW(st?.apower)}</span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-white/5 px-2 py-1.5 text-slate-700 dark:text-slate-200 font-semibold">{st?.voltage != null ? `${st.voltage.toFixed(1)} V` : '— V'}</span>
            {st?.temperature != null && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-white/5 px-2 py-1.5 text-slate-600 dark:text-slate-300"><Thermometer size={12} /> {st.temperature.toFixed(0)} °C</span>}
            {dev.horario && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-white/5 px-2 py-1.5 text-slate-600 dark:text-slate-300" title={dev.horario.modo === 'solar' ? 'Encendido esperado de atardecer a amanecer (Región Metropolitana)' : 'Horario esperado'}><Clock size={12} /> {dev.horario.modo === 'solar' ? '🌙 atardecer–amanecer' : `${dev.horario.on}–${dev.horario.off}`}</span>}
          </div>
          <BotonPower dev={dev} />
        </div>

        {dev.alert && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <ChipAlerta a={dev.alert} />
            {!dev.alert.ackedAt && <button type="button" onClick={() => revisar(dev)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer inline-flex items-center gap-1"><Check size={11} /> Revisada</button>}
          </div>
        )}
        <p className="text-[11px] text-slate-400">
          Lectura {hace(st?.ts)}{dev.lastChangeAt ? ` · cambio ${hace(dev.lastChangeAt)}${dev.lastChangeBy?.name ? ` por ${dev.lastChangeBy.name}` : ' (automático/físico)'}` : ''}
        </p>
      </div>
    );
  };

  const alertasActivas = conAlerta.filter(d => !d.alert?.ackedAt);
  const configurado = status?.configured !== false;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 pb-8">
      <PageHeader
        icon={Lightbulb}
        title="Iluminación y Alertas"
        description={status?.lastPoll ? `${status.on}/${status.devices} encendidos · ${status.offline} sin conexión · última lectura ${hace(status.lastPoll)}` : 'Interruptores Shelly de los condominios'}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={busy === 'poll'} onClick={leerAhora}>Leer ahora</Button>
            {isSuper && <Button variant="secondary" size="sm" loading={busy === 'sync'} onClick={sincronizar}>Sincronizar Shelly</Button>}
            {isSuper && <Button variant="ghost" size="sm" icon={Eye} onClick={() => setVerOcultos(v => !v)}>{verOcultos ? 'Ocultar medidores' : 'Ver medidores'}</Button>}
          </div>
        }
      />

      {!configurado && <p className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300 rounded-xl px-4 py-3">Falta configurar SHELLY_HOST / SHELLY_AUTH_KEY en el servidor.</p>}
      {status?.lastError && <p className="text-xs text-red-600 dark:text-red-400">Último error de lectura: {status.lastError}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-xl px-4 py-2">{error}</p>}
      {aviso && <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl px-4 py-2">{aviso}</p>}

      {/* ── Alertas activas ── */}
      {alertasActivas.length > 0 && (
        <div className="rounded-2xl border border-red-300 dark:border-red-500/50 bg-red-50 dark:bg-red-500/10 p-4">
          <p className="font-bold text-red-700 dark:text-red-300 flex items-center gap-2 mb-2"><AlertTriangle size={18} /> {alertasActivas.length} alerta{alertasActivas.length !== 1 ? 's' : ''} activa{alertasActivas.length !== 1 ? 's' : ''}</p>
          <ul className="space-y-1.5">
            {alertasActivas.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 text-sm flex-wrap">
                <span className="text-red-800 dark:text-red-200"><strong>{d.name}</strong> · {d.condoName || d.roomName} — {d.alert!.reason} <span className="text-red-500/80">({hace(d.alert!.since)})</span></span>
                <span className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => setAbierto(d.tipo === 'reseteo' || d.critico ? '__criticos' : (d.condoId || ''))} className="text-xs font-semibold text-red-700 dark:text-red-300 underline cursor-pointer">Ver</button>
                  <button type="button" onClick={() => revisar(d)} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-300 cursor-pointer inline-flex items-center gap-1"><Check size={12} /> Revisada</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Críticos: reseteos de equipos ── */}
      {criticos.length > 0 && (
        <section className="rounded-2xl border-2 border-red-300 dark:border-red-500/40 p-4 bg-white/60 dark:bg-slate-900/40">
          <button type="button" onClick={() => setAbierto(a => (a === '__criticos' ? null : '__criticos'))} className="w-full flex items-center justify-between gap-3 cursor-pointer">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0"><ShieldAlert size={20} /></span>
              <div className="text-left min-w-0">
                <p className="font-bold text-slate-900 dark:text-white">Equipos críticos — Reseteos PV</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Estos interruptores alimentan cámaras, lectores y DSS. Deben estar siempre <strong>energizados</strong>; apagarlos deja el condominio sin equipos.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {criticos.map(d => (
                <span key={d.id} title={d.name} className={cn('w-3 h-3 rounded-full', d.state && !d.state.online ? 'bg-slate-400' : d.state?.on === false ? 'bg-red-600 animate-pulse' : 'bg-emerald-500')} />
              ))}
              {abierto === '__criticos' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>
          {abierto === '__criticos' && (
            <div className="grid gap-3 mt-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {criticos.map(d => <TarjetaEquipo key={d.id} dev={d} />)}
            </div>
          )}
        </section>
      )}

      {/* ── Condominios ── */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {porCondo.map(c => {
          const t = tono(c.devs); const encendidos = c.devs.filter(d => d.state?.on === true).length;
          const offline = c.devs.filter(d => d.state && !d.state.online).length;
          const watts = c.devs.reduce((a, d) => a + (d.state?.apower || 0), 0);
          const open = abierto === c.id;
          return (
            <React.Fragment key={c.id || '__sin'}>
              <button type="button" onClick={() => setAbierto(open ? null : c.id)} className={cn(
                'text-left rounded-2xl border p-4 flex items-center gap-3 shadow-sm transition-colors cursor-pointer bg-white dark:bg-slate-900/70',
                t === 'rojo' ? 'border-red-400 dark:border-red-500/60 ring-2 ring-red-500/20'
                : t === 'ambar' ? 'border-amber-300 dark:border-amber-500/40'
                : 'border-slate-200 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-500/40',
                open && 'sm:col-span-2 xl:col-span-3',
              )}>
                <span className={cn('w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
                  t === 'rojo' ? 'bg-red-600 text-white' : t === 'ambar' ? 'bg-amber-500 text-white'
                  : encendidos > 0 ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-slate-100 dark:bg-white/5 text-slate-400')}>
                  {t === 'rojo' ? <AlertTriangle size={22} /> : <Lightbulb size={22} fill={encendidos > 0 ? 'currentColor' : 'none'} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-slate-900 dark:text-white truncate">{c.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {encendidos}/{c.devs.length} encendido{c.devs.length !== 1 ? 's' : ''} · {fmtW(watts)}{offline ? ` · ${offline} sin conexión` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {c.devs.slice(0, 6).map(d => (
                    <span key={d.id} title={`${d.name}: ${d.state?.on ? 'encendido' : 'apagado'}`} className={cn('w-2.5 h-2.5 rounded-full',
                      d.state && !d.state.online ? 'bg-slate-400' : d.state?.on ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600')} />
                  ))}
                  {open ? <ChevronUp size={16} className="text-slate-400 ml-1" /> : <ChevronDown size={16} className="text-slate-400 ml-1" />}
                </span>
              </button>
              {open && (
                <div className="sm:col-span-2 xl:col-span-3 grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 -mt-1">
                  {c.devs.map(d => <TarjetaEquipo key={d.id} dev={d} />)}
                </div>
              )}
            </React.Fragment>
          );
        })}
        {porCondo.length === 0 && criticos.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-500 dark:text-slate-400">
            <Lightbulb size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="font-semibold">Sin equipos todavía</p>
            {isSuper && <p className="text-sm mt-1">Pulsa <strong>Sincronizar Shelly</strong> para importar los interruptores de la cuenta.</p>}
          </div>
        )}
      </div>

      {/* ── Bitácora ── */}
      <section className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60">
        <button type="button" onClick={() => setVerBitacora(v => !v)} className="w-full flex items-center justify-between px-4 py-3 cursor-pointer">
          <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><History size={16} /> Bitácora</span>
          {verBitacora ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {verBitacora && (
          <ul className="divide-y divide-slate-100 dark:divide-white/5 max-h-96 overflow-y-auto">
            {eventos.filter(e => misCondos === null || misCondos.has((e as any).condoId)).map(e => (
              <li key={e.id} className="px-4 py-2 text-sm flex items-start gap-2">
                <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0',
                  e.type === 'alert' ? 'bg-red-500' : e.type === 'alert_resolved' ? 'bg-emerald-500' : e.type === 'action' ? 'bg-blue-500' : e.type === 'online' ? 'bg-amber-500' : 'bg-slate-400')} />
                <span className="flex-1 min-w-0 text-slate-700 dark:text-slate-200">
                  <strong>{e.name}</strong> <span className="text-slate-400">· {e.condoName || '—'}</span>{' '}
                  {e.type === 'action' && <>{e.to ? 'encendido' : 'apagado'} por <strong>{e.by?.name || '—'}</strong></>}
                  {e.type === 'state' && <>{e.to ? 'se encendió' : 'se apagó'} (físico/automático)</>}
                  {e.type === 'online' && <>{e.to ? 'recuperó conexión' : 'perdió conexión'}</>}
                  {e.type === 'alert' && <span className="text-red-600 dark:text-red-400">alerta: {e.reason}</span>}
                  {e.type === 'alert_resolved' && <span className="text-emerald-600 dark:text-emerald-400">alerta resuelta: {e.reason}</span>}
                </span>
                <span className="text-xs text-slate-400 shrink-0">{hace(e.ts)}</span>
              </li>
            ))}
            {eventos.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">Sin eventos aún.</li>}
          </ul>
        )}
      </section>

      {/* ── Confirmación de acción crítica ── */}
      <Modal open={!!confirmar} onClose={() => setConfirmar(null)} icon={confirmar && (confirmar.dev.critico || confirmar.dev.tipo === 'reseteo') ? ShieldAlert : Power}
        title={confirmar && (confirmar.dev.critico || confirmar.dev.tipo === 'reseteo') ? 'Interruptor crítico' : 'Confirmar apagado'}
        description={confirmar && (confirmar.dev.critico || confirmar.dev.tipo === 'reseteo')
          ? 'Este interruptor alimenta equipos del condominio (cámaras, lectores, DSS). Al apagarlo quedan sin energía hasta que se vuelva a encender.'
          : 'El sector quedará a oscuras hasta que alguien vuelva a encenderlo. La acción queda registrada en la bitácora con tu nombre.'}>
        {confirmar && (() => { const critico = confirmar.dev.critico || confirmar.dev.tipo === 'reseteo'; return (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-200">¿Apagar <strong>{confirmar.dev.name}</strong> ({confirmar.dev.condoName || confirmar.dev.roomName}){confirmar.dev.state?.apower ? ` · ${fmtW(confirmar.dev.state.apower)} ahora` : ''}?</p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmar(null)}>Cancelar</Button>
              <Button variant="danger" className="flex-1" icon={Power} onClick={() => { const c = confirmar; setConfirmar(null); conmutar(c.dev, c.on, true); }}>{critico ? 'Sí, apagar equipos' : 'Sí, apagar'}</Button>
            </div>
          </div>
        ); })()}
      </Modal>

      {/* ── Configuración del equipo (super_admin) ── */}
      {editar && <EditarEquipo dev={editar} condos={condos} busy={busy === 'edit'} onClose={() => setEditar(null)} onSave={guardarEdicion} />}
    </motion.div>
  );
};

function EditarEquipo({ dev, condos, busy, onClose, onSave }: { dev: Dev; condos: Condo[]; busy: boolean; onClose: () => void; onSave: (c: Partial<Dev>) => void }) {
  const [name, setName] = useState(dev.name);
  const [condoId, setCondoId] = useState(dev.condoId || '');
  const [zona, setZona] = useState(dev.zona || '');
  const [tipo, setTipo] = useState<Dev['tipo']>(dev.tipo);
  const [critico, setCritico] = useState(!!dev.critico);
  const [modoHorario, setModoHorario] = useState<'ninguno' | 'solar' | 'fijo'>(!dev.horario ? 'ninguno' : dev.horario.modo === 'solar' ? 'solar' : 'fijo');
  const [offsetMin, setOffsetMin] = useState(String(dev.horario?.offsetMin ?? 0));
  const [hOn, setHOn] = useState(dev.horario?.on || '19:00');
  const [hOff, setHOff] = useState(dev.horario?.off || '07:00');
  const [umbral, setUmbral] = useState(String(dev.umbralW ?? 0));
  const [hidden, setHidden] = useState(!!dev.hidden);
  const sel = 'w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100';
  return (
    <Modal open onClose={onClose} icon={Settings2} title="Configurar equipo" description={`Shelly: ${dev.shellyName || dev.shellyId} · ${dev.model} · sala "${dev.roomName || '—'}"`} size="md">
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); onSave({ name, condoId, zona, tipo, critico, hidden, umbralW: Number(umbral) || 0, horario: modoHorario === 'solar' ? { modo: 'solar', offsetMin: Number(offsetMin) || 0 } : modoHorario === 'fijo' ? { on: hOn, off: hOff } : null }); }}>
        <Field label="Nombre en la app"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Condominio">
          <select value={condoId} onChange={e => setCondoId(e.target.value)} className={sel}>
            <option value="">Sin asignar</option>
            {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Zona (p. ej. Acceso peatonal, Estacionamiento)"><Input value={zona} onChange={e => setZona(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select value={tipo} onChange={e => setTipo(e.target.value as Dev['tipo'])} className={sel}>
              {(Object.keys(TIPO_LABEL) as Dev['tipo'][]).map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Umbral sin consumo (W)" hint="0 = no alertar"><Input type="number" min={0} value={umbral} onChange={e => setUmbral(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={critico} onChange={e => setCritico(e.target.checked)} /> Crítico (alimenta equipos: alerta roja si se apaga, confirmación para apagar)
        </label>
        <Field label="Horario esperado de encendido" hint="La alerta salta si el estado real no coincide con el esperado (tolerancia 15–30 min).">
          <select value={modoHorario} onChange={e => setModoHorario(e.target.value as any)} className={sel}>
            <option value="ninguno">Sin horario (no alertar)</option>
            <option value="solar">Atardecer → amanecer (Región Metropolitana, automático)</option>
            <option value="fijo">Horas fijas</option>
          </select>
        </Field>
        {modoHorario === 'solar' && (
          <Field label="Desfase programado en el Shelly (min)" hint="Ej. 15 = enciende 15 min después del atardecer y apaga 15 min antes del amanecer. 0 si no hay desfase.">
            <Input type="number" min={-120} max={120} value={offsetMin} onChange={e => setOffsetMin(e.target.value)} />
          </Field>
        )}
        {modoHorario === 'fijo' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Encender a las"><Input type="time" value={hOn} onChange={e => setHOn(e.target.value)} /></Field>
            <Field label="Apagar a las"><Input type="time" value={hOff} onChange={e => setHOff(e.target.value)} /></Field>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} /> Ocultar del módulo (p. ej. medidores)
        </label>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={busy} icon={Check} className="flex-1">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}

export default Lighting;
