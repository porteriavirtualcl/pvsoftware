import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import {
  Star, AlertTriangle, CheckCircle2, XCircle, User,
  Calendar, Search, ShieldAlert,
  MessageCircle, BarChart3, Info, Plus,
  TrendingUp, ChevronRight,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Modal, Spinner } from '../components/ui';
import { api } from '../lib/apiBase';
import { cn } from '../lib/utils';
import type { Timestamp as FSTimestamp } from 'firebase/firestore';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(api(path), { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  waNumberId: string;
  contactPhone: string;
  contactName: string;
  condoName?: string;
  lastMessage: string;
  lastMessageAt: FSTimestamp;
}

interface Indicador {
  valor: number | null;
  puntaje: number | null;
  comentario: string;
}

type IndicadoresMap = Record<string, Indicador>;

interface Evaluation {
  id: string;
  conversationId: string;
  waNumberId?: string;
  contactName?: string;
  contactPhone?: string;
  operador: string;
  turno: string;
  comunidad: string;
  fecha: string;
  puntaje_total: number | null;
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
  resumen: string;
  banderas_rojas: string[];
  evaluatedAt: FSTimestamp;
  indicadores: IndicadoresMap;
}

// ── constants ─────────────────────────────────────────────────────────────────

const KPI_KEYS = [
  'tiempo_respuesta_acceso',
  'tiempo_gestion_acceso',
  'atendido',
  'verificacion_identidad_correcta',
  'errores_acceso',
  'registro_bitacora_correcto',
  'tono_y_protocolo',
  'manejo_incidente',
  'csat_estimado',
  'reclamo_detectado',
] as const;

const KPI_META: Record<string, { label: string; short: string; unit?: string }> = {
  tiempo_respuesta_acceso:         { label: 'Tiempo de respuesta',       short: 'T. Respuesta',   unit: 'seg' },
  tiempo_gestion_acceso:           { label: 'Tiempo de gestión',         short: 'T. Gestión',     unit: 'seg' },
  atendido:                        { label: 'Visita atendida',           short: 'Atendido'                    },
  verificacion_identidad_correcta: { label: 'Verificación de identidad', short: 'Verif. ID'                   },
  errores_acceso:                  { label: 'Errores de acceso',         short: 'Errores'                     },
  registro_bitacora_correcto:      { label: 'Registro en bitácora',      short: 'Bitácora'                    },
  tono_y_protocolo:                { label: 'Tono y protocolo',          short: 'Tono'                        },
  manejo_incidente:                { label: 'Manejo de incidentes',      short: 'Incidentes'                  },
  csat_estimado:                   { label: 'Satisfacción estimada',     short: 'CSAT'                        },
  reclamo_detectado:               { label: 'Reclamos detectados',       short: 'Reclamos'                    },
};

// ── helpers ───────────────────────────────────────────────────────────────────

function scoreColor(p: number | null) {
  if (p === null) return 'text-slate-400 dark:text-slate-500';
  if (p >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (p >= 60) return 'text-amber-500 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

function scoreBg(p: number | null) {
  if (p === null) return 'bg-slate-100 dark:bg-slate-800';
  if (p >= 80) return 'bg-emerald-500';
  if (p >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

function semInfo(s?: string) {
  if (s === 'VERDE')    return { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20', label: 'Verde',    Icon: CheckCircle2 };
  if (s === 'AMARILLO') return { dot: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-500/10',     border: 'border-amber-200 dark:border-amber-500/20',     label: 'Amarillo', Icon: AlertTriangle };
  return                       { dot: 'bg-red-500',     text: 'text-red-700 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-500/10',         border: 'border-red-200 dark:border-red-500/20',         label: 'Rojo',     Icon: XCircle };
}

function formatDate(ts: FSTimestamp | undefined) {
  if (!ts) return '—';
  return ts.toDate().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n !== null);
  if (!valid.length) return null;
  return Math.round(valid.reduce((s, n) => s + n, 0) / valid.length * 10) / 10;
}

// ── main component ────────────────────────────────────────────────────────────

const AtencionCliente: React.FC = () => {
  const [evaluations, setEvaluations]     = useState<Evaluation[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedEval, setSelectedEval]   = useState<Evaluation | null>(null);
  const [showNewModal, setShowNewModal]   = useState(false);

  // Subscribe to waEvaluations (last 100, real-time)
  useEffect(() => {
    const q = query(collection(db, 'waEvaluations'), orderBy('evaluatedAt', 'desc'), limit(100));
    return onSnapshot(q, snap => {
      setEvaluations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Evaluation)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  // ── aggregate stats ──
  const total   = evaluations.length;
  const verde   = evaluations.filter(e => e.semaforo === 'VERDE').length;
  const amarillo = evaluations.filter(e => e.semaforo === 'AMARILLO').length;
  const rojo    = evaluations.filter(e => e.semaforo === 'ROJO').length;
  const avgTotal = avg(evaluations.map(e => e.puntaje_total));

  // Per-KPI averages
  const kpiAvgs = Object.fromEntries(
    KPI_KEYS.map(key => [
      key,
      avg(evaluations.map(e => e.indicadores?.[key]?.puntaje ?? null)),
    ])
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Atención al Cliente"
          description={total > 0 ? `${total} evaluación${total !== 1 ? 'es' : ''} registrada${total !== 1 ? 's' : ''}` : 'Sin evaluaciones aún'}
        />
        <Button icon={Plus} onClick={() => setShowNewModal(true)}>
          Nueva evaluación
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={32} />
        </div>
      ) : total === 0 ? (
        <Card className="py-20 text-center">
          <Star size={44} className="text-slate-200 dark:text-slate-700 mx-auto mb-3" />
          <p className="font-semibold text-slate-500 dark:text-slate-400">Sin evaluaciones</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 mb-5">
            Genera la primera evaluación de calidad usando el botón de arriba.
          </p>
          <Button icon={Plus} size="sm" onClick={() => setShowNewModal(true)}>Nueva evaluación</Button>
        </Card>
      ) : (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard
              label="Puntaje promedio"
              value={avgTotal !== null ? avgTotal.toFixed(1) : '—'}
              sub="/100"
              color={scoreColor(avgTotal)}
              icon={TrendingUp}
              iconBg="bg-blue-600/10 text-blue-600 dark:text-blue-400"
            />
            <SummaryCard
              label="Verde"
              value={verde}
              sub={`${total > 0 ? Math.round(verde / total * 100) : 0}%`}
              color="text-emerald-600 dark:text-emerald-400"
              icon={CheckCircle2}
              iconBg="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            />
            <SummaryCard
              label="Amarillo"
              value={amarillo}
              sub={`${total > 0 ? Math.round(amarillo / total * 100) : 0}%`}
              color="text-amber-500 dark:text-amber-400"
              icon={AlertTriangle}
              iconBg="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            />
            <SummaryCard
              label="Rojo"
              value={rojo}
              sub={`${total > 0 ? Math.round(rojo / total * 100) : 0}%`}
              color="text-red-500 dark:text-red-400"
              icon={XCircle}
              iconBg="bg-red-500/10 text-red-600 dark:text-red-400"
            />
          </div>

          {/* ── KPI averages grid ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Indicadores — promedio histórico
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {KPI_KEYS.map(key => {
                const p = kpiAvgs[key];
                return (
                  <Card key={key} className="p-3">
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide leading-tight mb-2">
                      {KPI_META[key].short}
                    </p>
                    <p className={cn('text-2xl font-bold leading-none mb-2', scoreColor(p))}>
                      {p !== null ? p.toFixed(0) : '—'}
                    </p>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                      {p !== null && (
                        <motion.div
                          className={cn('h-full rounded-full', scoreBg(p))}
                          initial={{ width: 0 }}
                          animate={{ width: `${p}%` }}
                          transition={{ duration: 0.5, ease: 'easeOut' }}
                        />
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* ── Evaluations list ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Últimas evaluaciones
            </p>
            <Card className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden p-0">
              {evaluations.slice(0, 50).map(ev => {
                const sem = semInfo(ev.semaforo);
                const SemIcon = sem.Icon;
                return (
                  <button
                    key={ev.id}
                    onClick={() => setSelectedEval(ev)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors flex items-center gap-3"
                  >
                    {/* Semáforo dot */}
                    <div className={cn('w-2 h-2 rounded-full shrink-0', sem.dot)} />

                    {/* Contact + comunidad */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {ev.contactName || ev.operador}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                        {ev.comunidad} · {ev.operador} · Turno {ev.turno}
                      </p>
                    </div>

                    {/* Fecha */}
                    <p className="hidden sm:block text-xs text-slate-400 dark:text-slate-500 shrink-0 w-28 text-right">
                      {formatDate(ev.evaluatedAt)}
                    </p>

                    {/* Red flags badge */}
                    {ev.banderas_rojas?.length > 0 && (
                      <span className="hidden sm:flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-2 py-0.5 rounded-full shrink-0">
                        <ShieldAlert size={10} />{ev.banderas_rojas.length}
                      </span>
                    )}

                    {/* Score */}
                    <span className={cn('text-sm font-bold shrink-0 w-10 text-right', scoreColor(ev.puntaje_total))}>
                      {ev.puntaje_total !== null ? ev.puntaje_total.toFixed(0) : '—'}
                    </span>

                    {/* Semáforo chip */}
                    <span className={cn(
                      'hidden sm:flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0',
                      sem.text, sem.bg, sem.border
                    )}>
                      <SemIcon size={10} />{sem.label}
                    </span>

                    <ChevronRight size={13} className="text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </Card>
          </div>
        </>
      )}

      {/* ── Evaluation detail modal ── */}
      <Modal
        open={!!selectedEval}
        onClose={() => setSelectedEval(null)}
        size="lg"
        title={selectedEval?.contactName || selectedEval?.operador || 'Detalle evaluación'}
        description={selectedEval ? `${selectedEval.comunidad} · ${formatDate(selectedEval.evaluatedAt)}` : undefined}
        icon={BarChart3}
      >
        {selectedEval && <EvalDetail ev={selectedEval} />}
      </Modal>

      {/* ── New evaluation modal ── */}
      {showNewModal && (
        <NewEvalModal
          onClose={() => setShowNewModal(false)}
          onDone={ev => { setEvaluations(prev => [ev, ...prev]); setShowNewModal(false); setSelectedEval(ev); }}
        />
      )}
    </div>
  );
};

// ── SummaryCard ───────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color, icon: Icon, iconBg }: {
  label: string; value: number | string; sub: string;
  color: string; icon: React.ElementType; iconBg: string;
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 truncate">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className={cn('text-2xl font-bold', color)}>{value}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">{sub}</span>
        </div>
      </div>
    </Card>
  );
}

// ── EvalDetail (inside modal) ─────────────────────────────────────────────────

function EvalDetail({ ev }: { ev: Evaluation }) {
  const sem = semInfo(ev.semaforo);
  const SemIcon = sem.Icon;

  return (
    <div className="space-y-4 pt-1">
      {/* Score row */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', sem.text, sem.bg, sem.border)}>
          <SemIcon size={12} />{sem.label}
        </span>
        <div className="flex items-baseline gap-1">
          <span className={cn('text-4xl font-bold', scoreColor(ev.puntaje_total))}>
            {ev.puntaje_total !== null ? ev.puntaje_total.toFixed(1) : '—'}
          </span>
          <span className="text-slate-400">/100</span>
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400 space-y-0.5">
          <p className="flex items-center gap-1.5"><User size={11} />{ev.operador} · Turno {ev.turno}</p>
          <p className="flex items-center gap-1.5"><Calendar size={11} />{ev.fecha}</p>
        </div>
      </div>

      {/* Total bar */}
      {ev.puntaje_total !== null && (
        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <motion.div
            className={cn('h-full rounded-full', scoreBg(ev.puntaje_total))}
            initial={{ width: 0 }}
            animate={{ width: `${ev.puntaje_total}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      )}

      {/* Red flags */}
      {ev.banderas_rojas?.length > 0 && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
          <p className="flex items-center gap-1.5 font-semibold text-sm text-red-700 dark:text-red-400 mb-2">
            <ShieldAlert size={13} /> Banderas rojas
          </p>
          <ul className="space-y-1">
            {ev.banderas_rojas.map((f, i) => (
              <li key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <span className="mt-0.5">•</span>{f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-2">
        {KPI_KEYS.map(key => {
          const ind = ev.indicadores?.[key];
          if (!ind) return null;
          const p = ind.puntaje;
          return (
            <div key={key} className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-tight">
                  {KPI_META[key]?.label ?? key}
                </p>
                <span className={cn('text-base font-bold shrink-0', scoreColor(p))}>
                  {p !== null ? p : '—'}
                </span>
              </div>
              <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mb-1.5">
                {p !== null && (
                  <motion.div
                    className={cn('h-full rounded-full', scoreBg(p))}
                    initial={{ width: 0 }}
                    animate={{ width: `${p}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                )}
              </div>
              {ind.comentario && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-start gap-1 leading-tight">
                  <Info size={9} className="mt-0.5 shrink-0" />{ind.comentario}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Resumen */}
      {ev.resumen && (
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1.5">
            <BarChart3 size={11} /> Resumen del auditor
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{ev.resumen}</p>
        </div>
      )}
    </div>
  );
}

// ── NewEvalModal ──────────────────────────────────────────────────────────────

function NewEvalModal({ onClose, onDone }: {
  onClose: () => void;
  onDone: (ev: Evaluation) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs]   = useState(true);
  const [search, setSearch]               = useState('');
  const [evaluatingId, setEvaluatingId]   = useState<string | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'waConversations'), orderBy('lastMessageAt', 'desc'), limit(100));
    return onSnapshot(q, snap => {
      setConversations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation)));
      setLoadingConvs(false);
    }, () => setLoadingConvs(false));
  }, []);

  const handleEvaluate = useCallback(async (convId: string) => {
    setEvaluatingId(convId);
    setError(null);
    try {
      const result = await apiFetch<Evaluation>('/api/wa/evaluate', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId }),
      });
      onDone(result);
    } catch (err: any) {
      setError(err?.message || 'Error al evaluar');
      setEvaluatingId(null);
    }
  }, [onDone]);

  const filtered = conversations.filter(c =>
    c.contactName.toLowerCase().includes(search.toLowerCase()) ||
    c.contactPhone.includes(search) ||
    (c.condoName || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva evaluación"
      description="Selecciona una conversación de WhatsApp para evaluar con IA"
      icon={Star}
      size="md"
    >
      <div className="space-y-3 pt-1">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar contacto…"
            className="pl-8 text-sm"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />{error}
          </div>
        )}

        {loadingConvs ? (
          <div className="flex items-center justify-center py-10"><Spinner size={24} /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">Sin conversaciones</p>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
            {filtered.map(conv => (
              <div key={conv.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <MessageCircle size={12} className="text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{conv.contactName}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                    {conv.contactPhone}{conv.condoName ? ` · ${conv.condoName}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={evaluatingId === conv.id}
                  disabled={!!evaluatingId}
                  onClick={() => handleEvaluate(conv.id)}
                >
                  {evaluatingId === conv.id ? 'Evaluando…' : 'Evaluar'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default AtencionCliente;
