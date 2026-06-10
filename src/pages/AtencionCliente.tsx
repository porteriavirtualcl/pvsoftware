import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import {
  Star, AlertTriangle, CheckCircle2, XCircle, User,
  Phone, Building2, Calendar, ChevronRight, Search,
  ShieldAlert, MessageCircle, BarChart3, Info,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Spinner } from '../components/ui';
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
  unreadCount: number;
}

interface Indicador {
  valor: number | null;
  puntaje: number | null;
  comentario: string;
}

interface Evaluation {
  id: string;
  conversationId: string;
  operador: string;
  turno: string;
  comunidad: string;
  fecha: string;
  puntaje_total: number | null;
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
  resumen: string;
  banderas_rojas: string[];
  evaluatedAt: FSTimestamp;
  indicadores: {
    tiempo_respuesta_acceso:         Indicador;
    tiempo_gestion_acceso:           Indicador;
    atendido:                        Indicador;
    verificacion_identidad_correcta: Indicador;
    errores_acceso:                  Indicador;
    registro_bitacora_correcto:      Indicador;
    tono_y_protocolo:                Indicador;
    manejo_incidente:                Indicador;
    csat_estimado:                   Indicador;
    reclamo_detectado:               Indicador;
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

const KPI_META: Record<string, { label: string; unit?: string; weight: number }> = {
  tiempo_respuesta_acceso:         { label: 'Tiempo respuesta',   unit: 'seg', weight: 15 },
  tiempo_gestion_acceso:           { label: 'Tiempo gestión',     unit: 'seg', weight: 10 },
  atendido:                        { label: 'Atendido',                        weight: 10 },
  verificacion_identidad_correcta: { label: 'Verificación ID',                 weight: 12 },
  errores_acceso:                  { label: 'Errores de acceso',               weight: 10 },
  registro_bitacora_correcto:      { label: 'Registro bitácora',               weight: 8  },
  tono_y_protocolo:                { label: 'Tono y protocolo',                weight: 10 },
  manejo_incidente:                { label: 'Manejo incidente',                weight: 10 },
  csat_estimado:                   { label: 'CSAT estimado',                   weight: 8  },
  reclamo_detectado:               { label: 'Reclamos',                        weight: 7  },
};

function scoreColor(p: number | null) {
  if (p === null) return 'text-slate-400 dark:text-slate-500';
  if (p >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (p >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBar(p: number | null) {
  if (p === null) return 'bg-slate-200 dark:bg-slate-700';
  if (p >= 80) return 'bg-emerald-500';
  if (p >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

function semaforo(s?: string) {
  if (s === 'VERDE')    return { color: 'bg-emerald-500', label: 'VERDE',    icon: CheckCircle2 };
  if (s === 'AMARILLO') return { color: 'bg-amber-500',   label: 'AMARILLO', icon: AlertTriangle };
  return                       { color: 'bg-red-500',     label: 'ROJO',     icon: XCircle };
}

function formatTs(ts: FSTimestamp | undefined) {
  if (!ts) return '—';
  return ts.toDate().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── component ─────────────────────────────────────────────────────────────────

const AtencionCliente: React.FC = () => {
  const [conversations, setConversations]   = useState<Conversation[]>([]);
  const [search, setSearch]                 = useState('');
  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [evaluation, setEvaluation]         = useState<Evaluation | null>(null);
  const [evaluating, setEvaluating]         = useState(false);
  const [evalError, setEvalError]           = useState<string | null>(null);
  const [loadingEval, setLoadingEval]       = useState(false);

  // Load conversations
  useEffect(() => {
    const q = query(collection(db, 'waConversations'), orderBy('lastMessageAt', 'desc'));
    return onSnapshot(q, snap => {
      setConversations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation)));
    });
  }, []);

  // Load latest evaluation when conversation changes
  useEffect(() => {
    if (!selectedId) { setEvaluation(null); return; }
    setLoadingEval(true);
    setEvaluation(null);
    setEvalError(null);
    apiFetch<Evaluation[]>(`/api/wa/evaluations?conversationId=${selectedId}&limit=1`)
      .then(data => setEvaluation(data[0] ?? null))
      .catch(() => {})
      .finally(() => setLoadingEval(false));
  }, [selectedId]);

  const handleEvaluate = useCallback(async () => {
    if (!selectedId) return;
    setEvaluating(true);
    setEvalError(null);
    try {
      const result: Evaluation = await apiFetch<Evaluation>('/api/wa/evaluate', {
        method: 'POST',
        body: JSON.stringify({ conversationId: selectedId }),
      });
      setEvaluation(result);
    } catch (err: any) {
      setEvalError(err?.message || 'Error al evaluar');
    } finally {
      setEvaluating(false);
    }
  }, [selectedId]);

  const filtered = conversations.filter(c =>
    c.contactName.toLowerCase().includes(search.toLowerCase()) ||
    c.contactPhone.includes(search) ||
    (c.condoName || '').toLowerCase().includes(search.toLowerCase())
  );

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: conversation list ── */}
      <div className="w-72 shrink-0 border-r border-slate-200 dark:border-white/5 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-white/5">
          <PageHeader title="Atención al Cliente" subtitle="Auditoría de calidad IA" className="mb-3" />
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar conversación…"
              className="pl-9 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-center text-sm text-slate-400 dark:text-slate-500 mt-8 px-4">
              No hay conversaciones
            </p>
          )}
          {filtered.map(conv => (
            <button
              key={conv.id}
              onClick={() => setSelectedId(conv.id)}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-slate-100 dark:border-white/5',
                'hover:bg-slate-50 dark:hover:bg-white/5 transition-colors',
                selectedId === conv.id && 'bg-blue-50 dark:bg-blue-500/10 border-l-2 border-l-blue-500'
              )}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <User size={13} className="text-slate-500 dark:text-slate-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{conv.contactName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{conv.lastMessage}</p>
                  {conv.condoName && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-0.5">
                      <Building2 size={10} />{conv.condoName}
                    </p>
                  )}
                </div>
                <ChevronRight size={14} className="text-slate-300 shrink-0 mt-1" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: evaluation panel ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedId ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3">
            <BarChart3 size={48} className="text-slate-300 dark:text-slate-600" />
            <p className="font-medium text-slate-500 dark:text-slate-400">Selecciona una conversación</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 max-w-xs">
              Elige un chat de la lista para ver su evaluación de calidad o generar una nueva.
            </p>
          </div>
        ) : loadingEval ? (
          <div className="h-full flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="max-w-3xl mx-auto space-y-5"
            >
              {/* Contact header */}
              {selectedConv && (
                <Card className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
                    <MessageCircle size={18} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{selectedConv.contactName}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-3 flex-wrap mt-0.5">
                      <span className="flex items-center gap-1"><Phone size={11} />{selectedConv.contactPhone}</span>
                      {selectedConv.condoName && <span className="flex items-center gap-1"><Building2 size={11} />{selectedConv.condoName}</span>}
                    </p>
                  </div>
                  <Button
                    onClick={handleEvaluate}
                    loading={evaluating}
                    icon={evaluating ? undefined : Star}
                    size="sm"
                    variant={evaluation ? 'secondary' : 'primary'}
                  >
                    {evaluating ? 'Evaluando…' : evaluation ? 'Re-evaluar' : 'Evaluar con IA'}
                  </Button>
                </Card>
              )}

              {/* Error */}
              {evalError && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 text-sm">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  {evalError}
                </div>
              )}

              {/* No evaluation yet */}
              {!evaluation && !evaluating && !evalError && (
                <Card className="p-8 text-center">
                  <Star size={40} className="text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <p className="font-medium text-slate-500 dark:text-slate-400">Sin evaluación aún</p>
                  <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                    Presiona "Evaluar con IA" para analizar esta conversación con Claude.
                  </p>
                </Card>
              )}

              {/* Evaluation results */}
              {evaluation && <EvaluationResults eval={evaluation} />}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

// ── EvaluationResults ─────────────────────────────────────────────────────────

function EvaluationResults({ eval: ev }: { eval: Evaluation }) {
  const sem = semaforo(ev.semaforo);
  const SemIcon = sem.icon;

  return (
    <div className="space-y-4">
      {/* Score header */}
      <Card className="p-5">
        <div className="flex items-center gap-4 flex-wrap">
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-sm font-semibold', sem.color)}>
            <SemIcon size={14} />
            {sem.label}
          </div>
          <div>
            <span className={cn('text-4xl font-bold', scoreColor(ev.puntaje_total))}>
              {ev.puntaje_total !== null ? ev.puntaje_total.toFixed(1) : '—'}
            </span>
            <span className="text-slate-400 text-lg ml-1">/100</span>
          </div>
          <div className="flex-1 min-w-0 text-sm text-slate-500 dark:text-slate-400 space-y-0.5">
            <p className="flex items-center gap-1.5"><User size={12} />{ev.operador} · Turno {ev.turno}</p>
            <p className="flex items-center gap-1.5"><Building2 size={12} />{ev.comunidad}</p>
            <p className="flex items-center gap-1.5"><Calendar size={12} />{ev.fecha} · Evaluado {formatTs(ev.evaluatedAt)}</p>
          </div>
        </div>

        {/* Total score bar */}
        {ev.puntaje_total !== null && (
          <div className="mt-4">
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <motion.div
                className={cn('h-full rounded-full', scoreBar(ev.puntaje_total))}
                initial={{ width: 0 }}
                animate={{ width: `${ev.puntaje_total}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Red flags */}
      {ev.banderas_rojas.length > 0 && (
        <Card className="p-4 border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5">
          <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-400 mb-2">
            <ShieldAlert size={15} /> Banderas rojas ({ev.banderas_rojas.length})
          </p>
          <ul className="space-y-1">
            {ev.banderas_rojas.map((flag, i) => (
              <li key={i} className="text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                <span className="mt-0.5">•</span>{flag}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(KPI_META).map(([key, meta]) => {
          const ind = ev.indicadores[key as keyof typeof ev.indicadores];
          if (!ind) return null;
          const isNull = ind.puntaje === null;
          return (
            <Card key={key} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-medium text-sm">{meta.label}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {isNull ? 'N/A' : ind.valor !== null
                      ? `${ind.valor}${meta.unit ? ' ' + meta.unit : ''}`
                      : '—'}
                  </p>
                </div>
                <span className={cn('text-xl font-bold shrink-0', scoreColor(ind.puntaje))}>
                  {isNull ? '—' : ind.puntaje}
                </span>
              </div>
              {/* Score bar */}
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden mb-2">
                {!isNull && (
                  <motion.div
                    className={cn('h-full rounded-full', scoreBar(ind.puntaje))}
                    initial={{ width: 0 }}
                    animate={{ width: `${ind.puntaje ?? 0}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}
                  />
                )}
              </div>
              {ind.comentario && (
                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1">
                  <Info size={11} className="mt-0.5 shrink-0" />
                  {ind.comentario}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Resumen */}
      {ev.resumen && (
        <Card className="p-4">
          <p className="font-medium text-sm mb-1.5 flex items-center gap-1.5">
            <BarChart3 size={14} className="text-blue-500" /> Resumen del auditor
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{ev.resumen}</p>
        </Card>
      )}
    </div>
  );
}

export default AtencionCliente;
