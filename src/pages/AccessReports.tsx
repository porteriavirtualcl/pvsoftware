import React, { useState, useRef } from 'react';
import DahuaService, { DahuaVehicleRecord } from '../services/DahuaService';
import { Button, Card, Spinner } from '../components/ui';
import { api, authedFetch } from '../lib/apiBase';
import {
  BarChart2, Download, TrendingUp, Users, Car,
  Building2, Clock, User, Calendar,
} from 'lucide-react';
import { cn } from '../lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

interface Props {
  personMap:   Record<string, { unit: string; condoName: string }>;
  hostCondoMap: Record<string, string>;
  dssPersonMap: Record<string, { orgName: string; orgCode: string; roomNo: string }>;
  dssNameMap:   Record<string, string>;
  // Restricción por condominio: si está presente, solo se reportan los registros
  // cuyos condominios (normalizados) estén en este set. null/undefined = todos.
  allowedCondoNorms?: Set<string> | null;
}

const normCondoR = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

type ReportId =
  | 'summary'
  | 'access_by_condo'
  | 'visits_by_condo'
  | 'resident_activity'
  | 'hourly'
  | 'top_visitors'
  | 'vehicles_by_lot';

interface ReportRow { label: string; value: number; sub?: string }
interface ReportResult { id: ReportId; rows: ReportRow[]; total: number; fetchedAt: number }

const REPORTS: Array<{ id: ReportId; label: string; icon: React.ElementType; desc: string }> = [
  { id: 'summary',           label: 'Resumen General',               icon: TrendingUp, desc: 'Totales de accesos, visitas y vehículos. Visión panorámica del período.' },
  { id: 'access_by_condo',   label: 'Accesos por Condominio',        icon: Building2,  desc: 'Accesos peatonales agrupados por condominio o zona.' },
  { id: 'visits_by_condo',   label: 'Visitas por Condominio',        icon: Users,      desc: 'Visitas recibidas agrupadas por condominio del anfitrión.' },
  { id: 'resident_activity', label: 'Actividad por Residente',       icon: User,       desc: 'Ranking de residentes con mayor cantidad de accesos en el período.' },
  { id: 'hourly',            label: 'Distribución Horaria',          icon: Clock,      desc: 'Volumen de accesos por hora del día. Identifica peaks de movimiento.' },
  { id: 'top_visitors',      label: 'Visitantes Frecuentes',         icon: Users,      desc: 'Visitantes externos con más visitas registradas en el período.' },
  { id: 'vehicles_by_lot',   label: 'Vehículos por Estacionamiento', icon: Car,        desc: 'Ingresos vehiculares agrupados por condominio o estacionamiento.' },
];

// ─── CSV export ───────────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: ReportRow[]) {
  const lines = ['Nombre,Cantidad,Detalle', ...rows.map(r => `"${r.label}",${r.value},"${r.sub ?? ''}"`)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── sub-components ───────────────────────────────────────────────────────────

function HBar({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-44 text-right shrink-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate leading-tight">{label}</p>
        {sub && <p className="text-[10px] text-slate-400 truncate leading-tight">{sub}</p>}
      </div>
      <div className="flex-1 bg-slate-100 dark:bg-white/5 rounded-full h-5 overflow-hidden">
        <div className="h-5 rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-sm font-bold text-slate-700 dark:text-slate-200 shrink-0 tabular-nums">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function SummaryGrid({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {rows.map((r, i) => (
        <div key={i} className="bg-slate-50 dark:bg-white/5 rounded-xl p-5 text-center">
          <p className="text-4xl font-black text-blue-600 dark:text-blue-400 tabular-nums">{r.value.toLocaleString()}</p>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-1">{r.label}</p>
          {r.sub && <p className="text-xs text-slate-400 mt-0.5">{r.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── data fetching ────────────────────────────────────────────────────────────

interface RawData {
  accesses: any[];
  visitors: any[];
  vehicles: DahuaVehicleRecord[];
  cachedAt: number;
}

async function fetchRawFromServer(startTime: number, endTime: number): Promise<Pick<RawData, 'accesses' | 'visitors'>> {
  const res = await authedFetch(`/api/reports/raw-data?startTime=${startTime}&endTime=${endTime}`);
  if (!res.ok) throw new Error(`Server error ${res.status}: ${(await res.json().catch(() => ({}))).error ?? 'unknown'}`);
  return res.json();
}

async function fetchVehicles(startTime: number, endTime: number): Promise<DahuaVehicleRecord[]> {
  try { return (await DahuaService.listVehicleEnterRecords({ startTime, endTime })).list; } catch { return []; }
}

// ─── report builders ──────────────────────────────────────────────────────────

type Maps = Pick<Props, 'personMap' | 'hostCondoMap' | 'dssPersonMap' | 'dssNameMap'>;

function condoOfAccess(r: any, maps: Maps): string {
  const pid  = r.personId || '';
  const pidN = pid ? String(Number(pid)) : '';
  const pidP = pid ? pid.padStart(8, '0') : '';
  return (
    maps.personMap[pid]?.condoName  || maps.personMap[pidN]?.condoName  || maps.personMap[pidP]?.condoName ||
    maps.dssPersonMap[pid]?.orgName || maps.dssPersonMap[pidN]?.orgName ||
    r.orgName || 'Desconocido'
  );
}

// Filtra los registros crudos a solo los condominios permitidos (restricción por rol).
function filterRawByCondo(raw: RawData, maps: Maps, allowed: Set<string> | null | undefined): RawData {
  if (!allowed) return raw;
  const ok = (c: string) => allowed.has(normCondoR(c));
  return {
    ...raw,
    accesses: raw.accesses.filter((r: any) => ok(condoOfAccess(r, maps))),
    visitors: raw.visitors.filter((v: any) => ok(maps.dssNameMap[v.visitedName] || maps.hostCondoMap[v.visitedName] || '')),
    vehicles: raw.vehicles.filter((v: any) => ok((v as any).orgName || (v as any).parkingLot || '')),
  };
}

function buildReport(
  id: ReportId, rawData: RawData, maps: Maps,
): ReportResult {
  const { accesses, visitors, vehicles } = rawData;
  const now = Date.now();

  switch (id) {
    case 'summary': {
      const rows: ReportRow[] = [
        { label: 'Accesos totales',      value: accesses.length },
        { label: 'Ingresos peatonales',  value: accesses.filter((r: any) => r.direction === 'in').length },
        { label: 'Salidas',              value: accesses.filter((r: any) => r.direction === 'out').length },
        { label: 'Visitas agendadas',    value: visitors.length },
        { label: 'Visitas presentes',    value: visitors.filter((v: any) => v.arrivalTime).length },
        { label: 'Ingresos vehiculares', value: vehicles.length },
      ];
      return { id, total: accesses.length + visitors.length + vehicles.length, fetchedAt: now, rows };
    }

    case 'access_by_condo': {
      const counts: Record<string, number> = {};
      for (const r of accesses) { const k = condoOfAccess(r, maps); counts[k] = (counts[k] || 0) + 1; }
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
      return { id, total: accesses.length, fetchedAt: now, rows };
    }

    case 'visits_by_condo': {
      const counts: Record<string, number> = {};
      for (const v of visitors) {
        const k = maps.dssNameMap[(v as any).visitedName] || maps.hostCondoMap[(v as any).visitedName] || 'Desconocido';
        counts[k] = (counts[k] || 0) + 1;
      }
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
      return { id, total: visitors.length, fetchedAt: now, rows };
    }

    case 'resident_activity': {
      const counts: Record<string, { value: number; sub: string }> = {};
      for (const r of accesses) {
        if (!(r as any).personName) continue;
        const condo = condoOfAccess(r, maps);
        if (!counts[(r as any).personName]) counts[(r as any).personName] = { value: 0, sub: condo };
        counts[(r as any).personName].value++;
      }
      const rows = Object.entries(counts)
        .sort((a, b) => b[1].value - a[1].value).slice(0, 30)
        .map(([label, { value, sub }]) => ({ label, value, sub }));
      return { id, total: accesses.length, fetchedAt: Date.now(), rows };
    }

    case 'hourly': {
      const byHour: number[] = Array(24).fill(0);
      for (const r of accesses) if ((r as any).accessTime) byHour[new Date((r as any).accessTime * 1000).getHours()]++;
      for (const v of visitors) {
        const ts = (v as any).arrivalTime || (v as any).expectArrivalTime;
        if (ts) byHour[new Date(ts * 1000).getHours()]++;
      }
      const rows = byHour
        .map((value, h) => ({ label: `${String(h).padStart(2, '0')}:00 — ${String(h + 1).padStart(2, '0')}:00`, value }))
        .filter(r => r.value > 0);
      return { id, total: accesses.length + visitors.length, fetchedAt: now, rows };
    }

    case 'top_visitors': {
      const counts: Record<string, { value: number; sub: string }> = {};
      for (const v of visitors) {
        const condo = maps.dssNameMap[(v as any).visitedName] || maps.hostCondoMap[(v as any).visitedName] || '';
        if (!counts[(v as any).visitorName]) counts[(v as any).visitorName] = { value: 0, sub: condo };
        counts[(v as any).visitorName].value++;
      }
      const rows = Object.entries(counts)
        .sort((a, b) => b[1].value - a[1].value).slice(0, 30)
        .map(([label, { value, sub }]) => ({ label, value, sub: sub ? `Visita a: ${sub}` : '' }));
      return { id, total: visitors.length, fetchedAt: now, rows };
    }

    case 'vehicles_by_lot': {
      const counts: Record<string, number> = {};
      for (const v of vehicles) {
        const k = v.orgName || v.parkingLot || 'Desconocido';
        counts[k] = (counts[k] || 0) + 1;
      }
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
      return { id, total: vehicles.length, fetchedAt: now, rows };
    }
  }
}

// ─── date helpers ─────────────────────────────────────────────────────────────

const DATE_PRESETS = [
  { k: '1d',  label: 'Hoy'      },
  { k: '7d',  label: '7 días'   },
  { k: '30d', label: '30 días'  },
  { k: 'custom', label: 'Rango' },
] as const;

type DatePreset = typeof DATE_PRESETS[number]['k'];

function getRange(preset: DatePreset, from: string, to: string): { startTime: number; endTime: number } {
  const now = Math.floor(Date.now() / 1000);
  if (preset === '1d') return { startTime: Math.floor(new Date().setHours(0, 0, 0, 0) / 1000), endTime: now };
  if (preset === '7d') return { startTime: now - 7 * 86400, endTime: now };
  if (preset === '30d') return { startTime: now - 30 * 86400, endTime: now };
  const st = from ? Math.floor(new Date(from + 'T00:00:00').getTime() / 1000) : now - 7 * 86400;
  const et = to   ? Math.floor(new Date(to   + 'T23:59:59').getTime() / 1000) : now;
  return { startTime: st, endTime: et };
}

function fmtRange(preset: DatePreset, from: string, to: string): string {
  if (preset === '1d')  return 'Hoy';
  if (preset === '7d')  return 'Últimos 7 días';
  if (preset === '30d') return 'Últimos 30 días';
  return `${from || '?'} → ${to || '?'}`;
}

// ─── main component ───────────────────────────────────────────────────────────

export default function AccessReports({ personMap, hostCondoMap, dssPersonMap, dssNameMap, allowedCondoNorms }: Props) {
  const [selectedReport, setSelectedReport] = useState<ReportId>('summary');
  const [preset, setPreset]   = useState<DatePreset>('7d');
  const [fromDate, setFrom]   = useState('');
  const [toDate, setTo]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<ReportResult | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ fromCache: boolean; recordCount: number } | null>(null);

  // Client-side data cache — avoids re-fetching when switching report types
  const rawCache = useRef<{ key: string; data: RawData } | null>(null);

  const generate = async () => {
    setLoading(true); setError(null); setResult(null); setCacheInfo(null);
    try {
      const { startTime, endTime } = getRange(preset, fromDate, toDate);
      const cacheKey = `${startTime}-${endTime}`;
      const maps = { personMap, hostCondoMap, dssPersonMap, dssNameMap };

      let rawData: RawData;

      if (rawCache.current?.key === cacheKey) {
        // Same date range — skip all network calls, compute instantly
        rawData = rawCache.current.data;
      } else {
        // Fetch accesses + visitors from server in parallel with vehicles from client
        const isVehicleReport = selectedReport === 'vehicles_by_lot' || selectedReport === 'summary';
        const [serverData, vehicles] = await Promise.all([
          fetchRawFromServer(startTime, endTime),
          isVehicleReport ? fetchVehicles(startTime, endTime) : Promise.resolve([] as DahuaVehicleRecord[]),
        ]);
        rawData = { accesses: serverData.accesses, visitors: serverData.visitors, vehicles, cachedAt: serverData.cachedAt };
        rawCache.current = { key: cacheKey, data: rawData };
      }

      // If switching to vehicle report after non-vehicle first fetch, fill vehicles now
      if ((selectedReport === 'vehicles_by_lot' || selectedReport === 'summary') && rawData.vehicles.length === 0) {
        const vehicles = await fetchVehicles(startTime, endTime);
        rawData = { ...rawData, vehicles };
        rawCache.current = { key: cacheKey, data: rawData };
      }

      const scopedRaw = filterRawByCondo(rawData, maps, allowedCondoNorms);
      const reportResult = buildReport(selectedReport, scopedRaw, maps);
      setResult(reportResult);
      setCacheInfo({ fromCache: !!rawCache.current, recordCount: rawData.accesses.length + rawData.visitors.length });
    } catch (err: any) {
      setError(err.message || 'Error al generar informe');
    } finally {
      setLoading(false);
    }
  };

  const report = REPORTS.find(r => r.id === selectedReport)!;
  const dateLabel = fmtRange(preset, fromDate, toDate);

  return (
    <div className="space-y-6">

      {/* Date range */}
      <Card variant="glass" padding="sm">
        <div className="flex flex-wrap items-center gap-3">
          <Calendar size={14} className="text-slate-400 shrink-0" />
          <div className="flex gap-1">
            {DATE_PRESETS.map(({ k, label }) => (
              <button
                key={k}
                onClick={() => { setPreset(k); rawCache.current = null; setResult(null); }}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                  preset === k
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                )}
              >{label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <>
              <input type="date" value={fromDate} onChange={e => setFrom(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500" />
              <span className="text-slate-400 text-sm">→</span>
              <input type="date" value={toDate} onChange={e => setTo(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500" />
            </>
          )}
        </div>
      </Card>

      {/* Report type selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {REPORTS.map(r => {
          const Icon = r.icon;
          const active = selectedReport === r.id;
          return (
            <button
              key={r.id}
              onClick={() => { setSelectedReport(r.id); setResult(null); }}
              className={cn(
                'flex items-start gap-3 p-4 rounded-xl border text-left transition-all cursor-pointer',
                active
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 shadow-sm'
                  : 'border-slate-200 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-500/40 bg-white dark:bg-white/[0.03]',
              )}
            >
              <Icon size={18} className={active ? 'text-blue-600 shrink-0' : 'text-slate-400 shrink-0'} />
              <div className="min-w-0">
                <p className={cn('text-sm font-semibold leading-tight', active ? 'text-blue-700 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200')}>
                  {r.label}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{r.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={BarChart2} onClick={generate} loading={loading}>
          Generar — {report.label}
        </Button>
        {result && !loading && (
          <Button
            variant="secondary" icon={Download}
            onClick={() => downloadCsv(`informe_${result.id}_${new Date().toISOString().slice(0, 10)}.csv`, result.rows)}
          >
            Exportar CSV
          </Button>
        )}
        {result && !loading && (
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            {result.total.toLocaleString()} registros · {dateLabel} · {new Date(result.fetchedAt).toLocaleTimeString('es-CL')}
            {cacheInfo && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-[10px]">
                ⚡ desde caché
              </span>
            )}
          </span>
        )}
      </div>

      {/* Results */}
      {loading && <div className="flex flex-col items-center gap-3 py-16"><Spinner size={36} /><p className="text-sm text-slate-400">Cargando datos del Sistema de Portería Virtual…</p></div>}

      {error && !loading && (
        <Card variant="glass">
          <p className="text-red-500 text-sm text-center py-6">{error}</p>
        </Card>
      )}

      {result && !loading && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5">
            <h3 className="font-bold text-slate-800 dark:text-white">{report.label}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{dateLabel}</p>
          </div>
          <div className="p-6">
            {result.rows.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">Sin datos para el período seleccionado.</p>
            ) : selectedReport === 'summary' ? (
              <SummaryGrid rows={result.rows} />
            ) : (
              <div className="space-y-0.5">
                {result.rows.map((row, i) => (
                  <HBar key={i} label={row.label} value={row.value} max={result.rows[0].value} sub={row.sub} />
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
