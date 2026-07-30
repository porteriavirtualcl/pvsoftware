import React, { useEffect, useMemo, useState } from 'react';
import { authedFetch } from '../lib/apiBase';
import { PageHeader, Card, Badge, Input, Button, Spinner, EmptyState } from '../components/ui';
import { ShieldCheck, Search, Download, Send, Copy, ChevronDown, ChevronRight, ScanFace, RotateCcw } from 'lucide-react';

type Status = 'authorized' | 'pending' | 'refused' | 'none';
interface Person { name: string; dahuaPersonId: string; uid?: string; condoId: string; unit: string; status: Status; acceptedByName: string; basis: string; acceptedAt: number | null; source?: 'dss' | 'app'; hasFacial?: boolean; }

// Clave estable: los residentes de la app no tienen dahuaPersonId, se identifican por uid.
const personKey = (p: Person) => p.dahuaPersonId || p.uid || p.name;
interface Unit { unit: string; persons: Person[]; }
interface Condo { condoName: string; condoId: string; units: Unit[]; }
interface Payload { summary: { totPersons: number; totFacial: number; totAuth: number; totPend: number; totRef: number; totNone: number }; condos: Condo[]; }

const ST: Record<Status, { label: string; variant: 'success' | 'warn' | 'danger' | 'muted' }> = {
  authorized: { label: 'Autorizado', variant: 'success' },
  pending:    { label: 'Pendiente de ratificar', variant: 'warn' },
  refused:    { label: 'Rechazó facial', variant: 'muted' },
  none:       { label: 'Sin autorización', variant: 'danger' },
};

const Compliance: React.FC = () => {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [resent, setResent] = useState<Record<string, string>>({});   // personId → token
  const [resending, setResending] = useState<string | null>(null);
  const [reqs, setReqs] = useState<any[] | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadReqs = () => authedFetch('/api/rights-requests').then(r => r.json()).then(d => setReqs(d.requests || [])).catch(() => setReqs([]));
  useEffect(() => { loadReqs(); }, []);

  const resolveReq = async (id: string, status: 'resolved' | 'rejected') => {
    const note = status === 'rejected' ? (window.prompt('Motivo del rechazo (opcional):') || '') : (window.prompt('Nota de resolución (opcional):') || '');
    try {
      await authedFetch(`/api/rights-requests/${id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      });
      loadReqs();
    } catch { alert('No se pudo actualizar la solicitud'); }
  };
  const REQ_TYPE: Record<string, string> = { acceso: 'Acceso', rectificacion: 'Rectificación', eliminacion: 'Eliminación', oposicion: 'Oposición', portabilidad: 'Portabilidad' };
  const pendingReqs = (reqs || []).filter(r => r.status === 'pending');

  const load = (force?: boolean) => {
    setLoading(true); setError(null);
    authedFetch('/api/compliance/facial-consent' + (force ? '?refresh=1' : ''))
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); setLastUpdate(new Date()); })
      .catch(e => setError(e.message || 'Error al cargar'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!data) return [];
    if (!term) return data.condos;
    return data.condos
      .map(c => ({ ...c, units: c.units.map(u => ({ ...u, persons: u.persons.filter(p =>
        p.name.toLowerCase().includes(term) || u.unit.toLowerCase().includes(term) || c.condoName.toLowerCase().includes(term)) }))
        .filter(u => u.persons.length > 0) }))
      .filter(c => c.units.length > 0);
  }, [data, term]);

  const resend = async (p: Person) => {
    const key = personKey(p);
    setResending(key);
    try {
      const res = await authedFetch('/api/consent/resend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condoId: p.condoId, dahuaPersonId: p.dahuaPersonId || undefined, uid: p.uid || undefined, name: p.name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Error');
      const link = `${window.location.origin}/ratify/${d.token}`;
      setResent(r => ({ ...r, [key]: link }));
      navigator.clipboard?.writeText(link).catch(() => {});
    } catch (e: any) {
      alert(e.message || 'No se pudo generar el enlace');
    } finally {
      setResending(null);
    }
  };

  const resetConsent = async (p: Person) => {
    if (!window.confirm(`¿Restablecer a "Sin autorización" a ${p.name}? Se borra su respuesta actual y podrá volver a autorizar con un nuevo link.`)) return;
    try {
      await authedFetch('/api/consent/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condoId: p.condoId, dahuaPersonId: p.dahuaPersonId || undefined, uid: p.uid || undefined, name: p.name }),
      });
      setResent(r => { const n = { ...r }; delete n[personKey(p)]; return n; });
      load();
    } catch { alert('No se pudo restablecer'); }
  };

  const exportCsv = () => {
    if (!data) return;
    const rows = [['Condominio', 'Unidad', 'Nombre', 'PersonID DSS', 'Estado', 'Base', 'Autorizado por', 'Fecha']];
    for (const c of data.condos) for (const u of c.units) for (const p of u.persons) {
      rows.push([c.condoName, u.unit, p.name, p.dahuaPersonId, ST[p.status].label, p.basis || '',
        p.acceptedByName || '', p.acceptedAt ? new Date(p.acceptedAt * 1000).toLocaleString('es-CL') : '']);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consentimiento-facial-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const tile = (n: number | string, label: string, cls: string) => (
    <div className="flex-1 min-w-[110px] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-3.5">
      <div className={`text-2xl font-bold ${cls}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mt-1">{label}</div>
    </div>
  );

  // % de cumplimiento = autorizados / total con facial. Baja si se enrolan nuevas
  // personas con facial que aún no autorizan.
  const pctColor = (p: number) => (p >= 90 ? 'text-emerald-600' : p >= 60 ? 'text-amber-600' : 'text-red-600');
  const overallPct = data && data.summary.totPersons ? Math.round((100 * data.summary.totAuth) / data.summary.totPersons) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Cumplimiento — Ley 21.719"
        description="Personas registradas con reconocimiento facial en el DSS y su estado de autorización, por condominio y unidad."
        actions={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {lastUpdate && (
              <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                Última actualización: {lastUpdate.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <Button variant="secondary" icon={RotateCcw} onClick={() => { load(true); loadReqs(); }} loading={loading}>Actualizar</Button>
            <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!data}>Exportar CSV</Button>
          </div>
        }
      />

      {data && (
        <div className="flex gap-3 flex-wrap">
          {tile(`${overallPct}%`, 'Cumplimiento', pctColor(overallPct))}
          {tile(data.summary.totPersons, 'Total personas', 'text-slate-900 dark:text-white')}
          {tile(data.summary.totAuth, 'Autorizados', 'text-emerald-600')}
          {tile(data.summary.totPend, 'Pendientes', 'text-amber-600')}
          {tile(data.summary.totRef, 'Rechazaron', 'text-slate-500')}
          {tile(data.summary.totNone, 'Sin autorización', 'text-red-600')}
        </div>
      )}

      {/* Bandeja de solicitudes de derechos (ARCOP) */}
      {reqs && reqs.length > 0 && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/5 flex items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-white">Solicitudes de derechos</span>
            {pendingReqs.length > 0 && <Badge variant="warn">{pendingReqs.length} pendientes</Badge>}
          </div>
          <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
            {reqs.slice(0, 30).map(r => (
              <div key={r.id} className="px-5 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className="font-semibold text-slate-900 dark:text-white">{REQ_TYPE[r.type] || r.type}</span>
                    <span className="text-slate-500 dark:text-slate-400"> · {r.userName || r.email} {r.condoName ? `· ${r.condoName}` : ''} {r.unit ? `· ${r.unit}` : ''}</span>
                  </div>
                  {r.message && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{r.message}</div>}
                  {r.note && <div className="text-xs text-slate-400 mt-0.5">Respuesta: {r.note}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.status === 'pending' ? (
                    <>
                      <button onClick={() => resolveReq(r.id, 'resolved')} className="text-xs font-semibold text-emerald-600 hover:underline cursor-pointer">Resolver</button>
                      <button onClick={() => resolveReq(r.id, 'rejected')} className="text-xs font-semibold text-red-600 hover:underline cursor-pointer">Rechazar</button>
                    </>
                  ) : (
                    <Badge variant={r.status === 'resolved' ? 'success' : 'danger'}>{r.status === 'resolved' ? 'Resuelta' : 'Rechazada'}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, unidad o condominio…" className="pl-10" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size={38} /></div>
      ) : error ? (
        <Card className="p-6 text-sm text-red-600 dark:text-red-400">{error}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState icon={ScanFace} title="Sin resultados" description="No hay personas con facial que coincidan." />
      ) : (
        <div className="space-y-4">
          {filtered.map(condo => {
            const total = condo.units.reduce((s, u) => s + u.persons.length, 0);
            const auth = condo.units.reduce((s, u) => s + u.persons.filter(p => p.status === 'authorized').length, 0);
            const pend = condo.units.reduce((s, u) => s + u.persons.filter(p => p.status !== 'authorized' && p.status !== 'refused').length, 0);
            const pct = total ? Math.round((100 * auth) / total) : 0;
            const isOpen = open[condo.condoName] ?? false;
            return (
              <Card key={condo.condoName} padding="none" className="overflow-hidden">
                <button
                  onClick={() => setOpen(o => ({ ...o, [condo.condoName]: !isOpen }))}
                  className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50 dark:hover:bg-white/[0.02] cursor-pointer"
                >
                  <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    {condo.condoName}
                  </span>
                  <span className="flex items-center gap-2.5 text-xs">
                    <span className={`font-bold ${pctColor(pct)}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                    {pend > 0 && <Badge variant="warn">{pend} por autorizar</Badge>}
                    <span className="text-slate-400">{total} con facial</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-white/5">
                    {condo.units.map(u => (
                      <div key={u.unit} className="px-5 py-3 border-b border-slate-50 dark:border-white/[0.03] last:border-0">
                        <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-2">{u.unit}</div>
                        <div className="grid items-center gap-x-4 gap-y-2 text-sm" style={{ gridTemplateColumns: 'max-content max-content max-content' }}>
                          {u.persons.map(p => {
                            const pk = personKey(p);
                            const link = resent[pk];
                            const needsAction = p.status === 'none' || p.status === 'pending';
                            return (
                              <React.Fragment key={pk}>
                                <span className="text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                  {p.name}
                                  {p.acceptedByName && <span className="ml-2 text-[11px] text-slate-400">por {p.acceptedByName}</span>}
                                </span>
                                <span><Badge variant={ST[p.status].variant}>{ST[p.status].label}</Badge></span>
                                <span className="flex items-center gap-3 whitespace-nowrap">
                                  {!link && needsAction && (
                                    <button onClick={() => resend(p)} disabled={resending === pk}
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer disabled:opacity-50">
                                      <Send size={13} /> {resending === pk ? 'Generando…' : 'Enviar link'}
                                    </button>
                                  )}
                                  {p.status !== 'none' && (
                                    <button onClick={() => resetConsent(p)}
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer">
                                      <RotateCcw size={13} /> Restablecer
                                    </button>
                                  )}
                                </span>
                                {link && (
                                  <div style={{ gridColumn: '1 / -1' }} className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 px-2.5 py-1.5">
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">Link de <b className="text-slate-700 dark:text-slate-200">{p.name}</b>:</span>
                                    <input readOnly value={link} onFocus={e => e.currentTarget.select()}
                                      className="flex-1 min-w-0 bg-transparent font-mono text-[11px] text-blue-700 dark:text-blue-300 outline-none" />
                                    <button onClick={() => { navigator.clipboard?.writeText(link).catch(() => {}); }}
                                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                                      <Copy size={12} /> Copiar
                                    </button>
                                  </div>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Compliance;
