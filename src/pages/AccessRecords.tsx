import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { motion } from 'motion/react';
import DahuaService, { DahuaAccessRecord, DahuaHistoryVisitor, DahuaVehicleRecord } from '../services/DahuaService';
import {
  ClipboardList, RefreshCw, Search, User, Building2, Home,
  LogIn, LogOut, AlertCircle, ChevronLeft, ChevronRight, Calendar, Car, BarChart2,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Badge, Spinner, EmptyState } from '../components/ui';
import { cn } from '../lib/utils';
import AccessReports from './AccessReports';

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

// ─── pagination component ─────────────────────────────────────────────────────

const Pagination = ({ page, totalPages, total, pageSize, onPage }: {
  page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void;
}) => {
  if (totalPages <= 1) return null;
  const pages: (number | '...')[] = [];
  if (totalPages <= 9) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 4) pages.push('...');
    const lo = Math.max(2, page - 2);
    const hi = Math.min(totalPages - 1, page + 2);
    for (let i = lo; i <= hi; i++) pages.push(i);
    if (page < totalPages - 3) pages.push('...');
    pages.push(totalPages);
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Registros {((page - 1) * pageSize + 1).toLocaleString('es-CL')}–{Math.min(page * pageSize, total).toLocaleString('es-CL')} de{' '}
        <span className="font-bold text-slate-700 dark:text-slate-300">{total.toLocaleString('es-CL')}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)} disabled={page === 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        ><ChevronLeft size={15} /></button>
        {pages.map((p, idx) =>
          p === '...'
            ? <span key={`e${idx}`} className="w-8 text-center text-xs text-slate-400">…</span>
            : (
              <button
                key={p}
                onClick={() => onPage(p as number)}
                className={cn(
                  'w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer',
                  p === page
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5',
                )}
              >{p}</button>
            )
        )}
        <button
          onClick={() => onPage(page + 1)} disabled={page >= totalPages}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        ><ChevronRight size={15} /></button>
      </div>
    </div>
  );
};

// ─── component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const AccessRecords = () => {
  const [activeTab, setActiveTab]   = useState<'access' | 'visitors' | 'vehicles' | 'reports'>('access');
  const [dateRange, setDateRange]   = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(1);

  const [condoFilter, setCondoFilter] = useState('');
  // Cache keys: skip re-fetch when only the page changes (all tabs are now client-side paged)
  const accessFetchKeyRef  = useRef('');
  const visitorFetchKeyRef = useRef('');
  const vehicleFetchKeyRef = useRef('');

  const [accessRecords, setAccessRecords]   = useState<DahuaAccessRecord[]>([]);
  const [visitorRecords, setVisitorRecords] = useState<DahuaHistoryVisitor[]>([]);
  const [vehicleRecords, setVehicleRecords] = useState<DahuaVehicleRecord[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Firestore: dahuaPersonId → {unit, condoName}
  const [personMap, setPersonMap] = useState<Record<string, { unit: string; condoName: string }>>({});
  // Firestore: displayName → condoName (for visitor host lookup)
  const [hostCondoMap, setHostCondoMap] = useState<Record<string, string>>({});
  // DSS: personId → {orgName, orgCode, roomNo} for residents not yet in Firestore
  const [dssPersonMap, setDssPersonMap] = useState<Record<string, { orgName: string; orgCode: string; roomNo: string }>>({});
  // DSS: personName → orgName for visitor host lookup
  const [dssNameMap, setDssNameMap] = useState<Record<string, string>>({});

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

  // DSS channels — channelId → zone name
  const [channelZoneMap, setChannelZoneMap] = useState<Record<string, string>>({});

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
    const { startTime, endTime } = getTimeRange();

    // All three tabs fetch all records at once (chunked queries) and paginate client-side.
    // Skip the API call when only the page changed.
    if (activeTab === 'reports') return;
    const key = `${dateRange}-${customFrom}-${customTo}-${search}-${startTime}`;
    if (activeTab === 'access'   && accessFetchKeyRef.current  === key && accessRecords.length  > 0) return;
    if (activeTab === 'visitors' && visitorFetchKeyRef.current === key && visitorRecords.length > 0) return;
    if (activeTab === 'vehicles' && vehicleFetchKeyRef.current === key && vehicleRecords.length > 0) return;

    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'access') {
        const result = await DahuaService.listAccessRecords({ startTime, endTime, personName: search });
        accessFetchKeyRef.current = key;
        setAccessRecords(result.list);
      } else if (activeTab === 'visitors') {
        const result = await DahuaService.listVisitorHistory({ startTime, endTime, visitorName: search });
        visitorFetchKeyRef.current = key;
        setVisitorRecords(result.list);
      } else if (activeTab === 'vehicles') {
        const result = await DahuaService.listVehicleEnterRecords({
          page: 1, pageSize: 5000, startTime, endTime, plateNo: search,
        });
        vehicleFetchKeyRef.current = key;
        setVehicleRecords(result.list);
      }

      // Load DSS enrichment maps after auth is established — run in background, only once
      if (Object.keys(channelZoneMap).length === 0) {
        DahuaService.listAccessChannels().then(channels => {
          const m: Record<string, string> = {};
          for (const ch of channels) if (ch.id) m[ch.id] = ch.orgName;
          setChannelZoneMap(m);
        }).catch(() => {});
      }
      if (Object.keys(dssPersonMap).length === 0) {
        DahuaService.listPersons(2000).then(({ list }) => {
          const byId: Record<string, { orgName: string; orgCode: string; roomNo: string }> = {};
          const byName: Record<string, string> = {};
          for (const p of list) {
            if (p.id) byId[p.id] = { orgName: p.orgName || '', orgCode: p.orgCode || '', roomNo: p.roomNo || '' };
            if (p.personName) byName[p.personName] = p.orgName || '';
          }
          setDssPersonMap(byId);
          setDssNameMap(byName);
        }).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || 'Error al conectar con Dahua DSS');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when tab or date range changes (page changes are handled client-side)
  useEffect(() => { fetchData(); }, [activeTab, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset condo filter whenever the active tab changes
  useEffect(() => { setCondoFilter(''); }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => { setPage(1); fetchData(); };

  // ── Condo filter (client-side) ─────────────────────────────────────────────
  const condoOptions = useMemo(() => {
    const set = new Set<string>();
    if (activeTab === 'access') {
      accessRecords.forEach(r => {
        const c = channelZoneMap[r.channelId || ''] || r.orgName || '';
        if (c && c !== '—') set.add(c);
      });
    } else if (activeTab === 'visitors') {
      visitorRecords.forEach(v => {
        const c = dssNameMap[v.visitedName] || hostCondoMap[v.visitedName] || '';
        if (c && c !== '—') set.add(c);
      });
    } else if (activeTab === 'vehicles') {
      vehicleRecords.forEach(r => {
        const c = r.orgName || r.parkingLot || '';
        if (c && c !== '—') set.add(c);
      });
    }
    return [...set].sort();
  }, [activeTab, accessRecords, visitorRecords, vehicleRecords, channelZoneMap, dssNameMap, hostCondoMap]);

  const filteredAccess = condoFilter
    ? accessRecords.filter(r => (channelZoneMap[r.channelId || ''] || r.orgName || '') === condoFilter)
    : accessRecords;
  const filteredVisitors = condoFilter
    ? visitorRecords.filter(v => (dssNameMap[v.visitedName] || hostCondoMap[v.visitedName] || '') === condoFilter)
    : visitorRecords;
  const filteredVehicles = condoFilter
    ? vehicleRecords.filter(r => (r.orgName || r.parkingLot || '') === condoFilter)
    : vehicleRecords;

  // All tabs fetch all records client-side and paginate locally
  const effectiveTotal      = activeTab === 'visitors' ? filteredVisitors.length
                            : activeTab === 'vehicles' ? filteredVehicles.length
                            : filteredAccess.length;
  const effectiveTotalPages = Math.max(1, Math.ceil(effectiveTotal / PAGE_SIZE));
  const pagedAccess    = filteredAccess.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedVisitors  = filteredVisitors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedVehicles  = filteredVehicles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
          { key: 'access'   as const, label: 'Accesos',    icon: LogIn     },
          { key: 'visitors' as const, label: 'Visitantes', icon: User      },
          { key: 'vehicles' as const, label: 'Patentes',   icon: Car       },
          { key: 'reports'  as const, label: 'Informes',   icon: BarChart2 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => {
              setActiveTab(key);
              setPage(1);
            }}
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

      {/* Informes tab — renders its own UI */}
      {activeTab === 'reports' && (
        <AccessReports
          personMap={personMap}
          hostCondoMap={hostCondoMap}
          dssPersonMap={dssPersonMap}
          dssNameMap={dssNameMap}
        />
      )}

      {/* Filters + Content — hidden on reports tab */}
      {activeTab !== 'reports' && (<><Card variant="glass" padding="sm">
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

          {/* Condo filter */}
          {condoOptions.length > 0 && (
            <select
              value={condoFilter}
              onChange={e => setCondoFilter((e.target as HTMLSelectElement).value)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="">Condominio</option>
              {condoOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <Input
              type="text"
              placeholder={activeTab === 'access' ? 'Buscar por nombre…' : activeTab === 'visitors' ? 'Buscar visitante…' : 'Buscar patente…'}
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
            pagedAccess.length === 0 ? (
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
                      {pagedAccess.map((rec: DahuaAccessRecord, i: number) => {
                        // Normalise: try exact id, then strip leading zeros, then zero-pad to 8
                        const pid  = rec.personId || '';
                        const pidN = pid ? String(Number(pid)) : '';          // "00022860" → "22860"
                        const pidP = pid ? pid.padStart(8, '0') : '';         // "22860"    → "00022860"
                        const person    = personMap[pid] ?? personMap[pidN] ?? personMap[pidP] ?? null;
                        const dssPerson = dssPersonMap[pid] ?? dssPersonMap[pidN] ?? dssPersonMap[pidP] ?? null;
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
                                {person?.unit || dssPerson?.roomNo || dssPerson?.orgName || rec.personGroup || '—'}
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
            pagedVisitors.length === 0 ? (
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
                      {pagedVisitors.map((vis: DahuaHistoryVisitor, i: number) => {
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
                                {dssNameMap[vis.visitedName] || hostCondoMap[vis.visitedName] || '—'}
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

          {/* ── VEHICLE / PLATE RECORDS TABLE ───────────────────────── */}
          {activeTab === 'vehicles' && (
            pagedVehicles.length === 0 ? (
              <EmptyState
                icon={Car}
                title="Sin registros vehiculares"
                description="No hay accesos vehiculares en el período seleccionado."
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        {['Patente', 'Nombre', 'Hora de Ingreso', 'Condominio', 'Unidad'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {pagedVehicles.map((rec: DahuaVehicleRecord, i: number) => {
                        const condo = rec.orgName || rec.parkingLot || '—';
                        const unit  = rec.personGroup || '—';
                        return (
                          <tr key={rec.id || i} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-3.5">
                              <span className="flex items-center gap-2">
                                <Car size={13} className="text-slate-400 shrink-0" />
                                <span className="font-bold text-slate-800 dark:text-white tracking-widest">{rec.plateNo || rec.recognizedPlateNo || '—'}</span>
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="flex items-center gap-2">
                                <User size={13} className="text-slate-400 shrink-0" />
                                <span className="font-semibold text-slate-800 dark:text-white whitespace-nowrap">{rec.personName || '—'}</span>
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 font-mono text-xs whitespace-nowrap">
                              {fmtDateTime(rec.enterTime)}
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">
                              <span className="flex items-center gap-1 whitespace-nowrap">
                                <Building2 size={11} className="text-slate-400 shrink-0" />
                                {condo}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">
                              <span className="flex items-center gap-1">
                                <Home size={11} className="text-blue-400 shrink-0" />
                                {unit}
                              </span>
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
          <Pagination page={page} totalPages={effectiveTotalPages} total={effectiveTotal} pageSize={PAGE_SIZE} onPage={p => setPage(p)} />
        </>
      )}
      </>)}
    </motion.div>
  );
};

export default AccessRecords;
