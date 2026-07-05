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
  BarChart3, TrendingUp, UserRound,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Card, StatCard, Badge, EmptyState, Modal, Button } from '../components/ui';
import { cn } from '../lib/utils';
import { authedFetch } from '../lib/apiBase';
import { useNavigate } from 'react-router-dom';
import { isOnlineNow } from '../hooks/usePresence';

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

  const online = operators.filter(op => isOnlineNow(op));

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

// Barras verticales apiladas (alturas CSS, responsivas). rows en orden de eje X.
const StackedBars = ({ rows, labelFor, tickEvery = 1 }: {
  rows: StatBucket[]; labelFor: (i: number) => string; tickEvery?: number;
}) => {
  const max = Math.max(1, ...rows.map(sumB));
  return (
    <div>
      <div className="flex items-end gap-[3px] h-40">
        {rows.map((r, i) => {
          const total = sumB(r);
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end min-w-0 cursor-default"
                 title={`${labelFor(i)} · ${total} ingresos  (residentes ${r.resident} · QR ${r.qr} · operador ${r.operator})`}>
              <div className="flex flex-col gap-[1.5px] rounded-t-[3px] overflow-hidden transition-opacity hover:opacity-80"
                   style={{ height: `${(total / max) * 100}%`, minHeight: total ? 2 : 0 }}>
                {/* orden visual: residente abajo (base) → QR → operador arriba */}
                {r.operator > 0 && <div style={{ flexGrow: r.operator }} className="bg-[#eda100] dark:bg-[#c98500]" />}
                {r.qr > 0 && <div style={{ flexGrow: r.qr }} className="bg-[#1baf7a] dark:bg-[#199e70]" />}
                {r.resident > 0 && <div style={{ flexGrow: r.resident }} className="bg-[#2a78d6] dark:bg-[#3987e5]" />}
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
            <StackedBars rows={data.byHour} tickEvery={3} labelFor={i => `${String(i).padStart(2, '0')}h`} />
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

const TechnicianView = ({ profile, dateFilter }: { profile: any; dateFilter: '1d' | '7d' }) => {
  const navigate = useNavigate();
  const [incidents, setIncidents]         = useState<any[]>([]);
  const [closedInRange, setClosedInRange] = useState(0);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    const ts        = rangeStart(dateFilter);
    const isGlobal  = profile?.condoScope === 'all';
    const condoId   = profile?.condoId;

    const q = isGlobal
      ? query(collectionGroup(db, 'incidents'))
      : condoId
        ? query(collection(db, `condos/${condoId}/incidents`))
        : query(collectionGroup(db, 'incidents'));

    const unsub = onSnapshot(q, s => {
      let all = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      if (!isGlobal && profile?.condoIds?.length) {
        all = all.filter(i => profile.condoIds.includes(i.condoId));
      }
      all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setIncidents(all.filter(i => i.status !== 'closed').slice(0, 8));
      setClosedInRange(all.filter(i => i.status === 'closed' && (i.closedAt?.seconds ?? 0) >= ts.seconds).length);
      setLoading(false);
    });

    return () => unsub();
  }, [profile, dateFilter]);

  const openCount       = incidents.filter(i => i.status === 'open').length;
  const inProgressCount = incidents.filter(i => i.status === 'in_progress').length;
  const fl              = dateFilter === '1d' ? 'hoy' : '7 días';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Incidentes abiertos"   value={openCount}       accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={Timer}         label="En progreso"           value={inProgressCount} accent="warn"    loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={CheckCircle2}  label={`Cerrados ${fl}`}      value={closedInRange}   accent="success" loading={loading} onClick={() => navigate('/incidents')} />
      </div>

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
