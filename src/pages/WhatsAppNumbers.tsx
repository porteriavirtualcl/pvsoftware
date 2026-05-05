import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { motion } from 'motion/react';
import {
  MessageCircle, Plus, Trash2, RefreshCw, Wifi, WifiOff, Loader2,
  User, Phone, Edit2, Check, X, AlertCircle, QrCode,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Field, Modal, Spinner, Badge } from '../components/ui';
import { api } from '../lib/apiBase';
import { useAuth } from '../hooks/useAuth';
import { getDocs, where } from 'firebase/firestore';

// ── types ─────────────────────────────────────────────────────────────────────

interface WaNumber {
  id: string;
  name: string;
  phone: string;
  status: 'disconnected' | 'connecting' | 'qr' | 'authenticated' | 'ready';
  qrDataUrl?: string | null;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
}

interface OperatorOption { uid: string; name: string; }

// ── helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WaNumber['status'] }) {
  const map = {
    disconnected:   { label: 'Desconectado', variant: 'muted'    as const, icon: WifiOff },
    connecting:     { label: 'Conectando…',  variant: 'warn'     as const, icon: Loader2 },
    qr:             { label: 'Escanear QR',  variant: 'warn'     as const, icon: QrCode  },
    authenticated:  { label: 'Autenticando', variant: 'warn'     as const, icon: Loader2 },
    ready:          { label: 'Conectado',    variant: 'success'  as const, icon: Wifi    },
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
  const { user } = useAuth();
  const [numbers, setNumbers]       = useState<WaNumber[]>([]);
  const [operators, setOperators]   = useState<OperatorOption[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Add modal
  const [showAdd, setShowAdd]       = useState(false);
  const [newName, setNewName]       = useState('');
  const [adding, setAdding]         = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<WaNumber | null>(null);
  const [editName, setEditName]     = useState('');
  const [editAssign, setEditAssign] = useState('');
  const [saving, setSaving]         = useState(false);

  // Actions state per card
  const [busyId, setBusyId]         = useState<string | null>(null);

  // ── Firestore subscription ────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'waNumbers'), orderBy('createdAt'));
    const unsub = onSnapshot(q, snap => {
      setNumbers(snap.docs.map(d => ({ id: d.id, ...d.data() } as WaNumber)));
    });
    return () => unsub();
  }, []);

  // ── Load operators for assignment dropdown ────────────────────────────────
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
    setAdding(true);
    setError(null);
    try {
      await apiCall('POST', '/api/wa/numbers', { name: newName.trim() });
      setNewName('');
      setShowAdd(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleConnect = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await apiCall('POST', `/api/wa/numbers/${id}/connect`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    setBusyId(id);
    try {
      await apiCall('POST', `/api/wa/numbers/${id}/disconnect`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este número de WhatsApp? Se desconectará y eliminará permanentemente.')) return;
    setBusyId(id);
    try {
      await apiCall('DELETE', `/api/wa/numbers/${id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (num: WaNumber) => {
    setEditTarget(num);
    setEditName(num.name);
    setEditAssign(num.assignedUserId || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      const op = operators.find(o => o.uid === editAssign);
      await apiCall('PUT', `/api/wa/numbers/${editTarget.id}`, {
        name: editName.trim(),
        assignedUserId:   editAssign || null,
        assignedUserName: op?.name || null,
      });
      setEditTarget(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
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
          {numbers.map(num => (
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

              {/* Assigned operator */}
              {num.assignedUserName && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2">
                  <User size={12} />
                  <span>Asignado a: <strong className="text-slate-700 dark:text-slate-300">{num.assignedUserName}</strong></span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-white/5">
                {num.status === 'disconnected' || num.status === undefined ? (
                  <Button
                    variant="secondary"
                    icon={busyId === num.id ? RefreshCw : Wifi}
                    onClick={() => handleConnect(num.id)}
                    loading={busyId === num.id}
                    className="flex-1 text-emerald-600 dark:text-emerald-400"
                  >
                    Conectar
                  </Button>
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
          ))}
        </div>
      )}

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
          <Field label="Asignar a operador">
            <select
              value={editAssign}
              onChange={e => setEditAssign(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="">Sin asignar</option>
              {operators.map(op => (
                <option key={op.uid} value={op.uid}>{op.name}</option>
              ))}
            </select>
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
