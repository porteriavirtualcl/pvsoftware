import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, collectionGroup, query, where,
  onSnapshot, Timestamp, deleteDoc, doc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Users, Clock, CheckCircle2, Package, QrCode,
  Building2, Calendar, AlertTriangle, Wrench,
  Activity, UserCheck, Timer, Trash2, type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Card, StatCard, Badge, EmptyState, Modal, Button } from '../components/ui';
import { cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

// ── helpers ──────────────────────────────────────────────────────────────────

const todayStart = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
};

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

// ── shared components ─────────────────────────────────────────────────────────

const Panel = ({ title, badge, children, onClick }: { title: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; onClick?: () => void; }) => (
  <Card 
    padding="lg" 
    onClick={onClick}
    hoverable={!!onClick}
    className={cn(onClick && 'cursor-pointer')}
  >
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
  };
  const entry = map[status] || { variant: 'muted' as const, label: status };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
};

// Generic row used across list panels
type ListRowProps = {
  key?: React.Key;
  icon?: LucideIcon;
  iconAccent?: 'brand' | 'indigo' | 'purple' | 'success' | 'warn' | 'danger';
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
};
const ListRow = ({
  icon: Icon, iconAccent = 'brand', title, subtitle, right,
}: ListRowProps) => {
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

// ── role views ────────────────────────────────────────────────────────────────

// SUPER ADMIN
const SuperAdminView = () => {
  const navigate = useNavigate();
  const [condosCount, setCondosCount] = useState(0);
  const [residentsCount, setResidentsCount] = useState(0);
  const [openIncidents, setOpenIncidents] = useState<any[]>([]);
  const [visitorsToday, setVisitorsToday] = useState(0);
  const [pendingParcels, setPendingParcels] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ts = todayStart();
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, 'condos'), snap => {
      setCondosCount(snap.size);
      setLoading(false);
      
      // Since collectionGroup('parcels') is restricted by rules, we calculate pending parcels by listening to all condo collections manually.
      let totalPending = 0;
      const parcelsUnsubs: (() => void)[] = [];
      const pendingMap: Record<string, number> = {};

      snap.docs.forEach(doc => {
        const u = onSnapshot(
          query(collection(db, `condos/${doc.id}/parcels`), where('status', '==', 'pending')),
          pSnap => {
            pendingMap[doc.id] = pSnap.size;
            setPendingParcels(Object.values(pendingMap).reduce((a, b) => a + b, 0));
          }
        );
        parcelsUnsubs.push(u);
      });

      // We add a cleanup function to outer unsubs array that cleans up inner listeners.
      unsubs.push(() => parcelsUnsubs.forEach(u => u()));
    }));

    unsubs.push(onSnapshot(collectionGroup(db, 'residents'), snap => {
      setResidentsCount(snap.size);
    }));

    unsubs.push(onSnapshot(
      query(collectionGroup(db, 'incidents'), where('status', 'in', ['open', 'pending', 'in_progress'])),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setOpenIncidents(list);
      }
    ));

    unsubs.push(onSnapshot(collectionGroup(db, 'visitors'), snap => {
      const today = snap.docs.filter(d => {
        const ct = d.data().createdAt;
        return ct && ct.seconds >= ts.seconds;
      });
      setVisitorsToday(today.length);
    }));

    // Previous code ends here

    return () => unsubs.forEach(u => u());
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Building2}     label="Condominios"       value={condosCount}         accent="brand"   loading={loading} onClick={() => navigate('/condos')} />
        <StatCard icon={Users}         label="Residentes"        value={residentsCount}      accent="indigo"  loading={loading} onClick={() => navigate('/residents')} />
        <StatCard icon={AlertTriangle} label="Incidentes activos"value={openIncidents.length}accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={QrCode}        label="Visitas hoy"       value={visitorsToday}       accent="success" loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={Package}       label="Encomiendas"       value={pendingParcels}      accent="warn"    loading={loading} onClick={() => navigate('/parcels')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Incidentes activos" onClick={() => navigate('/incidents')}>
          {openIncidents.length === 0
            ? <EmptyState icon={Activity} title="Sin incidentes activos" />
            : (
              <div className="space-y-2.5">
                {openIncidents.slice(0, 6).map((inc: any) => (
                  <ListRow
                    key={inc.id}
                    icon={AlertTriangle}
                    iconAccent="danger"
                    title={inc.description?.slice(0, 50) || 'Sin descripción'}
                    subtitle={`${inc.condoName || '—'} · ${fmtDate(inc.createdAt)}`}
                    right={<StatusBadge status={inc.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title="Condominios registrados" onClick={() => navigate('/condos')}>
          <CondosSummary />
        </Panel>
      </div>
    </div>
  );
};

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
    <div className="space-y-2.5">
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

// CONDO ADMIN
const CondoAdminView = ({ condoId }: { condoId: string; condoName: string }) => {
  const navigate = useNavigate();
  const [residentsCount, setResidentsCount] = useState(0);
  const [openIncidents, setOpenIncidents] = useState<any[]>([]);
  const [visitorsToday, setVisitorsToday] = useState(0);
  const [facilitiesCount, setFacilitiesCount] = useState(0);
  const [recentVisitors, setRecentVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!condoId) return;
    const ts = todayStart();
    const base = `condos/${condoId}`;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, `${base}/residents`), s => { setResidentsCount(s.size); setLoading(false); }));
    unsubs.push(onSnapshot(collection(db, `${base}/facilities`), s => setFacilitiesCount(s.size)));

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
      setVisitorsToday(all.filter(v => v.createdAt?.seconds >= ts.seconds).length);
      setRecentVisitors(all.slice(0, 5));
    }));

    return () => unsubs.forEach(u => u());
  }, [condoId]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users}         label="Residentes"   value={residentsCount}       accent="indigo"  loading={loading} onClick={() => navigate('/residents')} />
        <StatCard icon={AlertTriangle} label="Incidentes"   value={openIncidents.length} accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={QrCode}        label="Visitas hoy"  value={visitorsToday}        accent="success" loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={Package}       label="Instalaciones"value={facilitiesCount}      accent="purple"  loading={loading} onClick={() => navigate('/facilities')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Incidentes activos" onClick={() => navigate('/incidents')}>
          {openIncidents.length === 0
            ? <EmptyState icon={Activity} title="Sin incidentes activos" />
            : (
              <div className="space-y-2.5">
                {openIncidents.slice(0, 5).map((inc: any) => (
                  <ListRow
                    key={inc.id}
                    icon={AlertTriangle}
                    iconAccent="danger"
                    title={inc.description?.slice(0, 50) || 'Sin descripción'}
                    subtitle={`${inc.equipmentName || '—'} · ${fmtDate(inc.createdAt)}`}
                    right={<StatusBadge status={inc.status} />}
                  />
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title="Visitas recientes" onClick={() => navigate('/visitors')}>
          {recentVisitors.length === 0
            ? <EmptyState icon={QrCode} title="Sin visitas registradas" />
            : (
              <div className="space-y-2.5">
                {recentVisitors.map((v: any) => (
                  <ListRow
                    key={v.id}
                    icon={QrCode}
                    iconAccent="purple"
                    title={v.visitorName || v.name || 'Visitante'}
                    subtitle={`${v.unit || '—'} · ${fmtDate(v.createdAt)}`}
                    right={<StatusBadge status={v.status || 'pending'} />}
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

// OPERATOR
const OperatorView = ({ condoId }: { condoId: string }) => {
  const navigate = useNavigate();
  const [pendingVisitors, setPendingVisitors] = useState<any[]>([]);
  const [openIncidents, setOpenIncidents] = useState<any[]>([]);
  const [approvedToday, setApprovedToday] = useState(0);
  const [residentsCount, setResidentsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!condoId) return;
    const ts = todayStart();
    const base = `condos/${condoId}`;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, `${base}/residents`), s => { setResidentsCount(s.size); setLoading(false); }));

    unsubs.push(onSnapshot(collection(db, `${base}/visitors`), s => {
      const all = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setPendingVisitors(all.filter(v => v.status === 'pending').slice(0, 6));
      setApprovedToday(all.filter(v => v.status === 'approved' && v.createdAt?.seconds >= ts.seconds).length);
    }));

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/incidents`), where('status', 'in', ['open', 'pending', 'in_progress'])),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setOpenIncidents(list.slice(0, 5));
      }
    ));

    return () => unsubs.forEach(u => u());
  }, [condoId]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Clock}         label="Visitas pendientes" value={pendingVisitors.length} accent="warn"    loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={UserCheck}     label="Aprobadas hoy"      value={approvedToday}           accent="success" loading={loading} onClick={() => navigate('/visitors')} />
        <StatCard icon={AlertTriangle} label="Incidentes"         value={openIncidents.length}    accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={Users}         label="Residentes"         value={residentsCount}          accent="indigo"  loading={loading} onClick={() => navigate('/residents')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel
          title="Visitas pendientes"
          badge={pendingVisitors.length > 0 && <Badge variant="warn">{pendingVisitors.length}</Badge>}
          onClick={() => navigate('/visitors')}
        >
          {pendingVisitors.length === 0
            ? <EmptyState icon={QrCode} title="No hay visitas pendientes" />
            : (
              <div className="space-y-2.5">
                {pendingVisitors.map((v: any) => (
                  <ListRow
                    key={v.id}
                    icon={QrCode}
                    iconAccent="warn"
                    title={v.visitorName || v.name || 'Visitante'}
                    subtitle={`Unidad ${v.unit || '—'} · ${fmtTime(v.createdAt)}`}
                    right={<Badge variant="warn">Pendiente</Badge>}
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
                    iconAccent="danger"
                    title={inc.description?.slice(0, 50) || 'Sin descripción'}
                    subtitle={`${inc.equipmentName || '—'} · ${fmtDate(inc.createdAt)}`}
                    right={<StatusBadge status={inc.status} />}
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

// TECHNICIAN
const TechnicianView = ({ profile }: { profile: any }) => {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<any[]>([]);
  const [closedMonth, setClosedMonth] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ms = monthStart();
    const isGlobal = profile?.condoScope === 'all';
    const condoId = profile?.condoId;

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
      const open = all.filter(i => i.status !== 'closed');
      const closed = all.filter(i => i.status === 'closed' && i.closedAt?.seconds >= ms.seconds);
      setIncidents(open.slice(0, 8));
      setClosedMonth(closed.length);
      setLoading(false);
    });

    return () => unsub();
  }, [profile]);

  const openCount = incidents.filter(i => i.status === 'open').length;
  const inProgressCount = incidents.filter(i => i.status === 'in_progress').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Incidentes abiertos" value={openCount}       accent="danger"  loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={Timer}         label="En progreso"         value={inProgressCount} accent="warn"    loading={loading} onClick={() => navigate('/incidents')} />
        <StatCard icon={CheckCircle2}  label="Cerrados este mes"   value={closedMonth}     accent="success" loading={loading} onClick={() => navigate('/incidents')} />
      </div>

      <Panel title="Mis incidentes asignados" onClick={() => navigate('/incidents')}>
        {incidents.length === 0
          ? <EmptyState icon={Wrench} title="Sin incidentes activos" />
          : (
            <div className="space-y-2.5">
              {incidents.map((inc: any) => (
                <ListRow
                  key={inc.id}
                  icon={Wrench}
                  iconAccent={
                    inc.status === 'open' ? 'danger' :
                    inc.status === 'in_progress' ? 'warn' :
                    'success'
                  }
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

// RESIDENT
const ResidentView = ({ profile, user }: { profile: any; user: any }) => {
  const navigate = useNavigate();
  const [myVisitors, setMyVisitors] = useState<any[]>([]);
  const [myReservations, setMyReservations] = useState<any[]>([]);
  const [myParcels, setMyParcels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingRes, setDeletingRes] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    const base = `condos/${condoId}`;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(
      query(collection(db, `${base}/visitors`), where('userId', '==', user.uid)),
      s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setMyVisitors(list.slice(0, 5));
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

      {/* 3 detail panels — same design, compact when empty */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Mis pases de visita */}
        <Card padding="lg" onClick={() => navigate('/visitors')} hoverable className="cursor-pointer flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white">
              <span className="w-1 h-4 bg-purple-500 rounded-full shrink-0" aria-hidden />
              Mis pases de visita
            </h3>
            {myVisitors.length > 0 && (
              <Badge variant="muted">{myVisitors.length}</Badge>
            )}
          </div>
          {myVisitors.length === 0
            ? <p className="text-xs text-slate-400 dark:text-slate-500 pl-3.5">Sin pases generados aún</p>
            : (
              <div className="space-y-2">
                {myVisitors.map((v: any) => (
                  <ListRow
                    key={v.id}
                    icon={QrCode}
                    iconAccent="purple"
                    title={v.visitorName || v.name || 'Visitante'}
                    subtitle={fmtDate(v.createdAt)}
                    right={<StatusBadge status={v.status || 'pending'} />}
                  />
                ))}
              </div>
            )
          }
        </Card>

        {/* Mis próximas reservas */}
        <Card padding="lg" onClick={() => navigate('/facilities')} hoverable className="cursor-pointer flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white">
              <span className="w-1 h-4 bg-blue-500 rounded-full shrink-0" aria-hidden />
              Mis próximas reservas
            </h3>
            {myReservations.length > 0 && (
              <Badge variant="brand">{myReservations.length}</Badge>
            )}
          </div>
          {myReservations.length === 0
            ? <p className="text-xs text-slate-400 dark:text-slate-500 pl-3.5">Sin reservas próximas</p>
            : (
              <div className="space-y-2">
                {myReservations.map((r: any) => (
                  <ListRow
                    key={r.id}
                    icon={Calendar}
                    iconAccent="brand"
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

        {/* Mis encomiendas */}
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
                  <ListRow
                    key={p.id}
                    icon={Package}
                    iconAccent={p.status === 'pending' ? 'warn' : 'success'}
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

      {/* Delete reservation confirm modal */}
      <Modal
        open={!!deletingRes}
        onClose={() => { if (!deleting) setDeletingRes(null); }}
        size="sm"
      >
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
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
              El horario quedará disponible para otros residentes.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeletingRes(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="danger" icon={Trash2} onClick={handleDeleteReservation} loading={deleting}>
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ── main component ────────────────────────────────────────────────────────────

const Dashboard = () => {
  const { profile, user } = useAuth();

  const greetingTime = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  };

  const roleLabel: Record<string, string> = {
    super_admin: 'Administrador global',
    condo_admin:   'Administrador de condominio',
    administrador: 'Administrador',
    operator:      'Operador de seguridad',
    technician:  'Técnico',
    resident:    'Residente',
  };

  const today = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = profile?.name?.split(' ')[0] || 'Usuario';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      className="max-w-7xl mx-auto"
    >
      {/* Greeting — hidden on mobile (shown in top header bar) */}
      <header className="mb-6 hidden lg:flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate">{greetingTime()}, {firstName}</h1>
          <p className="subtle mt-1 truncate">
            {roleLabel[profile?.role || ''] || profile?.role} · {profile?.condoName || 'Portería Virtual'}{profile?.unit ? ` · ${profile.unit}` : ''}
          </p>
        </div>
        <p className="hidden sm:block text-xs font-medium text-slate-500 dark:text-slate-400 capitalize shrink-0">
          {today}
        </p>
      </header>

      {profile?.role === 'super_admin' && <SuperAdminView />}
      {(profile?.role === 'condo_admin' || profile?.role === 'administrador') && (
        <CondoAdminView condoId={profile.condoId || ''} condoName={profile.condoName || ''} />
      )}
      {profile?.role === 'operator'   && <OperatorView condoId={profile.condoId || ''} />}
      {profile?.role === 'technician' && <TechnicianView profile={profile} />}
      {profile?.role === 'resident'   && <ResidentView profile={profile} user={user} />}
    </motion.div>
  );
};

export default Dashboard;
