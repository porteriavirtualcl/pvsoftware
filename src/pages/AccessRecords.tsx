import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { motion } from 'motion/react';
import DahuaService, { DahuaAccessRecord, DahuaHistoryVisitor } from '../services/DahuaService';
import {
  ClipboardList, RefreshCw, Search, User, Building2, Home,
  LogIn, LogOut, AlertCircle, ChevronLeft, ChevronRight, Calendar,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Badge, Spinner, EmptyState } from '../components/ui';
import { cn } from '../lib/utils';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const date = d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date} ${time}`;
}

function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function fmtTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function VisitorStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'warn' | 'danger' | 'muted' }> = {
    '0':  { label: 'Agendado',       variant: 'warn' },
    '1':  { label: 'En instalación', variant: 'success' },
    '2':  { label: 'Salió',          variant: 'muted' },
    '-1': { label: 'Cancelado',      variant: 'danger' },
  };
  const s = map[status] ?? { label: `Estado ${status}`, variant: 'muted' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// ─── component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const AccessRecords = () => {
  const [activeTab, setActiveTab]   = useState<'access' | 'visitors'>('access');
  const [dateRange, setDateRange]   = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(1);

  const [accessRecords, setAccessRecords]   = useState<DahuaAccessRecord[]>([]);
  const [visitorRecords, setVisitorRecords] = useState<DahuaHistoryVisitor[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [total, setTotal]       = useState(0);

  // Firestore: dahuaPersonId → {unit, condoName}
  const [personMap, setPersonMap] = useState<Record<string, { unit: string; condoName: string }>>({});
  // Firestore: displayName → condoName (for visitor host lookup)
  const [hostCondoMap, setHostCondoMap] = useState<Record<string, string>>({});
  // DSS: personId → {orgName, orgCode} for residents not yet in Firestore
  const [dssPersonMap, setDssPersonMap] = useState<Record<string, { orgName: string; orgCode: string }>>({});

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', 'in', ['resident', 'usuario']));
    const unsub = onSnapshot(q, snap => {
      const pMap: Record<string, { unit: string; condoName: string }> = {};
      const hMap: Record<string, string> = {};
      for (const d of snap.docs) {
        const data = d.data();
        if (data.dahuaPersonId) {
          pMap[data.dahuaPersonId] = { unit: data.unit || '—', condoName: data.condoName || '—' };
        }
        if (data.displayName && data.condoName) {
          hMap[data.displayName] = data.condoName;
        }
      }
      setPersonMap(pMap);
      setHostCondoMap(hMap);
    });
    return () => unsub();
  }, []);

  // DSS persons — personId → {orgName} for residents not in Firestore
  useEffect(() => {
    DahuaService.listPersons(2000).then(({ list }) => {
      const map: Record<string, { orgName: string; orgCode: string }> = {};
      for (const p of list) {
        if (p.id) map[p.id] = { orgName: p.orgName || '', orgCode: p.orgCode || '' };
      }
      setDssPersonMap(map);
    }).catch(() => {});
  }, []);

  // DSS channels — channelId → zone name (the "Zone" column in DSS export)
  const [channelZoneMap, setChannelZoneMap] = useState<Record<string, string>>({});
  useEffect(() => {
    DahuaService.listAccessChannels().then(channels => {
      const map: Record<string, string> = {};
      for (const ch of channels) {
        if (ch.id) map[ch.id] = ch.orgName;
      }
      setChannelZoneMap(map);
    }).catch(() => {});
  }, []);

  const getTimeRange = () => {
    const now = Math.floor(Date.now() / 1000);
    if (dateRange === '1d') return { startTime: Math.floor(new Date().setHours(0, 0, 0, 0) / 1000), endTime: now };
    if (dateRange === '7d') return { startTime: now - 7 * 86400, endTime: now };
    if (dateRange === '30d') return { startTime: now - 30 * 86400, endTime: now };
    const from = customFrom ? Math.floor(new Date(customFrom + 'T00:00:00').getTime() / 1000) : now - 7 * 86400;
    const to   = customTo   ? Math.floor(new Date(customTo   + 'T23:59:59').getTime() / 1000) : now;
    return { startTime: from, endTime: to };
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { startTime, endTime } = getTimeRange();
      if (activeTab === 'access') {
        const result = await DahuaService.listAccessRecords({
          page, pageSize: PAGE_SIZE, startTime, endTime, personName: search,
        });
        setAccessRecords(result.list);
        setTotal(result.total);
      } else {
        const result = await DahuaService.listVisitorHistory({
          page, pageSize: PAGE_SIZE, startTime, endTime, visitorName: search,
        });
        setVisitorRecords(result.list);
        setTotal(result.total);
      }
    } catch (err: any) {
      setError(err.message || 'Error al conectar con Dahua DSS');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when tab, page or preset date range changes
  useEffect(() => { fetchData(); }, [activeTab, page, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => { setPage(1); fetchData(); };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

      {/* Header */}
      <PageHeader
        icon={ClipboardList}
        title="Registros de Acceso"
        description="Historial de accesos y visitas desde Dahua DSS Pro."
        actions={
          <Button variant="secondary" icon={RefreshCw} onClick={() => { setPage(1); fetchData(); }} loading={loading}>
            Actualizar
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl w-fit">
        {([
          { key: 'access'   as const, label: 'Accesos',    icon: LogIn },
          { key: 'visitors' as const, label: 'Visitantes', icon: User  },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setPage(1); }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer',
              activeTab === key
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card variant="glass" padding="sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date quick-select */}
          <div className="flex gap-1">
            {([
              { k: '1d',     label: 'Hoy'     },
              { k: '7d',     label: '7 días'  },
              { k: '30d',    label: '30 días' },
              { k: 'custom', label: 'Rango'   },
            ] as const).map(({ k, label }) => (
              <button
                key={k}
                onClick={() => { setDateRange(k); setPage(1); }}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                  dateRange === k
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Custom range inputs */}
          {dateRange === 'custom' && (
            <>
              <Calendar size={14} className="text-slate-400 shrink-0" />
              <input
                type="date" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500"
              />
              <span className="text-slate-400 text-sm">→</span>
              <input
                type="date" value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500"
              />
              <Button onClick={() => { setPage(1); fetchData(); }}>Buscar</Button>
            </>
          )}

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <Input
              type="text"
              placeholder={activeTab === 'access' ? 'Buscar por nombre…' : 'Buscar visitante…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
              className="pl-9 py-1.5 text-sm w-52"
            />
          </div>
          <Button variant="secondary" icon={Search} onClick={handleSearch}>Buscar</Button>
        </div>
      </Card>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={40} /></div>
      ) : error ? (
        <Card variant="glass">
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircle className="text-red-400" size={40} />
            <p className="text-red-500 font-semibold">Error al conectar con DSS Pro</p>
            <p className="text-slate-500 text-sm max-w-sm">{error}</p>
            <Button variant="secondary" icon={RefreshCw} onClick={() => { setPage(1); fetchData(); }}>
              Reintentar
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* ── ACCESS RECORDS TABLE ─────────────────────────────────────── */}
          {activeTab === 'access' && (
            accessRecords.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="Sin registros de acceso"
                description="No hay eventos en el período seleccionado."
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        {['Access Point', 'Tiempo', 'Persona', 'Unidad', 'Condominio', 'Dirección'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {accessRecords.map((rec: DahuaAccessRecord, i: number) => {
                        const person    = personMap[rec.personId] ?? null;
                        const dssPerson = dssPersonMap[rec.personId] ?? null;
                        return (
                          <tr key={rec.id || i} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-3.5">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 whitespace-nowrap">
                                {rec.channelName || rec.eventTypeDesc || '—'}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 font-mono text-xs whitespace-nowrap">
                              {fmtDateTime(rec.accessTime)}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="flex items-center gap-2">
                                <User size={13} className="text-slate-400 shrink-0" />
                                <span className="font-semibold text-slate-800 dark:text-white whitespace-nowrap">{rec.personName || '—'}</span>
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">
                              <span className="flex items-center gap-1">
                                <Home size={11} className="text-blue-400 shrink-0" />
                                {rec.personGroup || dssPerson?.orgName || person?.unit || '—'}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">
                              <span className="flex items-center gap-1 whitespace-nowrap">
                                <Building2 size={11} className="text-slate-400 shrink-0" />
                                {channelZoneMap[rec.channelId || ''] || rec.orgName || person?.condoName || '—'}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              {rec.direction === 'in' && (
                                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                  <LogIn size={12} />Ingreso
                                </span>
                              )}
                              {rec.direction === 'out' && (
                                <span className="flex items-center gap-1 text-xs font-semibold text-rose-500 dark:text-rose-400 whitespace-nowrap">
                                  <LogOut size={12} />Salida
                                </span>
                              )}
                              {!rec.direction && <span className="text-slate-400 text-xs">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}

          {/* ── VISITOR RECORDS TABLE ────────────────────────────────────── */}
          {activeTab === 'visitors' && (
            visitorRecords.length === 0 ? (
              <EmptyState
                icon={User}
                title="Sin registros de visitantes"
                description="No hay visitas en el período seleccionado."
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        {['Visitante', 'Anfitrión', 'Condominio', 'Fecha', 'Hora Ingreso', 'Hora Salida', 'Patente', 'Estado'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {visitorRecords.map((vis, i) => {
                        const displayTs = vis.arrivalTime || vis.expectArrivalTime;
                        return (
                          <tr key={vis.id || i} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-3.5">
                              <span className="flex items-center gap-2">
                                <User size={13} className="text-slate-400 shrink-0" />
                                <span className="font-semibold text-slate-800 dark:text-white whitespace-nowrap">{vis.visitorName}</span>
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {vis.visitedName}
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              <span className="flex items-center gap-1">
                                <Building2 size={11} className="text-slate-400 shrink-0" />
                                {hostCondoMap[vis.visitedName] || '—'}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 font-mono text-xs whitespace-nowrap">
                              {fmtDate(displayTs)}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                <LogIn size={11} />
                                {vis.arrivalTime
                                  ? fmtTime(vis.arrivalTime)
                                  : <span className="text-slate-400">{fmtTime(vis.expectArrivalTime)} <span className="font-sans text-[10px]">(prog.)</span></span>}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="flex items-center gap-1.5 text-xs font-mono text-rose-500 dark:text-rose-400 whitespace-nowrap">
                                <LogOut size={11} />
                                {vis.leaveTime
                                  ? fmtTime(vis.leaveTime)
                                  : <span className="text-slate-400">{fmtTime(vis.expectLeaveTime)} <span className="font-sans text-[10px]">(prog.)</span></span>}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 font-mono text-xs whitespace-nowrap">
                              {vis.plateNo || '—'}
                            </td>
                            <td className="px-5 py-3.5">
                              <VisitorStatusBadge status={vis.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 px-1">
              <span>
                {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} de {total} registros
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  icon={ChevronLeft}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Anterior
                </Button>
                <Button
                  variant="secondary"
                  icon={ChevronRight}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};

export default AccessRecords;
