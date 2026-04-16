import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, collectionGroup, query, where,
  onSnapshot, orderBy, Timestamp, limit, deleteDoc, doc
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Users, ShieldAlert, Clock, CheckCircle2, Package, QrCode,
  Building2, Calendar, AlertTriangle, Wrench,
  TrendingUp, TrendingDown, ArrowUpRight, Activity, Bell,
  UserCheck, XCircle, Timer, Trash2
} from 'lucide-react';
import { motion } from 'motion/react';

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

const Kpi = ({
  icon: Icon, label, value, sub, color, loading,
}: {
  icon: any; label: string; value: string | number; sub?: string; color: string; loading?: boolean;
}) => (
  <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 relative overflow-hidden group hover:border-blue-500/30 transition-all shadow-sm dark:shadow-none">
    <div className={`absolute -top-6 -right-6 w-24 h-24 ${color}/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700`} />
    <div className="flex items-start justify-between mb-4 relative">
      <div className={`w-11 h-11 ${color}/10 rounded-xl flex items-center justify-center`}>
        <Icon size={20} className={color.replace('bg-', 'text-')} />
      </div>
    </div>
    <div className="relative">
      <p className="text-[10px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-[0.2em] mb-1">{label}</p>
      {loading
        ? <div className="h-7 w-16 bg-slate-200 dark:bg-gray-800 rounded-lg animate-pulse" />
        : <h3 className="text-2xl font-black text-slate-900 dark:text-white italic tracking-tight">{value}</h3>
      }
      {sub && <p className="text-[10px] text-slate-400 dark:text-gray-600 font-bold mt-1 uppercase tracking-widest">{sub}</p>}
    </div>
  </div>
);

const Panel = ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => (
  <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 sm:p-8 shadow-sm dark:shadow-none">
    <h3 className="text-base font-black text-slate-900 dark:text-white mb-6 flex items-center gap-3 uppercase italic tracking-tight">
      <div className="w-1.5 h-5 bg-blue-500 rounded-full shrink-0" />
      {title}
    </h3>
    {children}
  </div>
);

const EmptyState = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-gray-600">
    <Activity size={32} className="mb-3 opacity-40" />
    <p className="text-xs font-black uppercase tracking-widest">{label}</p>
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    open: 'bg-red-500/10 text-red-400 border-red-500/20',
    pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    closed: 'bg-green-500/10 text-green-400 border-green-500/20',
    approved: 'bg-green-500/10 text-green-400 border-green-500/20',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
    cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    paid: 'bg-green-500/10 text-green-400 border-green-500/20',
    overdue: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const labels: Record<string, string> = {
    open: 'Abierto', pending: 'Pendiente', in_progress: 'En Progreso',
    closed: 'Cerrado', approved: 'Aprobado', rejected: 'Rechazado',
    cancelled: 'Cancelado', paid: 'Pagado', overdue: 'Vencido',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${map[status] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
      {labels[status] || status}
    </span>
  );
};

// ── role views ────────────────────────────────────────────────────────────────

// SUPER ADMIN
const SuperAdminView = () => {
  const [condosCount, setCondosCount] = useState(0);
  const [residentsCount, setResidentsCount] = useState(0);
  const [openIncidents, setOpenIncidents] = useState<any[]>([]);
  const [visitorsToday, setVisitorsToday] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ts = todayStart();
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, 'condos'), snap => {
      setCondosCount(snap.size);
      setLoading(false);
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

    return () => unsubs.forEach(u => u());
  }, []);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Building2} label="Condominios" value={condosCount} color="bg-blue-500" loading={loading} />
        <Kpi icon={Users} label="Residentes" value={residentsCount} sub="Total registrados" color="bg-indigo-500" loading={loading} />
        <Kpi icon={AlertTriangle} label="Incidentes Activos" value={openIncidents.length} sub="Abiertos + en progreso" color="bg-red-500" loading={loading} />
        <Kpi icon={QrCode} label="Visitas Hoy" value={visitorsToday} sub="Pases generados" color="bg-green-500" loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Incidentes Activos">
          {openIncidents.length === 0
            ? <EmptyState label="Sin incidentes activos" />
            : (
              <div className="space-y-3">
                {openIncidents.slice(0, 6).map((inc: any) => (
                  <div key={inc.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-slate-900 dark:text-white text-sm truncate">{inc.description?.slice(0, 50) || 'Sin descripción'}</p>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-widest mt-0.5">{inc.condoName || '—'} · {fmtDate(inc.createdAt)}</p>
                    </div>
                    <div className="ml-3 shrink-0">
                      <StatusBadge status={inc.status} />
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </Panel>

        <Panel title="Condominios Registrados">
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
  if (condos.length === 0) return <EmptyState label="Sin condominios" />;
  return (
    <div className="space-y-3">
      {condos.slice(0, 6).map((c: any) => (
        <div key={c.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
          <div className="w-9 h-9 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-500 shrink-0">
            <Building2 size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-white text-sm truncate italic uppercase">{c.name}</p>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest truncate">{c.address}</p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {c.expensesEnabled && (
              <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[9px] font-black uppercase rounded-full border border-blue-500/20">Gastos</span>
            )}
            {(c.dahuaChannelIds?.length ?? 0) > 0 && (
              <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-[9px] font-black uppercase rounded-full border border-green-500/20">ACS</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// CONDO ADMIN
const CondoAdminView = ({ condoId, condoName }: { condoId: string; condoName: string }) => {
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
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Users} label="Residentes" value={residentsCount} color="bg-indigo-500" loading={loading} />
        <Kpi icon={AlertTriangle} label="Incidentes" value={openIncidents.length} sub="Activos" color="bg-red-500" loading={loading} />
        <Kpi icon={QrCode} label="Visitas Hoy" value={visitorsToday} color="bg-green-500" loading={loading} />
        <Kpi icon={Package} label="Instalaciones" value={facilitiesCount} color="bg-purple-500" loading={loading} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Incidentes Activos">
          {openIncidents.length === 0 ? <EmptyState label="Sin incidentes activos" /> : (
            <div className="space-y-3">
              {openIncidents.slice(0, 5).map((inc: any) => (
                <div key={inc.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm truncate">{inc.description?.slice(0, 50) || 'Sin descripción'}</p>
                    <p className="text-[10px] text-gray-500 font-bold uppercase mt-0.5">{inc.equipmentName || '—'} · {fmtDate(inc.createdAt)}</p>
                  </div>
                  <div className="ml-3 shrink-0"><StatusBadge status={inc.status} /></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Visitas Recientes">
          {recentVisitors.length === 0 ? <EmptyState label="Sin visitas registradas" /> : (
            <div className="space-y-3">
              {recentVisitors.map((v: any) => (
                <div key={v.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                  <div className="w-9 h-9 bg-purple-600/10 rounded-xl flex items-center justify-center text-purple-400 shrink-0"><QrCode size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm truncate">{v.visitorName || v.name || 'Visitante'}</p>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-widest">{v.unit || '—'} · {fmtDate(v.createdAt)}</p>
                  </div>
                  <StatusBadge status={v.status || 'pending'} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

// OPERATOR
const OperatorView = ({ condoId }: { condoId: string }) => {
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
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Clock} label="Visitas Pendientes" value={pendingVisitors.length} sub="Por autorizar" color="bg-yellow-500" loading={loading} />
        <Kpi icon={UserCheck} label="Aprobadas Hoy" value={approvedToday} color="bg-green-500" loading={loading} />
        <Kpi icon={AlertTriangle} label="Incidentes" value={openIncidents.length} sub="Activos" color="bg-red-500" loading={loading} />
        <Kpi icon={Users} label="Residentes" value={residentsCount} color="bg-indigo-500" loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title={<>Visitas Pendientes <span className="text-yellow-400 ml-1">{pendingVisitors.length > 0 ? `(${pendingVisitors.length})` : ''}</span></>}>
          {pendingVisitors.length === 0 ? <EmptyState label="No hay visitas pendientes" /> : (
            <div className="space-y-3">
              {pendingVisitors.map((v: any) => (
                <div key={v.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                  <div className="w-9 h-9 bg-yellow-500/10 rounded-xl flex items-center justify-center text-yellow-400 shrink-0"><QrCode size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm truncate">{v.visitorName || v.name || 'Visitante'}</p>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-widest">Unidad {v.unit || '—'} · {fmtTime(v.createdAt)}</p>
                  </div>
                  <span className="text-[10px] font-black text-yellow-400 uppercase bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 rounded-full shrink-0">Pendiente</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Incidentes Activos">
          {openIncidents.length === 0 ? <EmptyState label="Sin incidentes activos" /> : (
            <div className="space-y-3">
              {openIncidents.map((inc: any) => (
                <div key={inc.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm truncate">{inc.description?.slice(0, 50) || 'Sin descripción'}</p>
                    <p className="text-[10px] text-gray-500 font-bold uppercase mt-0.5">{inc.equipmentName || '—'} · {fmtDate(inc.createdAt)}</p>
                  </div>
                  <div className="ml-3 shrink-0"><StatusBadge status={inc.status} /></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

// TECHNICIAN
const TechnicianView = ({ profile }: { profile: any }) => {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [closedMonth, setClosedMonth] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ms = monthStart();
    const isGlobal = profile?.condoScope === 'all';
    const condoId = profile?.condoId;

    let q;
    if (isGlobal) {
      q = query(collectionGroup(db, 'incidents'));
    } else {
      q = condoId
        ? query(collection(db, `condos/${condoId}/incidents`))
        : query(collectionGroup(db, 'incidents'));
    }

    const unsub = onSnapshot(q, s => {
      let all = s.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // filter to assigned condos if multi-scope
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
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi icon={AlertTriangle} label="Incidentes Abiertos" value={openCount} sub="Sin asignar" color="bg-red-500" loading={loading} />
        <Kpi icon={Timer} label="En Progreso" value={inProgressCount} color="bg-yellow-500" loading={loading} />
        <Kpi icon={CheckCircle2} label="Cerrados este mes" value={closedMonth} color="bg-green-500" loading={loading} />
      </div>

      <Panel title="Mis Incidentes Asignados">
        {incidents.length === 0 ? <EmptyState label="Sin incidentes activos" /> : (
          <div className="space-y-3">
            {incidents.map((inc: any) => (
              <div key={inc.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  inc.status === 'open' ? 'bg-red-500/10 text-red-400' :
                  inc.status === 'in_progress' ? 'bg-yellow-500/10 text-yellow-400' :
                  'bg-green-500/10 text-green-400'
                }`}>
                  <Wrench size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900 dark:text-white text-sm truncate">{inc.description?.slice(0, 55) || 'Sin descripción'}</p>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-widest mt-0.5">
                    {inc.condoName || inc.equipmentName || '—'} · {fmtDate(inc.createdAt)}
                  </p>
                </div>
                <div className="shrink-0"><StatusBadge status={inc.status} /></div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

// RESIDENT
const ResidentView = ({ profile, user }: { profile: any; user: any }) => {
  const [myVisitors, setMyVisitors] = useState<any[]>([]);
  const [myReservations, setMyReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingRes, setDeletingRes] = useState<any | null>(null);
  const condoId = profile?.condoId;

  const handleDeleteReservation = async () => {
    if (!deletingRes || !condoId) return;
    try {
      await deleteDoc(doc(db, `condos/${condoId}/reservations`, deletingRes.id));
      setDeletingRes(null);
    } catch (e) {
      console.error(e);
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

    return () => unsubs.forEach(u => u());
  }, [condoId, user?.uid]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4">
        <Kpi icon={QrCode} label="Mis Visitas" value={myVisitors.length} sub="Pases emitidos" color="bg-purple-500" loading={loading} />
        <Kpi icon={Calendar} label="Reservas" value={myReservations.length} sub="Próximas" color="bg-blue-500" loading={loading} />
      </div>

      <div className="bg-white dark:bg-gray-900 border border-blue-500/20 rounded-3xl p-6 flex items-center gap-5 shadow-sm dark:shadow-none">
        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shrink-0">
          <Building2 size={26} />
        </div>
        <div>
          <p className="text-[10px] font-black text-blue-600 dark:text-blue-500 uppercase tracking-widest mb-0.5">Mi Condominio</p>
          <h4 className="text-xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight">{profile?.condoName || 'Sin asignar'}</h4>
          {profile?.unit && <p className="text-xs text-slate-500 dark:text-gray-400 font-bold uppercase tracking-widest mt-0.5">Unidad {profile.unit}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Mis Pases de Visita">
          {myVisitors.length === 0 ? <EmptyState label="No has generado pases aún" /> : (
            <div className="space-y-3">
              {myVisitors.map((v: any) => (
                <div key={v.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                  <div className="w-9 h-9 bg-purple-600/10 rounded-xl flex items-center justify-center text-purple-400 shrink-0"><QrCode size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm truncate">{v.visitorName || v.name || 'Visitante'}</p>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-widest">{fmtDate(v.createdAt)}</p>
                  </div>
                  <StatusBadge status={v.status || 'pending'} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Mis Próximas Reservas">
          {myReservations.length === 0 ? <EmptyState label="No tienes reservas próximas" /> : (
            <div className="space-y-3">
              {myReservations.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-gray-800/50 rounded-2xl border border-slate-200 dark:border-gray-700/50">
                  <div className="w-9 h-9 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-400 shrink-0"><Calendar size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm truncate">{r.facilityName || 'Instalación'}</p>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-widest">{r.date} · {r.startTime}–{r.endTime}</p>
                  </div>
                  <button
                    onClick={() => setDeletingRes(r)}
                    className="p-2 rounded-xl text-slate-400 dark:text-gray-500 hover:bg-red-500/10 hover:text-red-500 transition-all shrink-0"
                    title="Eliminar reserva"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Delete reservation confirm modal */}
      {deletingRes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-md" onClick={() => setDeletingRes(null)} />
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="relative w-full max-w-sm bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-8 shadow-2xl text-center space-y-5">
            <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mx-auto">
              <Trash2 size={26} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white italic uppercase mb-1">¿Eliminar Reserva?</h3>
              <p className="text-slate-500 dark:text-gray-400 text-sm font-bold">{deletingRes.facilityName}</p>
              <p className="text-slate-400 dark:text-gray-500 text-xs mt-1">{deletingRes.date} · {deletingRes.startTime}–{deletingRes.endTime}</p>
              <p className="text-xs text-slate-400 dark:text-gray-600 mt-3">El horario quedará disponible para otros residentes.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setDeletingRes(null)}
                className="py-3 bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-white rounded-2xl font-black text-sm hover:bg-slate-200 dark:hover:bg-gray-700 transition-all">
                Cancelar
              </button>
              <button onClick={handleDeleteReservation}
                className="py-3 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-black text-sm shadow-lg shadow-red-600/20 transition-all">
                Eliminar
              </button>
            </div>
          </motion.div>
        </div>
      )}
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
    super_admin: 'Administrador Global',
    condo_admin: 'Administrador de Condominio',
    operator: 'Operador de Seguridad',
    technician: 'Técnico',
    resident: 'Residente',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="max-w-7xl mx-auto">
      {/* Greeting */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight italic uppercase">
            {greetingTime()}, {profile?.name?.split(' ')[0] || 'Usuario'} 👋
          </h2>
          <p className="text-xs text-slate-500 dark:text-gray-500 font-bold mt-1 uppercase tracking-widest">
            {roleLabel[profile?.role || ''] || profile?.role} · {profile?.condoName || 'Portería Virtual'}
          </p>
        </div>
        <div className="hidden sm:flex flex-col items-end shrink-0">
          <p className="text-xs text-slate-400 dark:text-gray-600 font-bold uppercase tracking-widest">
            {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {profile?.role === 'super_admin' && <SuperAdminView />}
      {profile?.role === 'condo_admin' && (
        <CondoAdminView condoId={profile.condoId || ''} condoName={profile.condoName || ''} />
      )}
      {profile?.role === 'operator' && <OperatorView condoId={profile.condoId || ''} />}
      {profile?.role === 'technician' && <TechnicianView profile={profile} />}
      {profile?.role === 'resident' && <ResidentView profile={profile} user={user} />}
    </motion.div>
  );
};

export default Dashboard;
