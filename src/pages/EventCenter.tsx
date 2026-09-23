import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, limit, Timestamp, doc } from 'firebase/firestore';
import { motion } from 'motion/react';
import {
  Siren, AlertTriangle, Check, X, Ban, EyeOff, RefreshCw, Building2, Camera, DoorOpen,
  ChevronDown, ChevronUp, Filter, ClipboardList, CheckSquare, Square, Clock,
} from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { authedFetch } from '../lib/apiBase';
import { Button, PageHeader, Badge, Modal, EmptyState } from '../components/ui';
import { cn } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Centro de eventos — alarmas del Centro de Eventos del DSS, ya normalizadas por el
// servidor (dssAlarms). Sólo las de gravedad ALTA se gestionan (resuelta / falsa /
// ignorar / en gestión); medias y bajas son registro. Las repeticiones vienen
// agrupadas (count) para que una ráfaga no tape lo importante.
// ─────────────────────────────────────────────────────────────────────────────

interface Gestion { status: number; by: { uid: string; name: string }; at: Timestamp; comment?: string; dssOk?: boolean }
interface Alarma {
  id: string; alarmId: string; ts: number; at: Timestamp; lastTs: number; type: string; typeName: string; grade: number; gestionable: boolean;
  deviceName: string; channelName: string; condoId: string; condoName: string; count: number;
  dssHandleStatus: string; dssHandleUser?: string | null; picture?: string; gestion: Gestion | null;
}
interface Status { lastSync?: Timestamp; lastError?: string | null; pendientesAltas?: number; porCondo?: Record<string, number> }

const GRADO = { 1: { label: 'Alta', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' }, 2: { label: 'Media', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' }, 3: { label: 'Baja', cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' } } as Record<number, { label: string; cls: string }>;
const ESTADO_LABEL: Record<number, string> = { 1: 'En gestión', 2: 'Resuelta', 3: 'Falsa alarma', 4: 'Ignorada' };
const RANGOS = [{ k: '1d', label: 'Hoy', dias: 1 }, { k: '7d', label: '7 días', dias: 7 }, { k: '30d', label: '30 días', dias: 30 }];

const hace = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `hace ${s} s`; if (s < 3600) return `hace ${Math.floor(s / 60)} min`; if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(ms).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
};
const fmtHora = (ts: number) => new Date(ts * 1000).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const pendiente = (a: Alarma) => a.gestionable && !a.gestion && a.dssHandleStatus === '0';

const EventCenter: React.FC = () => {
  const { profile } = useAuth();
  const isSuper = profile?.role === 'super_admin' || profile?.condoScope === 'all';
  const [alarmas, setAlarmas] = useState<Alarma[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [rango, setRango] = useState('7d');
  const [condo, setCondo] = useState<string>('');
  const [vista, setVista] = useState<'pendientes' | 'gestionadas' | 'registro'>('pendientes');
  const [tipo, setTipo] = useState<string>('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [accion, setAccion] = useState<{ ids: string[]; status: number } | null>(null);
  const [comentario, setComentario] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const dias = RANGOS.find(r => r.k === rango)!.dias;

  useEffect(() => {
    const desde = Math.floor(Date.now() / 1000) - dias * 86400;
    const u1 = onSnapshot(query(collection(db, 'dssAlarms'), where('ts', '>=', desde), orderBy('ts', 'desc'), limit(1500)),
      snap => setAlarmas(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Alarma, 'id'>) }))),
      e => setError(`No se pudieron leer los eventos: ${e.message}`));
    const u2 = onSnapshot(doc(db, 'config', 'dssAlarmsStatus'), s => setStatus(s.exists() ? (s.data() as Status) : null), () => {});
    return () => { u1(); u2(); };
  }, [dias]);

  const misCondos = useMemo<Set<string> | null>(() => {
    if (isSuper) return null;
    const ids = new Set<string>(); if (profile?.condoId) ids.add(profile.condoId); (profile?.condoIds || []).forEach(i => ids.add(i)); return ids;
  }, [isSuper, profile?.condoId, profile?.condoIds]);

  const visibles = useMemo(() => alarmas.filter(a => misCondos === null || misCondos.has(a.condoId)), [alarmas, misCondos]);
  const condos = useMemo(() => [...new Set(visibles.map(a => a.condoName || 'Sin condominio'))].sort(), [visibles]);
  const tipos = useMemo(() => [...new Set(visibles.filter(a => vista !== 'registro' ? a.gestionable : !a.gestionable).map(a => a.typeName))].sort(), [visibles, vista]);

  const lista = useMemo(() => visibles.filter(a => {
    if (condo && (a.condoName || 'Sin condominio') !== condo) return false;
    if (tipo && a.typeName !== tipo) return false;
    if (vista === 'pendientes') return pendiente(a);
    if (vista === 'gestionadas') return a.gestionable && !pendiente(a);
    return !a.gestionable;
  }), [visibles, condo, tipo, vista]);

  // Resumen por condominio (altas pendientes en el rango)
  const resumen = useMemo(() => {
    const m = new Map<string, { pend: number; total: number; ultima: number }>();
    for (const a of visibles) {
      const k = a.condoName || 'Sin condominio'; const r = m.get(k) || { pend: 0, total: 0, ultima: 0 };
      r.total += a.count || 1; if (pendiente(a)) r.pend += a.count || 1; r.ultima = Math.max(r.ultima, a.lastTs || a.ts); m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => b[1].pend - a[1].pend || b[1].total - a[1].total);
  }, [visibles]);

  const toggleSel = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todasSel = lista.length > 0 && lista.every(a => sel.has(a.id));

  const ejecutar = async () => {
    if (!accion) return;
    setBusy('handle'); setError(null);
    try {
      const res = await authedFetch('/api/events/handle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: accion.ids, status: accion.status, comment: comentario }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo gestionar');
      setSel(new Set()); setAccion(null); setComentario('');
      if (d.dssFail) setError(`${d.gestionadas} gestionadas en la app; ${d.dssFail} no se reflejaron en el DSS (se guardó igual).`);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const sincronizar = async () => {
    setBusy('sync'); setError(null);
    try { const r = await authedFetch('/api/events/sync', { method: 'POST' }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Error'); }
    catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const BotonesGestion = ({ ids, compact = false }: { ids: string[]; compact?: boolean }) => (
    <div className={cn('flex items-center gap-1.5', compact ? '' : 'flex-wrap')}>
      <button type="button" onClick={() => setAccion({ ids, status: 2 })} title="Resuelta" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"><Check size={13} />{!compact && ' Resuelta'}</button>
      <button type="button" onClick={() => setAccion({ ids, status: 3 })} title="Falsa alarma" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white cursor-pointer"><Ban size={13} />{!compact && ' Falsa alarma'}</button>
      <button type="button" onClick={() => setAccion({ ids, status: 4 })} title="Ignorar" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/20 text-slate-700 dark:text-slate-200 cursor-pointer"><EyeOff size={13} />{!compact && ' Ignorar'}</button>
      <button type="button" onClick={() => setAccion({ ids, status: 1 })} title="En gestión" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"><ClipboardList size={13} />{!compact && ' En gestión'}</button>
    </div>
  );

  const pendTotal = visibles.filter(pendiente).reduce((a, x) => a + (x.count || 1), 0);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 pb-8">
      <PageHeader
        icon={Siren}
        title="Centro de eventos"
        description={status?.lastSync ? `Alarmas del DSS · última lectura ${hace(status.lastSync.toMillis())} · ${pendTotal} altas pendientes` : 'Alarmas del Centro de Eventos del DSS'}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
              {RANGOS.map(r => <button key={r.k} type="button" onClick={() => setRango(r.k)} className={cn('px-3 py-1.5 text-xs font-semibold cursor-pointer', rango === r.k ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5')}>{r.label}</button>)}
            </div>
            {isSuper && <Button variant="secondary" size="sm" icon={RefreshCw} loading={busy === 'sync'} onClick={sincronizar}>Leer ahora</Button>}
          </div>
        }
      />
      {status?.lastError && <p className="text-xs text-red-600 dark:text-red-400">Último error de lectura: {status.lastError}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-xl px-4 py-2">{error}</p>}

      {/* Resumen por condominio */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        {resumen.map(([nombre, r]) => (
          <button key={nombre} type="button" onClick={() => setCondo(c => (c === nombre ? '' : nombre))} className={cn(
            'text-left rounded-2xl border p-3 bg-white dark:bg-slate-900/70 shadow-sm cursor-pointer transition-colors',
            condo === nombre ? 'border-blue-500 ring-2 ring-blue-500/20' : r.pend > 0 ? 'border-red-300 dark:border-red-500/50' : 'border-slate-200 dark:border-white/10 hover:border-blue-300',
          )}>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1"><Building2 size={11} /> {nombre}</p>
            <p className={cn('text-2xl font-bold tabular-nums', r.pend > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100')}>{r.pend}</p>
            <p className="text-[11px] text-slate-400">altas pendientes · {r.total.toLocaleString('es-CL')} eventos · {hace(r.ultima * 1000)}</p>
          </button>
        ))}
        {resumen.length === 0 && <p className="col-span-full text-sm text-slate-500 py-4 text-center">Sin eventos en el rango.</p>}
      </div>

      {/* Filtros y vista */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          {([['pendientes', `Altas pendientes (${visibles.filter(pendiente).length})`], ['gestionadas', 'Altas gestionadas'], ['registro', 'Registro (medias/bajas)']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setVista(k); setTipo(''); setSel(new Set()); }} className={cn('px-3 py-1.5 text-xs font-semibold cursor-pointer', vista === k ? (k === 'pendientes' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white') : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5')}>{l}</button>
          ))}
        </div>
        <select value={condo} onChange={e => setCondo(e.target.value)} className="text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-slate-700 dark:text-slate-200">
          <option value="">Todos los condominios</option>{condos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={tipo} onChange={e => setTipo(e.target.value)} className="text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-slate-700 dark:text-slate-200">
          <option value="">Todos los tipos</option>{tipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(condo || tipo) && <button type="button" onClick={() => { setCondo(''); setTipo(''); }} className="text-xs text-slate-500 underline cursor-pointer inline-flex items-center gap-1"><Filter size={12} /> limpiar</button>}
        <span className="text-xs text-slate-400 ml-auto">{lista.length} filas</span>
      </div>

      {/* Barra de selección múltiple */}
      {vista === 'pendientes' && lista.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/70 px-3 py-2">
          <button type="button" onClick={() => setSel(todasSel ? new Set() : new Set(lista.map(a => a.id)))} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
            {todasSel ? <CheckSquare size={16} /> : <Square size={16} />} {todasSel ? 'Quitar selección' : `Seleccionar las ${lista.length}`}
          </button>
          {sel.size > 0 && <><span className="text-xs text-slate-500">{sel.size} seleccionadas →</span><BotonesGestion ids={[...sel]} /></>}
        </div>
      )}

      {/* Lista */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 divide-y divide-slate-100 dark:divide-white/5">
        {lista.length === 0 ? (
          <div className="py-10"><EmptyState icon={vista === 'pendientes' ? Check : Siren} title={vista === 'pendientes' ? 'Sin alarmas altas pendientes' : 'Sin eventos'} description={vista === 'pendientes' ? 'Todo gestionado en este rango.' : 'Prueba otro rango o filtro.'} /></div>
        ) : lista.map(a => {
          const open = abierta === a.id; const g = GRADO[a.grade] || GRADO[3]; const esCam = !!a.channelName;
          return (
            <div key={a.id} className={cn('px-3 py-2.5', pendiente(a) && 'bg-red-50/40 dark:bg-red-500/5')}>
              <div className="flex items-start gap-2">
                {vista === 'pendientes' && (
                  <button type="button" onClick={() => toggleSel(a.id)} className="mt-0.5 text-slate-500 cursor-pointer shrink-0">{sel.has(a.id) ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                )}
                <span className={cn('mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0', a.grade === 1 ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300' : 'bg-slate-100 text-slate-500 dark:bg-white/5')}>
                  {esCam ? <Camera size={15} /> : <DoorOpen size={15} />}
                </span>
                <button type="button" onClick={() => setAbierta(open ? null : a.id)} className="flex-1 min-w-0 text-left cursor-pointer">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">{a.typeName}</span>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', g.cls)}>{g.label}</span>
                    {a.count > 1 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-800 text-white dark:bg-white dark:text-slate-900">×{a.count}</span>}
                    {a.gestion && <Badge variant={a.gestion.status === 2 ? 'success' : a.gestion.status === 3 ? 'warn' : 'muted'}>{ESTADO_LABEL[a.gestion.status]}</Badge>}
                    {!a.gestion && a.dssHandleStatus !== '0' && <Badge variant="muted">Gestionada en DSS</Badge>}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    <span className="text-slate-700 dark:text-slate-200 font-medium">{a.condoName || 'Sin condominio'}</span> · {a.deviceName}{a.channelName ? ` / ${a.channelName}` : ''} · {fmtHora(a.ts)}{a.count > 1 ? ` → ${fmtHora(a.lastTs)}` : ''}
                  </p>
                </button>
                <div className="shrink-0 flex items-center gap-1">
                  {pendiente(a) && <div className="hidden md:block"><BotonesGestion ids={[a.id]} compact /></div>}
                  <button type="button" onClick={() => setAbierta(open ? null : a.id)} className="text-slate-400 cursor-pointer">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                </div>
              </div>
              {open && (
                <div className="mt-2 ml-10 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                  <p><Clock size={11} className="inline mr-1" />Primera {fmtHora(a.ts)}{a.count > 1 ? ` · última ${fmtHora(a.lastTs)} · ${a.count} repeticiones` : ''} · código DSS {a.type} · id {a.alarmId}</p>
                  {a.gestion && <p>Gestionada por <strong>{a.gestion.by?.name}</strong> {hace(a.gestion.at.toMillis())} como <strong>{ESTADO_LABEL[a.gestion.status]}</strong>{a.gestion.comment ? ` — “${a.gestion.comment}”` : ''}{a.gestion.dssOk === false ? ' (sin eco en el DSS)' : ''}</p>}
                  {a.dssHandleUser && !a.gestion && <p>Gestionada en el DSS por {a.dssHandleUser}</p>}
                  {pendiente(a) && <div className="md:hidden pt-1"><BotonesGestion ids={[a.id]} /></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal de gestión */}
      <Modal open={!!accion} onClose={() => { setAccion(null); setComentario(''); }} icon={AlertTriangle} title={accion ? `${ESTADO_LABEL[accion.status]} · ${accion.ids.length} alarma${accion.ids.length !== 1 ? 's' : ''}` : ''}
        description="La gestión queda registrada con tu nombre en la app y en el Centro de Eventos del DSS.">
        {accion && (
          <div className="space-y-3">
            <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3} placeholder="Comentario (opcional): qué se revisó, qué se encontró…"
              className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100" />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setAccion(null); setComentario(''); }}>Cancelar</Button>
              <Button className="flex-1" loading={busy === 'handle'} icon={Check} onClick={ejecutar}>Confirmar</Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};

export default EventCenter;
