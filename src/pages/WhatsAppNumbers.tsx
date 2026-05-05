import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { motion } from 'motion/react';
import {
  MessageCircle, Plus, Trash2, RefreshCw, Wifi, WifiOff, Loader2,
  Users, Phone, Edit2, Check, X, AlertCircle, QrCode, Clock,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Field, Modal, Badge } from '../components/ui';
import { api } from '../lib/apiBase';
import { getDocs, where } from 'firebase/firestore';

// ── types ─────────────────────────────────────────────────────────────────────

interface AssignedUser { uid: string; name: string; }

interface WaNumber {
  id: string;
  name: string;
  phone: string;
  status: 'disconnected' | 'connecting' | 'qr' | 'authenticated' | 'ready';
  qrDataUrl?: string | null;
  assignedUsers?: AssignedUser[];
  lastError?: string | null;
}

interface OperatorOption { uid: string; name: string; }

interface ResponseStats { count: number; totalMs: number; minMs: number | null; maxMs: number; }
interface WaConversation { id: string; waNumberId: string; responseStats?: ResponseStats; }

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WaNumber['status'] }) {
  const map = {
    disconnected:  { label: 'Desconectado', variant: 'muted'   as const, icon: WifiOff },
    connecting:    { label: 'Conectando…',  variant: 'warn'    as const, icon: Loader2 },
    qr:            { label: 'Escanear QR',  variant: 'warn'    as const, icon: QrCode  },
    authenticated: { label: 'Autenticando', variant: 'warn'    as const, icon: Loader2 },
    ready:         { label: 'Conectado',    variant: 'success' as const, icon: Wifi    },
  };
  const s = map[status] ?? map.disconnected;
  const Icon = s.icon;
  return (
    <Badge variant={s.variant}>
      <Icon size={11} className={status === 'connecting' || status === 'authenticated' ? 'animate-spin' : ''} />
      {s.label}
    </Badge>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

const WhatsAppNumbers: React.FC = () => {
  const [numbers, setNumbers]           = useState<WaNumber[]>([]);
  const [operators, setOperators]       = useState<OperatorOption[]>([]);
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [error, setError]         = useState<string | null>(null);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding]   = useState(false);

  // Edit modal
  const [editTarget, setEditTarget]         = useState<WaNumber | null>(null);
  const [editName, setEditName]             = useState('');
  const [editSelected, setEditSelected]     = useState<Set<string>>(new Set());
  const [saving, setSaving]                 = useState(false);

  // Per-card busy state
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Firestore subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'waNumbers'), orderBy('createdAt'));
    return onSnapshot(q, snap => {
      setNumbers(snap.docs.map(d => ({ id: d.id, ...d.data() } as WaNumber)));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'waConversations'), orderBy('lastMessageAt', 'desc'));
    return onSnapshot(q, snap => {
      setConversations(snap.docs.map(d => ({ id: d.id, ...d.data() } as WaConversation)));
    });
  }, []);

  // ── Load operators ────────────────────────────────────────────────────────
  useEffect(() => {
    getDocs(query(
      collection(db, 'users'),
      where('role', 'in', ['operator', 'administrador', 'condo_admin']),
    )).then(snap => {
      setOperators(snap.docs.map(d => ({ uid: d.id, name: d.data().name || d.data().email || d.id })));
    }).catch(() => {});
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const apiCall = async (method: string, path: string, body?: object) => {
    const res = await fetch(api(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    return data;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true); setError(null);
    try {
      await apiCall('POST', '/api/wa/numbers', { name: newName.trim() });
      setNewName(''); setShowAdd(false);
    } catch (err: any) { setError(err.message); }
    finally { setAdding(false); }
  };

  const handleConnect = async (id: string) => {
    setBusyId(id); setError(null);
    try { await apiCall('POST', `/api/wa/numbers/${id}/connect`); }
    catch (err: any) { setError(err.message); }
    finally { setBusyId(null); }
  };

  const handleDisconnect = async (id: string) => {
    setBusyId(id);
    try { await apiCall('POST', `/api/wa/numbers/${id}/disconnect`); }
    catch (err: any) { setError(err.message); }
    finally { setBusyId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este número? Se desconectará y eliminará permanentemente.')) return;
    setBusyId(id);
    try { await apiCall('DELETE', `/api/wa/numbers/${id}`); }
    catch (err: any) { setError(err.message); }
    finally { setBusyId(null); }
  };

  const openEdit = (num: WaNumber) => {
    setEditTarget(num);
    setEditName(num.name);
    setEditSelected(new Set((num.assignedUsers || []).map(u => u.uid)));
    setError(null);
  };

  const toggleOperator = (uid: string) => {
    setEditSelected(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      const assignedUsers = operators
        .filter(op => editSelected.has(op.uid))
        .map(op => ({ uid: op.uid, name: op.name }));
      await apiCall('PUT', `/api/wa/numbers/${editTarget.id}`, {
        name: editName.trim(),
        assignedUsers,
      });
      setEditTarget(null);
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <PageHeader
        icon={MessageCircle}
        title="WhatsApp — Números"
        description="Gestiona los números de WhatsApp conectados a Portería Virtual."
        actions={
          <Button icon={Plus} onClick={() => { setShowAdd(true); setError(null); }}>
            Agregar número
          </Button>
        }
      />

      {error && (
        <Card variant="glass" className="border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10">
          <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
            <AlertCircle size={18} />
            <p className="text-sm font-medium">{error}</p>
          </div>
        </Card>
      )}

      {numbers.length === 0 ? (
        <Card variant="glass" className="py-16 text-center">
          <MessageCircle size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <p className="font-semibold text-slate-600 dark:text-slate-400">Sin números de WhatsApp</p>
          <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">Agrega el primer número para comenzar.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {numbers.map(num => {
            const assigned = num.assignedUsers || [];
            return (
              <Card key={num.id} variant="glass" className="space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <MessageCircle size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">{num.name}</p>
                      {num.phone && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                          <Phone size={10} />{num.phone}
                        </p>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={num.status} />
                </div>

                {/* QR Code */}
                {num.status === 'qr' && num.qrDataUrl && (
                  <div className="flex flex-col items-center gap-2 p-3 bg-white dark:bg-white rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-semibold text-slate-600 text-center">
                      Escanea con WhatsApp en tu teléfono
                    </p>
                    <img src={num.qrDataUrl} alt="QR WhatsApp" className="w-48 h-48 object-contain" />
                  </div>
                )}

                {/* Assigned operators */}
                {assigned.length > 0 && (
                  <div className="bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      <Users size={10} /> Operadores asignados
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {assigned.map(u => (
                        <span key={u.uid} className="text-xs bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-full px-2 py-0.5">
                          {u.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Init error */}
                {num.lastError && num.status === 'disconnected' && (
                  <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    <span className="break-all">{num.lastError}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-white/5">
                  {num.status === 'disconnected' || num.status === undefined ? (
                    <div className="flex-1 relative group">
                      <Button
                        variant="secondary"
                        icon={busyId === num.id ? RefreshCw : Wifi}
                        onClick={() => assigned.length > 0 ? handleConnect(num.id) : undefined}
                        loading={busyId === num.id}
                        disabled={assigned.length === 0}
                        className={`w-full ${assigned.length > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-50 cursor-not-allowed'}`}
                      >
                        Conectar
                      </Button>
                      {assigned.length === 0 && (
                        <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap">
                          Asigna al menos un operador primero
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      icon={WifiOff}
                      onClick={() => handleDisconnect(num.id)}
                      loading={busyId === num.id}
                      className="flex-1"
                      disabled={busyId === num.id}
                    >
                      Desconectar
                    </Button>
                  )}
                  <Button variant="secondary" icon={Edit2} onClick={() => openEdit(num)} aria-label="Editar" />
                  <Button variant="secondary" icon={Trash2} onClick={() => handleDelete(num.id)}
                    loading={busyId === num.id} className="text-red-500" aria-label="Eliminar" />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Response time metrics ── */}
      {numbers.length > 0 && (() => {
        const rows = numbers.map(num => {
          const convs = conversations.filter(c => c.waNumberId === num.id && c.responseStats && c.responseStats.count > 0);
          if (convs.length === 0) return { num, count: 0, avgMs: null, minMs: null, maxMs: null };
          const count   = convs.reduce((s, c) => s + c.responseStats!.count, 0);
          const totalMs = convs.reduce((s, c) => s + c.responseStats!.totalMs, 0);
          const minMs   = convs.reduce((m, c) => m === null ? c.responseStats!.minMs : Math.min(m!, c.responseStats!.minMs!), null as number | null);
          const maxMs   = convs.reduce((m, c) => Math.max(m, c.responseStats!.maxMs), 0);
          return { num, count, avgMs: totalMs / count, minMs, maxMs };
        }).filter(r => r.count > 0);

        if (rows.length === 0) return null;
        return (
          <Card variant="glass">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={16} className="text-blue-500" />
              <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Tiempos de Respuesta</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                    <th className="text-left pb-2 font-semibold">Número</th>
                    <th className="text-right pb-2 font-semibold">Respuestas</th>
                    <th className="text-right pb-2 font-semibold">Promedio</th>
                    <th className="text-right pb-2 font-semibold">Mínimo</th>
                    <th className="text-right pb-2 font-semibold">Máximo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {rows.map(({ num, count, avgMs, minMs, maxMs }) => (
                    <tr key={num.id} className="text-slate-700 dark:text-slate-300">
                      <td className="py-2 font-medium">{num.name}</td>
                      <td className="py-2 text-right tabular-nums">{count}</td>
                      <td className="py-2 text-right tabular-nums text-blue-600 dark:text-blue-400 font-semibold">{fmtDuration(avgMs!)}</td>
                      <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{minMs !== null ? fmtDuration(minMs) : '—'}</td>
                      <td className="py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtDuration(maxMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      {/* ── Add modal ── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="sm">
        <h2 className="text-slate-900 dark:text-white mb-4">Agregar número de WhatsApp</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <Field label="Nombre identificador" required>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ej: Portería Norte"
              autoFocus
            />
          </Field>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancelar</Button>
            <Button type="submit" loading={adding} className="flex-1">Agregar</Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit modal ── */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} size="sm">
        <h2 className="text-slate-900 dark:text-white mb-4">Editar número</h2>
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <Field label="Nombre" required>
            <Input value={editName} onChange={e => setEditName(e.target.value)} />
          </Field>

          <Field label="Operadores asignados">
            <div className="rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 max-h-52 overflow-y-auto">
              {operators.length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-3">Sin operadores disponibles</p>
              ) : operators.map(op => {
                const checked = editSelected.has(op.uid);
                return (
                  <label key={op.uid} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                    <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-white/20'}`}>
                      {checked && <Check size={11} className="text-white" strokeWidth={3} />}
                    </span>
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleOperator(op.uid)} />
                    <span className="text-sm text-slate-800 dark:text-slate-200">{op.name}</span>
                  </label>
                );
              })}
            </div>
            {editSelected.size > 0 && (
              <p className="text-xs text-slate-500 mt-1">{editSelected.size} operador{editSelected.size !== 1 ? 'es' : ''} seleccionado{editSelected.size !== 1 ? 's' : ''}</p>
            )}
          </Field>

          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={() => setEditTarget(null)} className="flex-1">Cancelar</Button>
            <Button type="submit" loading={saving} icon={Check} className="flex-1">Guardar</Button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
};

export default WhatsAppNumbers;
