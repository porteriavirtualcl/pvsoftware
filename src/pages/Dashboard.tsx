import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, collectionGroup, query, where,
  onSnapshot, Timestamp, deleteDoc, doc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Users, Clock, CheckCircle2, Package, QrCode,
  Building2, Calendar, AlertTriangle, Wrench, DollarSign,
  Activity, UserCheck, Timer, Trash2, Phone, MessageCircle,
  BarChart3, TrendingUp, UserRound, LayoutGrid, Unlock,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Card, StatCard, Badge, EmptyState, Modal, Button } from '../components/ui';
import { cn } from '../lib/utils';
import { authedFetch } from '../lib/apiBase';
import { useNavigate } from 'react-router-dom';
import { estadoPresencia } from '../hooks/usePresence';

// ── helpers ───────────────────────────────────────────────────────────────────

function rangeStart(filter: '1d' | '7d'): Timestamp {
  const d = new Date();
  if (filter === '1d') { d.setHours(0, 0, 0, 0); }
  else { d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); }
  return Timestamp.fromDate(d);
}

const monthStart = () => {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
};

const fmtTime = (ts: any) => {
  if (!ts?.seconds) return '';
  return new Date(ts.seconds * 1000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
};

const fmtDate = (ts: any) => {
  if (!ts?.seconds) return '';
  return new Date(ts.seconds * 1000).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
};

// ── shared UI ─────────────────────────────────────────────────────────────────

const QuickFilter = ({ value, onChange }: { value: '1d' | '7d'; onChange: (v: '1d' | '7d') => void }) => (
  <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl w-fit mb-6">
    {([['1d', 'Hoy'], ['7d', '7 días']] as const).map(([k, label]) => (
      <button
        key={k}
        onClick={() => onChange(k)}
        className={cn(
          'px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer',
          value === k
            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
        )}
      >{label}</button>
    ))}
  </div>
);

const Panel = ({ title, badge, children, onClick }: {
  title: React.ReactNode; badge?: React.ReactNode;
  children: React.ReactNode; onClick?: () => void;
}) => (
  <Card padding="lg" onClick={onClick} hoverable={!!onClick} className={cn(onClick && 'cursor-pointer')}>
    <div className="flex items-center justify-between gap-3 mb-5">
      <h3 className="flex items-center gap-2.5">
        <span className="w-1 h-5 bg-blue-500 rounded-full shrink-0" aria-hidden />
        {title}
      </h3>
      {badge}
    </div>
    {children}
  </Card>
);

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { variant: 'brand' | 'success' | 'warn' | 'danger' | 'muted'; label: string }> = {
    open:        { variant: 'danger',  label: 'Abierto' },
    pending:     { variant: 'warn',    label: 'Pendiente' },
    in_progress: { variant: 'brand',   label: 'En progreso' },
    closed:      { variant: 'success', label: 'Cerrado' },
    approved:    { variant: 'success', label: 'Aprobado' },
    rejected:    { variant: 'danger',  label: 'Rechazado' },
    cancelled:   { variant: 'muted',   label: 'Cancelado' },
    paid:        { variant: 'success', label: 'Pagado' },
    overdue:     { variant: 'danger',  label: 'Vencido' },
    picked_up:   { variant: 'success', label: 'Retirado' },
  };
  const entry = map[status] || { variant: 'muted' as const, label: status };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
};

const VISITOR_STATUS: Record<string, { variant: 'brand' | 'success' | 'warn' | 'danger' | 'muted'; label: string }> = {
  pending: { variant: 'warn',    label: 'Próximo' },
  entered: { variant: 'success', label: 'En sitio' },
  exited:  { variant: 'muted',   label: 'Finalizado' },
};
const VisitorStatusBadge = ({ status }: { status: string }) => {
  const entry = VISITOR_STATUS[status] ?? VISITOR_STATUS.pending;
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
};

type ListRowProps = {
  icon?: LucideIcon;
  iconAccent?: 'brand' | 'indigo' | 'purple' | 'success' | 'warn' | 'danger';
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
};
const ListRow = ({ icon: Icon, iconAccent = 'brand', title, subtitle, right }: ListRowProps) => {
  const ACCENT: Record<string, string> = {
    brand:   'bg-blue-600/10 text-blue-600 dark:text-blue-400',
    indigo:  'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400',
    purple:  'bg-purple-600/10 text-purple-600 dark:text-purple-400',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warn:    'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    danger:  'bg-red-500/10 text-red-600 dark:text-red-400',
  };
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
      {Icon && (
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', ACCENT[iconAccent])}>
          <Icon size={16} strokeWidth={2.2} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
};

// ── ONLINE OPERATORS WIDGET ───────────────────────────────────────────────────

const OnlineOperatorsWidget = () => {
  const [operators, setOperators] = useState<any[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'operator')),
      snap => setOperators(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    );
    return () => unsub();
  }, []);

  const online = operators.filter(op => estadoPresencia(op) === 'en_turno');

  return (
    <Panel title={<span className="flex items-center gap-2">Operadores en línea <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /></span>} badge={<Badge variant="success">{online.length}</Badge>}>
      {online.length === 0
        ? <EmptyState icon={Users} title="Ningún operador conectado" />
        : (
          <div className="space-y-2.5">
            {online.map(op => (
              <div key={op.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Users size={16} strokeWidth={2.2} />
                  </div>
                  <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{op.name || op.email}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{op.condoName || '—'}</p>
                </div>
                {op.phone && (
                  <div className="flex gap-1.5 shrink-0">
                    <a href={`tel:${op.phone}`} title="Llamar" className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-all">
                      <Phone size={14} />
                    </a>
                    <a href={`https://wa.me/${op.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all">
                      <MessageCircle size={14} />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      }
    </Panel>
  );
};

// ── SUPER ADMIN ───────────────────────────────────────────────────────────────

const CondosSummary = () => {
  const [condos, setCondos] = useState<any[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'condos'), snap => {
      setCondos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);
  if (condos.length === 0) return <EmptyState icon={Building2} title="Sin condominios" />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {condos.slice(0, 6).map((c: any) => (
        <ListRow
          key={c.id}
          icon={Building2}
          iconAccent="brand"
          title={c.name}
          subtitle={c.address}
          right={
            <div className="flex gap-1.5">
              {c.expensesEnabled && <Badge variant="brand">Gastos</Badge>}
              {(c.dahuaChannelIds?.length ?? 0) > 0 && <Badge variant="success">ACS</Badge>}
            </div>
          }
        />
      ))}
    </div>
  );
};

// ── Estadísticas de accesos (super_admin) ──────────────────────────────────────
// Paleta categórica validada (dataviz skill, slots 1-2-3): residente=azul, QR=aqua,
// operador=amarillo. Con leyenda + valores directos (regla de relieve).
type StatBucket = { qr: number; operator: number; resident: number };
type AccessStatsData = {
  days: number; totals: StatBucket;
  byHour: StatBucket[]; byDow: StatBucket[];
  topCondos: { name: string; qr: number; operator: number; resident: number; total: number }[];
};
const ST_TYPES = [
  { key: 'resident' as const, label: 'Residentes (automático)', bar: 'bg-[#2a78d6] dark:bg-[#3987e5]', dot: 'bg-[#2a78d6] dark:bg-[#3987e5]', ink: 'text-[#2a78d6] dark:text-[#3987e5]' },
  { key: 'qr' as const,       label: 'Pases QR',                bar: 'bg-[#1baf7a] dark:bg-[#199e70]', dot: 'bg-[#1baf7a] dark:bg-[#199e70]', ink: 'text-[#1baf7a] dark:text-[#199e70]' },
  { key: 'operator' as const, label: 'Pases operador',         bar: 'bg-[#eda100] dark:bg-[#c98500]', dot: 'bg-[#eda100] dark:bg-[#c98500]', ink: 'text-[#eda100] dark:text-[#c98500]' },
];
const sumB = (b: StatBucket) => b.qr + b.operator + b.resident;

const StatLegend = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
    {ST_TYPES.map(t => (
      <span key={t.key} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <span className={cn('w-2.5 h-2.5 rounded-sm', t.dot)} />{t.label}
      </span>
    ))}
  </div>
);

// Dos mini-gráficos con ESCALA PROPIA (small multiples), no doble eje: arriba
// Residentes (dominante), abajo Pases QR+operador — así los pases se ven aunque
// sean ~24× menores. Comparten el eje X. unit = sufijo del máximo ("/h", "").
const StackedBars = ({ rows, labelFor, tickEvery = 1, unit = '' }: {
  rows: StatBucket[]; labelFor: (i: number) => string; tickEvery?: number; unit?: string;
}) => {
  const residentMax = Math.max(1, ...rows.map(r => r.resident));
  const passMax = Math.max(1, ...rows.map(r => r.qr + r.operator));
  return (
    <div>
      {/* Residentes — escala propia */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-[#2a78d6] dark:text-[#3987e5]">Residentes (automático)</span>
        <span className="text-[10px] text-slate-400">máx {residentMax.toLocaleString('es-CL')}{unit}</span>
      </div>
      <div className="flex items-end gap-[3px] h-24 mb-4">
        {rows.map((r, i) => (
          <div key={i} className="flex-1 h-full flex flex-col justify-end min-w-0 cursor-default"
               title={`${labelFor(i)} · residentes ${r.resident}`}>
            <div style={{ height: `${(r.resident / residentMax) * 100}%`, minHeight: r.resident ? 2 : 0 }}
                 className="bg-[#2a78d6] dark:bg-[#3987e5] rounded-t-[3px] transition-opacity hover:opacity-80" />
          </div>
        ))}
      </div>
      {/* Pases QR + operador — escala propia (mucho menor) */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          Pases: <span className="text-[#1baf7a] dark:text-[#199e70]">QR</span> + <span className="text-[#eda100] dark:text-[#c98500]">operador</span>
        </span>
        <span className="text-[10px] text-slate-400">máx {passMax.toLocaleString('es-CL')}{unit}</span>
      </div>
      <div className="flex items-end gap-[3px] h-24">
        {rows.map((r, i) => {
          const tp = r.qr + r.operator;
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end min-w-0 cursor-default"
                 title={`${labelFor(i)} · QR ${r.qr} · operador ${r.operator}`}>
              <div className="flex flex-col gap-[1.5px] rounded-t-[3px] overflow-hidden transition-opacity hover:opacity-80"
                   style={{ height: `${(tp / passMax) * 100}%`, minHeight: tp ? 2 : 0 }}>
                {r.operator > 0 && <div style={{ flexGrow: r.operator }} className="bg-[#eda100] dark:bg-[#c98500]" />}
                {r.qr > 0 && <div style={{ flexGrow: r.qr }} className="bg-[#1baf7a] dark:bg-[#199e70]" />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {rows.map((_, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-slate-400 dark:text-slate-500 min-w-0 truncate">
            {i % tickEvery === 0 ? labelFor(i) : ''}
          </div>
        ))}
      </div>
    </div>
  );
};

const AccessStats = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AccessStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true); setErr(null);
    authedFetch(`/api/stats/access?days=${days}`)
      .then(async r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(d => { if (!cancel) { if (d.error) throw new Error(d.error); setData(d); } })
      .catch(e => { if (!cancel) setErr(e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [days]);

  const grand = data ? sumB(data.totals) : 0;
  const peakHour = data ? data.byHour.reduce((best, b, i) => sumB(b) > sumB(data.byHour[best]) ? i : best, 0) : 0;
  const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const peakDow = data ? data.byDow.reduce((best, b, i) => sumB(b) > sumB(data.byDow[best]) ? i : best, 0) : 0;
  const maxCondo = data ? Math.max(1, ...data.topCondos.map(c => c.total)) : 1;

  return (
    <Card padding="lg">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <h3 className="flex items-center gap-2.5">
          <span className="w-1 h-5 bg-blue-500 rounded-full shrink-0" aria-hidden />
          <BarChart3 size={17} className="text-slate-400" />
          Estadísticas de accesos
        </h3>
        <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl">
          {[[7, '7 días'], [30, '30 días'], [90, '90 días']].map(([k, label]) => (
            <button key={k as number} onClick={() => setDays(k as number)}
              className={cn('px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                days === k ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                           : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200')}>
              {label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Cargando estadísticas…</div>
      ) : err ? (
        <div className="py-16 text-center text-sm text-rose-500">No se pudieron cargar las estadísticas ({err})</div>
      ) : !data || grand === 0 ? (
        <EmptyState icon={BarChart3} title="Sin datos de accesos en el período" />
      ) : (
        <div className="space-y-7">
          {/* Tiles por tipo */}
          <div className="grid grid-cols-3 gap-3">
            {ST_TYPES.map(t => {
              const v = data.totals[t.key];
              const pct = grand ? Math.round((v / grand) * 100) : 0;
              return (
                <div key={t.key} className="rounded-xl border border-slate-100 dark:border-white/5 bg-white dark:bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1.5 mb-1"><span className={cn('w-2.5 h-2.5 rounded-sm', t.dot)} /><span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">{t.label}</span></div>
                  <div className={cn('text-2xl font-black', t.ink)}>{v.toLocaleString('es-CL')}</div>
                  <div className="text-[10px] text-slate-400">{pct}% del total</div>
                </div>
              );
            })}
          </div>

          {/* Insights */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1"><Clock size={12} />Hora pico: <strong>{String(peakHour).padStart(2, '0')}:00</strong></span>
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1"><Calendar size={12} />Día con más ingresos: <strong>{DOW[peakDow]}</strong></span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1"><TrendingUp size={12} />Total: <strong>{grand.toLocaleString('es-CL')}</strong></span>
          </div>

          {/* Por hora */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Ingresos por hora del día</h4>
              <StatLegend />
            </div>
            <StackedBars rows={data.byHour} tickEvery={3} unit="/h" labelFor={i => `${String(i).padStart(2, '0')}h`} />
          </div>

          {/* Por día de semana */}
          <div>
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-3">Ingresos por día de la semana</h4>
            <StackedBars rows={data.byDow} labelFor={i => DOW[i]} />
          </div>

          {/* Top condominios */}
          <div>
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-3">Condominios con más ingresos</h4>
            <div className="space-y-2">
              {data.topCondos.slice(0, 10).map(c => (
                <div key={c.name} className="flex items-center gap-3" title={`${c.name}: ${c.total} (residentes ${c.resident} · QR ${c.qr} · operador ${c.operator})`}>
                  <div className="w-32 shrink-0 text-xs text-slate-600 dark:text-slate-300 truncate text-right">{c.name}</div>
                  <div className="flex-1 h-5 flex rounded-md overflow-hidden bg-slate-100 dark:bg-white/5">
                    {c.resident > 0 && <div style={{ width: `${(c.resident / maxCondo) * 100}%` }} className="bg-[#2a78d6] dark:bg-[#3987e5]" />}
                    {c.qr > 0 && <div style={{ width: `${(c.qr / maxCondo) * 100}%` }} className="bg-[#1baf7a] dark:bg-[#199e70]" />}
                    {c.operator > 0 && <div style={{ width: `${(c.operator / maxCondo) * 100}%` }} className="bg-[#eda100] dark:bg-[#c98500]" />}
                  </div>
                  <div className="w-12 shrink-0 text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">{c.total.toLocaleString('es-CL')}</div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-1">Residentes = accesos automáticos (rostro/tarjeta) · QR = pases de visita con código · Operador = ingresos registrados manualmente. Datos de los últimos {data.days} días.</p>
        </div>
      )}
    </Card>
  );
};

const SuperAdminView = ({ dateFilter }: { dateFilter: '1d' | '7d' }) => {
  const navigate = useNavigate();
  const [condosCount, setCondosCount]       = useState(0);
  const [residentsCount, setResidentsCount] = useState(0);
  const [openIncidents, setOpenIncidents]   = useState<any[]>([]);
  const [visitorsInRange, setVisitorsInRange] = useState(0);
  const [pendingParcels, setPendingParcels] = useState(0);
  const [pendingExpenses, setPendingExpenses] = useState(0);
  const [recentVisitors, setRecentVisitors] = useState<any[]>([]);
  const [recentParcels, setRecentParcels]   = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  // Estadísticas de uso de casilleros (equipos con lockers).
  const [lk, setLk] = useState({ total: 0, operativos: 0, ocupados: 0, entregas: 0, retiros: 0, avgMin: 0, hasLockers: false });

  useEffect(() => {
    const ts = rangeStart(dateFilter);
    const kiosk: Record<string, { total: number; operativos: number }> = {};
    const occ: Record<string, number> = {};
    const rng: Record<string, any[]> = {};
    let parcelUnsubs: (() => void)[] = [];

    const recompute = () => {
      const total = Object.values(kiosk).reduce((a, k) => a + k.total, 0);
      const operativos = Object.values(kiosk).reduce((a, k) => a + k.operativos, 0);
      const ocupados = Object.values(occ).reduce((a, b) => a + b, 0);
      const parcels = Object.values(rng).flat() as any[];
      const done = parcels.filter(p => p.status === 'picked_up' && p.pickedUpAt?.seconds && p.arrivedAt?.seconds);
      const avgMin = done.length
        ? Math.round(done.reduce((a, p) => a + (p.pickedUpAt.seconds - p.arrivedAt.seconds), 0) / done.length / 60)
        : 0;
      setLk({ total, operativos, ocupados, entregas: parcels.length, retiros: done.length, avgMin, hasLockers: total > 0 });
    };

    const unsubKiosks = onSnapshot(collection(db, 'kiosks'), snap => {
      parcelUnsubs.forEach(u => u()); parcelUnsubs = [];
      Object.keys(kiosk).forEach(k => delete kiosk[k]);
      const condosVistos = new Set<string>();
      snap.docs.forEach(kd => {
        const d = kd.data() as any;
        const lockers = Array.isArray(d.lockers) ? d.lockers : [];
        if (!lockers.length || !d.condoId) return;
        const cId = d.condoId as string;
        kiosk[cId] = {
          total: (kiosk[cId]?.total || 0) + lockers.length,
          operativos: (kiosk[cId]?.operativos || 0) + lockers.filter((l: any) => l.operativo !== false).length,
        };
        if (condosVistos.has(cId)) return;
        condosVistos.add(cId);
        parcelUnsubs.push(onSnapshot(
          query(collection(db, `condos/${cId}/parcels`), where('status', '==', 'pending')),
          s => { occ[cId] = s.docs.filter(x => x.data().lockerId).length; recompute(); }, () => {},
        ));
        parcelUnsubs.push(onSnapshot(
          query(collection(db, `condos/${cId}/parcels`), where('arrivedAt', '>=', ts)),
          s => { rng[cId] = s.docs.map(x => x.data()).filter((p: any) => p.lockerId); recompute(); }, () => {},
        ));
      });
      recompute();
    }, () => {});

    return () => { unsubKiosks(); parcelUnsubs.forEach(u => u()); };
  }, [dateFilter]);

  const fmtDur = (min: number) => min <= 0 ? '—' : min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;

  useEffect(() => {
    const ts = rangeStart(dateFilter);
    const unsubs: (() => void)[] = [];
    let parcelsUnsubs: (() => void)[] = [];
    const pendingParcelMap: Record<string, number> = {};
    const recentParcelMap: Record<string, any[]>   = {};

    unsubs.push(onSnapshot(collection(db, 'condos'), snap => {
      setCondosCount(snap.size);
      setLoading(false);
      parcelsUnsubs.forEach(u => u());
      parcelsUnsubs = [];

      snap.docs.forEach(cdoc => {
        const cId   = cdoc.id;
        const cName = (cdoc.data().name as string) || cId;

        parcelsUnsubs.push(onSnapshot(
          query(collection(db, `condos/${cId}/parcels`), where('status', '==', 'pending')),
          s => {
            pendingParcelMap[cId] = s.size;
            setPendingParcels(Object.values(pendingParcelMap).reduce((a, b) => a + b, 0));
          }
        ));

        parcelsUnsubs.push(onSnapshot(
          query(collection(db, `condos/${cId}/parcels`), where('arrivedAt', '>=', ts)),
          s => {
            recentParcelMap[cId] = s.docs.map(d => ({ id: d.id, condoName: cName, ...d.data() }));
            const all = Object.values(recentParcelMap).flat() as any[];
            all.sort((a, b) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
            setRecentParcels(all.slice(0, 5));
          }
        ));
      });
    }));

    unsubs.push(onSnapshot(collectionGroup(db, 'residents'), s => setResidentsCount(s.size)));

    unsubs.push(onSnapshot(
      query(collectionGroup(db, 'incidents'), where('status', 'in', ['open', 'pending', 'in_progress'])),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setOpenIncidents(list);
      }
    ));

    unsubs.push(onSnapshot(collectionGroup(db, 'visitors'), s => {
      const inRange = s.docs.filter(d => (d.data().createdAt?.seconds ?? 0) >= ts.seconds);
      setVisitorsInRange(inRange.length);
      const list = inRange.map(d => ({ id: d.id, ...d.data() })) as any[];
      list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setRecentVisitors(list.slice(0, 5));
    }));

    unsubs.push(onSnapshot(
      query(collectionGroup(db, 'expenses'), where('status', 'in', ['pending', 'overdue'])),
      s => setPendingExpenses(s.size)
    ));

    return () => { unsubs.forEach(u => u()); parcelsUnsubs.forEach(u => u()); };
  }, [dateFilter]);

  const fl = dateFilter === '1d' ? 'hoy' : 'últimos 7 días';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={Building2}     label="Condominios"         value={condosCount}          accent="brand"   loading={loading} onClick={() => navigate('/condos')} />
        <StatCard icon={Users}         label="Residentes"          value={residentsCount}       accent="indigo"  loading={loading} onClick={() => navigate('/residents')} />
        <StatCard icon={QrCode}        label={`Visitas ${fl}`}     value={visitorsInRange}      accent="success" loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={AlertTriangle} label="Incidentes activos"  value={openIncidents.length} accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={Package}       label="Encomiendas pend."   value={pendingParcels}       accent="warn"    loading={loading} onClick={() => navigate('/parcels')} />
        <StatCard icon={DollarSign}    label="Gastos pendientes"   value={pendingExpenses}      accent="purple"  loading={loading} onClick={() => navigate('/expenses')} />
      </div>

      {lk.hasLockers && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <LayoutGrid size={16} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Uso de casilleros</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard icon={LayoutGrid}   label="Ocupación"           value={`${lk.ocupados}/${lk.total}`}    accent="warn"    loading={loading} onClick={() => navigate('/parcels')} />
            <StatCard icon={Unlock}       label="Operativos"          value={`${lk.operativos}/${lk.total}`}  accent="success" loading={loading} />
            <StatCard icon={Package}      label={`Entregas ${fl}`}    value={lk.entregas}                     accent="brand"   loading={loading} onClick={() => navigate('/parcels')} />
            <StatCard icon={CheckCircle2} label={`Retiros ${fl}`}     value={lk.retiros}                      accent="indigo"  loading={loading} />
            <StatCard icon={Timer}        label="Tiempo prom. retiro" value={fmtDur(lk.avgMin)}               accent="purple"  loading={loading} />
          </div>
        </div>
      )}

      <PanelesMantencionGlobal dateFilter={dateFilter} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel title="Incidentes activos" onClick={() => navigate('/incidents')}>
          {openIncidents.length === 0
            ? <EmptyState icon={Activity} title="Sin incidentes activos" />
            : (
              <div className="space-y-2.5">
                {openIncidents.slice(0, 5).map((inc: any) => (
                  <ListRow
                    key={inc.id}
                    icon={AlertTriangle}
                    iconAccent={inc.priority === 'high' ? 'danger' : inc.priority === 'medium' ? 'warn' : 'brand'}
                    title={inc.description?.slice(0, 45) || 'Sin descripción'}
                    subtitle={`${inc.condoName || '—'} · ${fmtDate(inc.createdAt)}`}
                    right={<StatusBadge status={inc.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title={`Visitas ${fl}`} onClick={() => navigate('/visitors')}>
          {recentVisitors.length === 0
            ? <EmptyState icon={QrCode} title={`Sin visitas ${fl}`} />
            : (
              <div className="space-y-2.5">
                {recentVisitors.map((v: any) => (
                  <ListRow
                    key={v.id}
                    icon={QrCode}
                    iconAccent="purple"
                    title={v.visitorName || v.name || 'Visitante'}
                    subtitle={`${v.condoName || v.unit || '—'} · ${fmtDate(v.createdAt)}`}
                    right={<VisitorStatusBadge status={v.status || 'pending'} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title="Encomiendas recientes" onClick={() => navigate('/parcels')}>
          {recentParcels.length === 0
            ? <EmptyState icon={Package} title="Sin encomiendas recientes" />
            : (
              <div className="space-y-2.5">
                {recentParcels.map((p: any) => (
                  <ListRow
                    key={p.id}
                    icon={Package}
                    iconAccent={p.status === 'pending' ? 'warn' : 'success'}
                    title={p.courier ? `Paquete de ${p.courier}` : 'Encomienda en portería'}
                    subtitle={`${p.condoName || '—'} · ${fmtDate(p.arrivedAt)}`}
                    right={<StatusBadge status={p.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>
      </div>

      <AccessStats />

      <OnlineOperatorsWidget />
    </div>
  );
};

// ── CONDO ADMIN ───────────────────────────────────────────────────────────────

const CondoAdminView = ({ condoId, condoName, dateFilter }: { condoId: string; condoName: string; dateFilter: '1d' | '7d' }) => {
  const navigate = useNavigate();
  const [residentsCount, setResidentsCount]   = useState(0);
  const [openIncidents, setOpenIncidents]     = useState<any[]>([]);
  const [visitorsInRange, setVisitorsInRange] = useState(0);
  const [visitorsOnSite, setVisitorsOnSite]   = useState(0);
  const [pendingParcels, setPendingParcels]   = useState(0);
  const [pendingExpenses, setPendingExpenses] = useState(0);
  const [recentVisitors, setRecentVisitors]   = useState<any[]>([]);
  const [recentParcels, setRecentParcels]     = useState<any[]>([]);
  const [loading, setLoading]                 = useState(true);

  useEffect(() => {
    if (!condoId) return;
    const ts   = rangeStart(dateFilter);
    const base = `condos/${condoId}`;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, `${base}/residents`), s => { setResidentsCount(s.size); setLoading(false); }));

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/incidents`), where('status', 'in', ['open', 'pending', 'in_progress'])),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setOpenIncidents(list);
      }
    ));

    unsubs.push(onSnapshot(collection(db, `${base}/visitors`), s => {
      const all = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      const inRange = all.filter(v => (v.createdAt?.seconds ?? 0) >= ts.seconds);
      setVisitorsInRange(inRange.length);
      setVisitorsOnSite(all.filter(v => v.status === 'entered').length);
      setRecentVisitors(inRange.slice(0, 5));
    }));

    unsubs.push(onSnapshot(collection(db, `${base}/parcels`), s => {
      const all = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      setPendingParcels(all.filter(p => p.status === 'pending').length);
      const recent = all.filter(p => (p.arrivedAt?.seconds ?? 0) >= ts.seconds);
      recent.sort((a: any, b: any) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
      setRecentParcels(recent.slice(0, 5));
    }));

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/expenses`), where('status', 'in', ['pending', 'overdue'])),
      s => setPendingExpenses(s.size)
    ));

    return () => unsubs.forEach(u => u());
  }, [condoId, dateFilter]);

  const fl = dateFilter === '1d' ? 'hoy' : 'últimos 7 días';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon={Users}         label="Residentes"              value={residentsCount}       accent="indigo"  loading={loading} onClick={() => navigate('/residents')} />
        <StatCard icon={QrCode}        label={`Visitas ${fl}`}         value={visitorsInRange}      accent="success" loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={UserCheck}     label="En sitio ahora"          value={visitorsOnSite}       accent="brand"   loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={AlertTriangle} label="Incidentes activos"      value={openIncidents.length} accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={Package}       label="Encomiendas pendientes"  value={pendingParcels}       accent="warn"    loading={loading} onClick={() => navigate('/parcels')} />
      </div>

      {pendingExpenses > 0 && (
        <button onClick={() => navigate('/expenses')} className="w-full cursor-pointer text-left">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
            <DollarSign size={18} className="shrink-0" />
            <span className="text-sm font-semibold">
              {pendingExpenses} {pendingExpenses === 1 ? 'gasto común pendiente' : 'gastos comunes pendientes'} de cobro
            </span>
          </div>
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel title="Incidentes activos" onClick={() => navigate('/incidents')}>
          {openIncidents.length === 0
            ? <EmptyState icon={Activity} title="Sin incidentes activos" />
            : (
              <div className="space-y-2.5">
                {openIncidents.slice(0, 5).map((inc: any) => (
                  <ListRow
                    key={inc.id}
                    icon={AlertTriangle}
                    iconAccent={inc.priority === 'high' ? 'danger' : inc.priority === 'medium' ? 'warn' : 'brand'}
                    title={inc.description?.slice(0, 50) || 'Sin descripción'}
                    subtitle={`${inc.equipmentName || '—'} · ${fmtDate(inc.createdAt)}`}
                    right={<StatusBadge status={inc.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title={`Visitas ${fl}`} onClick={() => navigate('/visitors')}>
          {recentVisitors.length === 0
            ? <EmptyState icon={QrCode} title={`Sin visitas ${fl}`} />
            : (
              <div className="space-y-2.5">
                {recentVisitors.map((v: any) => (
                  <ListRow
                    key={v.id}
                    icon={QrCode}
                    iconAccent="purple"
                    title={v.visitorName || v.name || 'Visitante'}
                    subtitle={`Unidad ${v.unit || '—'} · ${fmtDate(v.createdAt)}`}
                    right={<VisitorStatusBadge status={v.status || 'pending'} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title="Encomiendas recientes" onClick={() => navigate('/parcels')}>
          {recentParcels.length === 0
            ? <EmptyState icon={Package} title="Sin encomiendas recientes" />
            : (
              <div className="space-y-2.5">
                {recentParcels.map((p: any) => (
                  <ListRow
                    key={p.id}
                    icon={Package}
                    iconAccent={p.status === 'pending' ? 'warn' : 'success'}
                    title={p.courier ? `Paquete de ${p.courier}` : 'Encomienda en portería'}
                    subtitle={`Unidad ${p.unit || '—'} · ${fmtDate(p.arrivedAt)}`}
                    right={<StatusBadge status={p.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>
      </div>

      <AccessStats />
    </div>
  );
};

// ── OPERATOR ──────────────────────────────────────────────────────────────────

const OperatorView = ({ condoId, dateFilter }: { condoId: string; dateFilter: '1d' | '7d' }) => {
  const navigate = useNavigate();
  const [activeVisitors, setActiveVisitors]   = useState<any[]>([]);
  const [openIncidents, setOpenIncidents]     = useState<any[]>([]);
  const [visitorsInRange, setVisitorsInRange] = useState(0);
  const [pendingParcels, setPendingParcels]   = useState(0);
  const [recentParcels, setRecentParcels]     = useState<any[]>([]);
  const [residentsCount, setResidentsCount]   = useState(0);
  const [loading, setLoading]                 = useState(true);

  useEffect(() => {
    if (!condoId) return;
    const ts     = rangeStart(dateFilter);
    const base   = `condos/${condoId}`;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, `${base}/residents`), s => { setResidentsCount(s.size); setLoading(false); }));

    unsubs.push(onSnapshot(collection(db, `${base}/visitors`), s => {
      const all = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setActiveVisitors(all.filter(v => v.status === 'pending' || v.status === 'entered').slice(0, 6));
      setVisitorsInRange(all.filter(v => (v.createdAt?.seconds ?? 0) >= ts.seconds).length);
    }));

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/incidents`), where('status', 'in', ['open', 'pending', 'in_progress'])),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setOpenIncidents(list.slice(0, 5));
      }
    ));

    unsubs.push(onSnapshot(collection(db, `${base}/parcels`), s => {
      const all = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      setPendingParcels(all.filter(p => p.status === 'pending').length);
      const recent = all.filter(p => (p.arrivedAt?.seconds ?? 0) >= ts.seconds);
      recent.sort((a: any, b: any) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
      setRecentParcels(recent.slice(0, 5));
    }));

    return () => unsubs.forEach(u => u());
  }, [condoId, dateFilter]);

  const fl = dateFilter === '1d' ? 'hoy' : '7 días';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Clock}         label="Visitas activas"        value={activeVisitors.length} accent="warn"    loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={UserCheck}     label={`Visitas ${fl}`}        value={visitorsInRange}       accent="success" loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={AlertTriangle} label="Incidentes activos"     value={openIncidents.length}  accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={Package}       label="Encomiendas pendientes" value={pendingParcels}        accent="indigo"  loading={loading} onClick={() => navigate('/parcels')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel
          title="Visitas activas"
          badge={activeVisitors.length > 0 && <Badge variant="warn">{activeVisitors.length}</Badge>}
          onClick={() => navigate('/visitors')}
        >
          {activeVisitors.length === 0
            ? <EmptyState icon={QrCode} title="No hay visitas activas" />
            : (
              <div className="space-y-2.5">
                {activeVisitors.map((v: any) => (
                  <ListRow
                    key={v.id}
                    icon={QrCode}
                    iconAccent={v.status === 'entered' ? 'success' : 'warn'}
                    title={v.visitorName || v.name || 'Visitante'}
                    subtitle={`Unidad ${v.unit || '—'} · ${fmtTime(v.createdAt)}`}
                    right={<VisitorStatusBadge status={v.status || 'pending'} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title="Incidentes activos" onClick={() => navigate('/incidents')}>
          {openIncidents.length === 0
            ? <EmptyState icon={Activity} title="Sin incidentes activos" />
            : (
              <div className="space-y-2.5">
                {openIncidents.map((inc: any) => (
                  <ListRow
                    key={inc.id}
                    icon={AlertTriangle}
                    iconAccent={inc.priority === 'high' ? 'danger' : inc.priority === 'medium' ? 'warn' : 'brand'}
                    title={inc.description?.slice(0, 50) || 'Sin descripción'}
                    subtitle={`${inc.equipmentName || '—'} · ${fmtDate(inc.createdAt)}`}
                    right={<StatusBadge status={inc.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title="Encomiendas pendientes" onClick={() => navigate('/parcels')}>
          {recentParcels.length === 0
            ? <EmptyState icon={Package} title="Sin encomiendas recientes" />
            : (
              <div className="space-y-2.5">
                {recentParcels.map((p: any) => (
                  <ListRow
                    key={p.id}
                    icon={Package}
                    iconAccent={p.status === 'pending' ? 'warn' : 'success'}
                    title={p.courier ? `Paquete de ${p.courier}` : 'Encomienda en portería'}
                    subtitle={`Unidad ${p.unit || '—'} · ${fmtDate(p.arrivedAt)}`}
                    right={<StatusBadge status={p.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>
      </div>
    </div>
  );
};

// ── TECHNICIAN ────────────────────────────────────────────────────────────────

/* ── Mantención: datos y paneles compartidos por Técnico y Super Admin ─────
   Las mismas métricas para los dos roles; sólo cambia el alcance de condominios
   que trae el perfil. */

// Ventanas de los rankings. Los filtros del dashboard (1d / 7d) son demasiado
// cortos para que un ranking de fallas signifique algo, así que estos paneles
// tienen su propio selector. 0 = histórico completo.
const RANGOS_RANKING = [[15, '15 días'], [30, '30 días'], [0, 'Histórico']] as const;
type RangoRanking = typeof RANGOS_RANKING[number][0];

// Disponibilidad de equipos, en porcentaje de equipos operativos.
// 95 % es el estándar comprometido; entre 85 y 95 está bajo estándar.
const DISP_OK     = 95;  // verde
const DISP_ALERTA = 85;  // ámbar; bajo esto, rojo

// El tipo declara 'Operativo' | 'Mantenimiento' | 'Falla', pero en producción hay
// registros antiguos con 'active'. Se normaliza para no contar como caído un equipo
// que sí funciona. Un estado desconocido NO se da por operativo a propósito: así el
// panel delata el dato malo en vez de taparlo.
const eqOperativo = (st: any) => {
  const v = String(st ?? '').toLowerCase();
  return v === 'operativo' || v === 'active';
};
const eqEnFalla = (st: any) => String(st ?? '').toLowerCase() === 'falla';

const fmtDur = (seg: number) => {
  if (!seg || seg <= 0) return '—';
  const d = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

/** Incidentes y equipos del alcance del perfil. Una sola suscripción por colección. */
function useMantencionData(profile: any) {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const isGlobal = profile?.condoScope === 'all';
    const condoIds: string[] = profile?.condoIds || [];
    const unsubs: (() => void)[] = [];

    // Incidentes: las reglas dejan al técnico leer todos, así que se filtra en
    // cliente cuando su alcance es acotado.
    const qInc = isGlobal || !profile?.condoId
      ? query(collectionGroup(db, 'incidents'))
      : query(collection(db, `condos/${profile.condoId}/incidents`));
    unsubs.push(onSnapshot(qInc, snap => {
      let all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      if (!isGlobal && condoIds.length) all = all.filter(i => condoIds.includes(i.condoId));
      all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setIncidents(all);
      setLoading(false);
    }, () => setLoading(false)));

    // Equipos: aquí las reglas NO tienen excepción para técnicos, así que la
    // consulta debe venir ya acotada (mismo patrón que la página Equipamiento).
    const qEq = isGlobal
      ? query(collectionGroup(db, 'equipment'))
      : condoIds.length
        ? query(collectionGroup(db, 'equipment'), where('condoId', 'in', condoIds.slice(0, 30)))
        : query(collection(db, `condos/${profile?.condoId || 'default'}/equipment`));
    unsubs.push(onSnapshot(qEq, snap => {
      setEquipment(snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]);
    }, () => { /* sin equipos cargados, los paneles muestran su estado vacío */ }));

    return () => unsubs.forEach(u => u());
  }, [profile?.condoScope, profile?.condoId, JSON.stringify(profile?.condoIds || [])]);

  return { incidents, equipment, loading };
}

/** Fila de barra: etiqueta, barra y valor. El valor va siempre escrito, así que
 *  la identidad nunca depende sólo del color. */
const BarraMetrica = ({ etiqueta, sub, valor, pct, tono, titulo }: {
  etiqueta: string; sub?: string; valor: string; pct: number;
  tono: 'ok' | 'alerta' | 'critico' | 'neutro'; titulo?: string;
}) => {
  const relleno = {
    ok:      'bg-emerald-500',
    alerta:  'bg-amber-500',
    critico: 'bg-red-500',
    neutro:  'bg-blue-500',
  }[tono];
  const texto = {
    ok:      'text-emerald-600 dark:text-emerald-400',
    alerta:  'text-amber-600 dark:text-amber-400',
    critico: 'text-red-600 dark:text-red-400',
    neutro:  'text-slate-700 dark:text-slate-200',
  }[tono];
  return (
    <div className="py-2" title={titulo}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
          {etiqueta}
          {sub && <span className="text-xs text-slate-400 dark:text-slate-500 ml-1.5">{sub}</span>}
        </p>
        <p className={cn('text-sm font-bold tabular-nums shrink-0', texto)}>{valor}</p>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
        <div className={cn('h-full rounded-full', relleno)}
             style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
};

const PanelesMantencion = ({ incidents, equipment, dateFilter, loading }: {
  incidents: any[]; equipment: any[]; dateFilter: '1d' | '7d'; loading: boolean;
}) => {
  const navigate = useNavigate();
  const [rangoRank, setRangoRank] = useState<RangoRanking>(30);
  const ahora   = Math.floor(Date.now() / 1000);
  const desde   = rangoRank === 0 ? 0 : ahora - rangoRank * 86400;
  const etiquetaRango = (RANGOS_RANKING.find(r => r[0] === rangoRank)?.[1] || '').toLowerCase();
  const tsRango = rangeStart(dateFilter).seconds;

  // ── Disponibilidad de equipos por condominio (foto de ahora) ──
  const porCondo = new Map<string, { nombre: string; total: number; ok: number }>();
  equipment.forEach(e => {
    const id = e.condoId || '—';
    const c = porCondo.get(id) || { nombre: e.condoName || 'Sin condominio', total: 0, ok: 0 };
    c.total++;
    if (eqOperativo(e.status)) c.ok++;
    porCondo.set(id, c);
  });
  const disponibilidad = [...porCondo.entries()]
    .map(([id, c]) => ({ id, ...c, pct: c.total ? (c.ok / c.total) * 100 : 0 }))
    .sort((a, b) => a.pct - b.pct); // lo peor primero: es lo accionable
  const totalEq   = equipment.length;
  const totalOk   = equipment.filter(e => eqOperativo(e.status)).length;
  const enFalla   = equipment.filter(e => eqEnFalla(e.status)).length;
  const dispGlobal = totalEq ? (totalOk / totalEq) * 100 : 0;

  // ── Tiempo medio de reparación, sobre lo cerrado en el rango elegido ──
  const cerrados = incidents.filter(i =>
    (i.status === 'closed' || i.status === 'resolved') &&
    (i.closedAt?.seconds ?? 0) >= tsRango &&
    (i.createdAt?.seconds ?? 0) > 0 &&
    (i.closedAt?.seconds ?? 0) > (i.createdAt?.seconds ?? 0));
  const mttr = cerrados.length
    ? Math.round(cerrados.reduce((a, i) => a + (i.closedAt.seconds - i.createdAt.seconds), 0) / cerrados.length)
    : 0;

  // ── Rankings sobre la ventana propia ──
  const enVentana = incidents.filter(i => (i.createdAt?.seconds ?? 0) >= desde);

  const porEquipo = new Map<string, { nombre: string; condo: string; n: number }>();
  enVentana.forEach(i => {
    const clave = i.equipmentId || i.equipmentName;
    if (!clave) return; // los incidentes sin equipo no entran al ranking de equipos
    const e = porEquipo.get(clave) || { nombre: i.equipmentName || 'Equipo sin nombre', condo: i.condoName || '', n: 0 };
    e.n++; porEquipo.set(clave, e);
  });
  const rankEquipos = [...porEquipo.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  const maxEquipo = rankEquipos[0]?.n || 1;

  const porCondoFallas = new Map<string, { nombre: string; n: number }>();
  enVentana.forEach(i => {
    const id = i.condoId || '—';
    const c = porCondoFallas.get(id) || { nombre: i.condoName || 'Sin condominio', n: 0 };
    c.n++; porCondoFallas.set(id, c);
  });
  const rankCondos = [...porCondoFallas.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  const maxCondo = rankCondos[0]?.n || 1;

  const tonoDisp = (p: number) => p >= DISP_OK ? 'ok' : p >= DISP_ALERTA ? 'alerta' : 'critico';
  const fl = dateFilter === '1d' ? 'hoy' : '7 días';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Activity}      label="Disponibilidad de equipos" value={totalEq ? `${dispGlobal.toFixed(1)}%` : '—'}
          accent={dispGlobal >= DISP_OK ? 'success' : dispGlobal >= DISP_ALERTA ? 'warn' : 'danger'}
          loading={loading} onClick={() => navigate('/equipment')} />
        <StatCard icon={Wrench}        label="Equipos en falla" value={enFalla}
          accent={enFalla > 0 ? 'danger' : 'success'} loading={loading} onClick={() => navigate('/equipment')} />
        <StatCard icon={Timer}         label={`Reparación promedio · ${fl}`} value={cerrados.length ? fmtDur(mttr) : '—'}
          accent="brand" loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={CheckCircle2}  label={`Incidentes cerrados · ${fl}`} value={cerrados.length}
          accent="success" loading={loading} onClick={() => navigate('/incidents')} />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Panel
          title="Disponibilidad por condominio"
          badge={<span className="text-xs text-slate-400 dark:text-slate-500">ahora · estándar {DISP_OK}%</span>}
          onClick={() => navigate('/equipment')}
        >
          {disponibilidad.length === 0
            ? <EmptyState icon={Building2} title="Sin equipos registrados"
                description="Cuando se carguen equipos, aquí verás qué porcentaje está operativo en cada condominio." />
            : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {disponibilidad.slice(0, 8).map(c => (
                  <BarraMetrica key={c.id}
                    etiqueta={c.nombre}
                    sub={`${c.ok}/${c.total} operativos`}
                    valor={`${c.pct.toFixed(0)}%`}
                    pct={c.pct}
                    tono={tonoDisp(c.pct)}
                    titulo={`${c.nombre}: ${c.ok} de ${c.total} equipos operativos`}
                  />
                ))}
              </div>
            )}
        </Panel>
      </div>

      {/* Los dos rankings comparten una sola ventana: un control, no dos. */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="flex items-center gap-2.5 text-slate-900 dark:text-white">
            <span className="w-1 h-5 bg-blue-500 rounded-full shrink-0" aria-hidden />
            Ranking de fallas
          </h3>
          <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl w-fit">
            {RANGOS_RANKING.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setRangoRank(k)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                  rangoRank === k
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
                )}
              >{label}</button>
            ))}
          </div>
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Equipos que más fallan"
          badge={<span className="text-xs text-slate-400 dark:text-slate-500">{etiquetaRango}</span>}
          onClick={() => navigate('/incidents')}
        >
          {rankEquipos.length === 0
            ? <EmptyState icon={Wrench} title="Sin fallas registradas"
                description={rangoRank === 0
                  ? 'Ningún incidente quedó asociado a un equipo.'
                  : `Ningún incidente de los últimos ${rangoRank} días quedó asociado a un equipo.`} />
            : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {rankEquipos.map((e, i) => (
                  <BarraMetrica key={`${e.nombre}-${i}`}
                    etiqueta={e.nombre}
                    sub={e.condo}
                    valor={`${e.n}`}
                    pct={(e.n / maxEquipo) * 100}
                    tono="neutro"
                    titulo={`${e.nombre}: ${e.n} incidente${e.n !== 1 ? 's' : ''} · ${etiquetaRango}`}
                  />
                ))}
              </div>
            )}
        </Panel>

        <Panel
          title="Condominios con más fallas"
          badge={<span className="text-xs text-slate-400 dark:text-slate-500">{etiquetaRango}</span>}
          onClick={() => navigate('/incidents')}
        >
        {rankCondos.length === 0
          ? <EmptyState icon={Building2} title="Sin incidentes en el período" />
          : (
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {rankCondos.map((c, i) => (
                <BarraMetrica key={`${c.nombre}-${i}`}
                  etiqueta={c.nombre}
                  valor={`${c.n}`}
                  pct={(c.n / maxCondo) * 100}
                  tono="neutro"
                  titulo={`${c.nombre}: ${c.n} incidente${c.n !== 1 ? 's' : ''} · ${etiquetaRango}`}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
      </div>
    </div>
  );
};

/** Los mismos paneles de mantención, con alcance global. Para super_admin. */
const PanelesMantencionGlobal = ({ dateFilter }: { dateFilter: '1d' | '7d' }) => {
  const { incidents, equipment, loading } = useMantencionData({ condoScope: 'all' });
  return <PanelesMantencion incidents={incidents} equipment={equipment} dateFilter={dateFilter} loading={loading} />;
};

const TechnicianView = ({ profile, dateFilter }: { profile: any; dateFilter: '1d' | '7d' }) => {
  const navigate = useNavigate();
  const { incidents: todos, equipment, loading } = useMantencionData(profile);

  const activos         = todos.filter(i => i.status !== 'closed' && i.status !== 'resolved');
  const incidents       = activos.slice(0, 8);
  const openCount       = activos.filter(i => i.status === 'open').length;
  const inProgressCount = activos.filter(i => i.status === 'in_progress').length;
  const fl              = dateFilter === '1d' ? 'hoy' : '7 días';
  const tsRango         = rangeStart(dateFilter).seconds;
  const closedInRange   = todos.filter(i =>
    (i.status === 'closed' || i.status === 'resolved') && (i.closedAt?.seconds ?? 0) >= tsRango).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Incidentes abiertos"   value={openCount}       accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={Timer}         label="En progreso"           value={inProgressCount} accent="warn"    loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={CheckCircle2}  label={`Cerrados ${fl}`}      value={closedInRange}   accent="success" loading={loading} onClick={() => navigate('/incidents')} />
      </div>

      <PanelesMantencion incidents={todos} equipment={equipment} dateFilter={dateFilter} loading={loading} />

      <Panel title="Incidentes asignados" onClick={() => navigate('/incidents')}>
        {incidents.length === 0
          ? <EmptyState icon={Wrench} title="Sin incidentes activos" />
          : (
            <div className="space-y-2.5">
              {incidents.map((inc: any) => (
                <ListRow
                  key={inc.id}
                  icon={Wrench}
                  iconAccent={inc.status === 'open' ? 'danger' : inc.status === 'in_progress' ? 'warn' : 'success'}
                  title={inc.description?.slice(0, 55) || 'Sin descripción'}
                  subtitle={`${inc.condoName || inc.equipmentName || '—'} · ${fmtDate(inc.createdAt)}`}
                  right={<StatusBadge status={inc.status} />}
                />
              ))}
            </div>
          )
        }
      </Panel>
    </div>
  );
};

// ── RESIDENT ──────────────────────────────────────────────────────────────────

const ResidentView = ({ profile, user }: { profile: any; user: any }) => {
  const navigate = useNavigate();
  const [myVisitors, setMyVisitors]         = useState<any[]>([]);
  const [myReservations, setMyReservations] = useState<any[]>([]);
  const [myParcels, setMyParcels]           = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [deletingRes, setDeletingRes]       = useState<any | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const condoId = profile?.condoId;

  const handleDeleteReservation = async () => {
    if (!deletingRes || !condoId) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, `condos/${condoId}/reservations`, deletingRes.id));
      setDeletingRes(null);
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!condoId || !user?.uid) return;
    const today = new Date().toISOString().slice(0, 10);
    const base  = `condos/${condoId}`;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/visitors`), where('userId', '==', user.uid)),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setMyVisitors(list.filter(v => v.status !== 'exited').slice(0, 5));
        setLoading(false);
      }
    ));

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/reservations`), where('userId', '==', user.uid)),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const upcoming = list.filter(r => r.date >= today && r.status !== 'cancelled').sort((a, b) => a.date > b.date ? 1 : -1);
        setMyReservations(upcoming.slice(0, 5));
      }
    ));

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/parcels`), where('residentUserId', '==', user.uid)),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        list.sort((a, b) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
        setMyParcels(list.slice(0, 5));
      }
    ));

    return () => unsubs.forEach(u => u());
  }, [condoId, user?.uid]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <StatCard compact icon={QrCode}   label="Mis visitas"  value={myVisitors.length}                                    accent="purple" loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard compact icon={Calendar} label="Reservas"     value={myReservations.length}                                accent="brand"  loading={loading} onClick={() => navigate('/facilities')} />
        <StatCard compact icon={Package}  label="Encomiendas"  value={myParcels.filter(p => p.status === 'pending').length} accent="warn"   loading={loading} onClick={() => navigate('/parcels')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="lg" onClick={() => navigate('/visitors')} hoverable className="cursor-pointer flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white">
              <span className="w-1 h-4 bg-purple-500 rounded-full shrink-0" aria-hidden />
              Mis pases de visita
            </h3>
            {myVisitors.length > 0 && <Badge variant="muted">{myVisitors.length}</Badge>}
          </div>
          {myVisitors.length === 0
            ? <p className="text-xs text-slate-400 dark:text-slate-500 pl-3.5">Sin pases generados aún</p>
            : (
              <div className="space-y-2">
                {myVisitors.map((v: any) => (
                  <ListRow key={v.id} icon={QrCode} iconAccent="purple"
                    title={v.visitorName || v.name || 'Visitante'}
                    subtitle={fmtDate(v.createdAt)}
                    right={<VisitorStatusBadge status={v.status || 'pending'} />}
                  />
                ))}
              </div>
            )
          }
        </Card>

        <Card padding="lg" onClick={() => navigate('/facilities')} hoverable className="cursor-pointer flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white">
              <span className="w-1 h-4 bg-blue-500 rounded-full shrink-0" aria-hidden />
              Mis próximas reservas
            </h3>
            {myReservations.length > 0 && <Badge variant="brand">{myReservations.length}</Badge>}
          </div>
          {myReservations.length === 0
            ? <p className="text-xs text-slate-400 dark:text-slate-500 pl-3.5">Sin reservas próximas</p>
            : (
              <div className="space-y-2">
                {myReservations.map((r: any) => (
                  <ListRow key={r.id} icon={Calendar} iconAccent="brand"
                    title={r.facilityName || 'Instalación'}
                    subtitle={`${r.date} · ${r.startTime}–${r.endTime}`}
                    right={
                      <button
                        onClick={e => { e.stopPropagation(); setDeletingRes(r); }}
                        aria-label="Eliminar reserva"
                        className="p-2 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    }
                  />
                ))}
              </div>
            )
          }
        </Card>

        <Card padding="lg" onClick={() => navigate('/parcels')} hoverable className="cursor-pointer flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white">
              <span className="w-1 h-4 bg-amber-500 rounded-full shrink-0" aria-hidden />
              Mis encomiendas
            </h3>
            {myParcels.filter(p => p.status === 'pending').length > 0 && (
              <Badge variant="warn">
                {myParcels.filter(p => p.status === 'pending').length} pendiente{myParcels.filter(p => p.status === 'pending').length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          {myParcels.length === 0
            ? <p className="text-xs text-slate-400 dark:text-slate-500 pl-3.5">Sin encomiendas recientes</p>
            : (
              <div className="space-y-2">
                {myParcels.map((p: any) => (
                  <ListRow key={p.id} icon={Package} iconAccent={p.status === 'pending' ? 'warn' : 'success'}
                    title={p.courier ? `Paquete de ${p.courier}` : 'Encomienda en portería'}
                    subtitle={`Llegó el ${fmtDate(p.arrivedAt)}`}
                    right={<StatusBadge status={p.status} />}
                  />
                ))}
              </div>
            )
          }
        </Card>
      </div>

      <Modal open={!!deletingRes} onClose={() => { if (!deleting) setDeletingRes(null); }} size="sm">
        <div className="text-center space-y-4 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Trash2 size={24} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Eliminar reserva?</h2>
            {deletingRes && (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300 font-medium mt-1">{deletingRes.facilityName}</p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                  {deletingRes.date} · {deletingRes.startTime}–{deletingRes.endTime}
                </p>
              </>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">El horario quedará disponible para otros residentes.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeletingRes(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="danger" icon={Trash2} onClick={handleDeleteReservation} loading={deleting}>Eliminar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ── main ──────────────────────────────────────────────────────────────────────

const Dashboard = () => {
  const { profile, user } = useAuth();
  const [dateFilter, setDateFilter] = useState<'1d' | '7d'>('1d');

  const greetingTime = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  };

  const roleLabel: Record<string, string> = {
    super_admin:   'Administrador global',
    condo_admin:   'Administrador de condominio',
    administrador: 'Administrador',
    operator:      'Operador de seguridad',
    technician:    'Técnico',
    resident:      'Residente',
  };

  const today      = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName  = profile?.name?.split(' ')[0] || 'Usuario';
  const showFilter = ['super_admin', 'condo_admin', 'administrador', 'operator', 'technician'].includes(profile?.role || '');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      className="max-w-7xl mx-auto"
    >
      <header className="mb-6 hidden lg:flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate">{greetingTime()}, {firstName}</h1>
          <p className="subtle mt-1 truncate">
            {roleLabel[profile?.role || ''] || profile?.role} · {profile?.condoName || 'Portería Virtual'}{profile?.unit ? ` · ${profile.unit}` : ''}
          </p>
        </div>
        <p className="hidden sm:block text-xs font-medium text-slate-500 dark:text-slate-400 capitalize shrink-0">{today}</p>
      </header>

      {showFilter && <QuickFilter value={dateFilter} onChange={setDateFilter} />}

      {profile?.role === 'super_admin' && <SuperAdminView dateFilter={dateFilter} />}
      {(profile?.role === 'condo_admin' || profile?.role === 'administrador') && (
        <CondoAdminView condoId={profile.condoId || ''} condoName={profile.condoName || ''} dateFilter={dateFilter} />
      )}
      {profile?.role === 'operator'   && <OperatorView   condoId={profile.condoId || ''} dateFilter={dateFilter} />}
      {profile?.role === 'technician' && <TechnicianView profile={profile}               dateFilter={dateFilter} />}
      {profile?.role === 'resident'   && <ResidentView   profile={profile} user={user} />}
    </motion.div>
  );
};

export default Dashboard;
