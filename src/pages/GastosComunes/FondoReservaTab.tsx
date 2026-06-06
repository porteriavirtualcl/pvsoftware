import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import {
  collection, query, onSnapshot, addDoc, doc, deleteDoc,
  Timestamp, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  PiggyBank, Plus, Trash2, TrendingUp, TrendingDown, ChevronDown,
  Upload, FileText, FileImage, ExternalLink, X as XIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, cn } from '../../lib/utils';
import { Button, Card, Field, Input, Modal, Badge, StatCard, EmptyState, Spinner } from '../../components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Movimiento {
  id: string;
  condoId: string;
  tipo: 'ingreso' | 'egreso';
  categoria: string;
  descripcion: string;
  monto: number;
  fecha: string;
  documentUrl?: string;
  documentName?: string;
  documentType?: string;
  createdAt: any;
}

interface Props {
  condoId: string;
  condoName: string;
  condos: { id: string; name: string }[];
  isGlobal: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CATEGORIAS_INGRESO  = ['Cobro mensual', 'Transferencia', 'Multa', 'Interés', 'Otro'];
const CATEGORIAS_EGRESO   = ['Mantención', 'Reparación', 'Administración', 'Servicios', 'Otro'];

const selectClass = 'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';
const formatCLP  = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const formatCLPc = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function FondoReservaTab({ condoId, condoName, condos, isGlobal }: Props) {
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [deletingM,   setDeletingM]   = useState<Movimiento | null>(null);
  const [deleting,    setDeleting]    = useState(false);
  const [attachFile,  setAttachFile]  = useState<File | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    tipo: 'ingreso' as 'ingreso' | 'egreso',
    categoria: '',
    descripcion: '',
    monto: '',
    fecha: new Date().toISOString().split('T')[0],
  });

  const targetCondoId = condoId || condos[0]?.id || '';

  // ── Load movimientos ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!targetCondoId) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(
      query(collection(db, `condos/${targetCondoId}/fondo_reserva`), orderBy('fecha', 'desc')),
      snap => {
        setMovimientos(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Movimiento[]);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [targetCondoId]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const totalIngresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
  const totalEgresos  = movimientos.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0);
  const saldo         = totalIngresos - totalEgresos;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const openCreate = (tipo: 'ingreso' | 'egreso') => {
    setForm({
      tipo,
      categoria: tipo === 'ingreso' ? CATEGORIAS_INGRESO[0] : CATEGORIAS_EGRESO[0],
      descripcion: '',
      monto: '',
      fecha: new Date().toISOString().split('T')[0],
    });
    setAttachFile(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCondoId) return;
    setSaving(true);
    try {
      const monto = parseFloat(form.monto.replace(/\./g, '').replace(',', '.')) || 0;
      const docRef = await addDoc(collection(db, `condos/${targetCondoId}/fondo_reserva`), {
        condoId: targetCondoId,
        tipo: form.tipo,
        categoria: form.categoria,
        descripcion: form.descripcion,
        monto,
        fecha: form.fecha,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      if (attachFile) {
        setUploading(true);
        const ext = attachFile.name.split('.').pop()?.toLowerCase() || 'bin';
        const storageRef = ref(storage, `condos/${targetCondoId}/fondo_reserva/${docRef.id}/comprobante.${ext}`);
        await uploadBytes(storageRef, attachFile);
        const url = await getDownloadURL(storageRef);
        await import('firebase/firestore').then(({ updateDoc }) =>
          updateDoc(doc(db, `condos/${targetCondoId}/fondo_reserva`, docRef.id), {
            documentUrl: url,
            documentName: attachFile.name,
            documentType: attachFile.type,
          })
        );
        setUploading(false);
      }
      setShowModal(false);
      setAttachFile(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'fondo_reserva');
      setUploading(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingM || !targetCondoId) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, `condos/${targetCondoId}/fondo_reserva`, deletingM.id));
      setDeletingM(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'fondo_reserva');
    } finally {
      setDeleting(false);
    }
  };

  const categorias = form.tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_EGRESO;

  if (loading) return <div className="flex justify-center py-12"><Spinner size={32} /></div>;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Saldo actual"    value={formatCLPc(saldo)}         icon={PiggyBank}    accent={saldo >= 0 ? 'success' : 'danger'} />
        <StatCard label="Total ingresos"  value={formatCLPc(totalIngresos)} icon={TrendingUp}   accent="success" />
        <StatCard label="Total egresos"   value={formatCLPc(totalEgresos)}  icon={TrendingDown} accent="danger"  />
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" icon={TrendingDown} onClick={() => openCreate('egreso')}>Egreso</Button>
        <Button icon={TrendingUp} onClick={() => openCreate('ingreso')}>Ingreso</Button>
      </div>

      {/* Ledger */}
      {movimientos.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="Sin movimientos"
          description="Registra ingresos y egresos del fondo de reserva del condominio."
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {movimientos.map(m => (
              <motion.div key={m.id} layout
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.14 }}>
                <Card hoverable className="flex items-center gap-4">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    m.tipo === 'ingreso'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-500/10 text-red-600 dark:text-red-400',
                  )}>
                    {m.tipo === 'ingreso' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {m.descripcion || m.categoria}
                      </p>
                      <Badge variant={m.tipo === 'ingreso' ? 'success' : 'danger'}>
                        {m.categoria}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{m.fecha}</p>
                  </div>

                  {m.documentUrl && (
                    <a href={m.documentUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0">
                      {m.documentType?.startsWith('image/') ? <FileImage size={13} /> : <FileText size={13} />}
                      <ExternalLink size={10} />
                    </a>
                  )}

                  <p className={cn(
                    'font-bold text-lg shrink-0',
                    m.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                  )}>
                    {m.tipo === 'egreso' ? '−' : '+'}{formatCLP(m.monto)}
                  </p>

                  <button onClick={() => setDeletingM(m)}
                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                    aria-label="Eliminar">
                    <Trash2 size={14} />
                  </button>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Create modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={form.tipo === 'ingreso' ? 'Registrar ingreso' : 'Registrar egreso'}
        icon={form.tipo === 'ingreso' ? TrendingUp : TrendingDown}
        size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Categoría" required>
            <div className="relative">
              <select value={form.categoria}
                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                className={selectClass}>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Monto ($)" required>
              <Input required value={form.monto}
                onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="500.000" className="text-lg font-semibold" />
            </Field>
            <Field label="Fecha">
              <Input type="date" value={form.fecha}
                onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </Field>
          </div>

          <Field label="Descripción">
            <Input value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Detalle del movimiento…" />
          </Field>

          {/* Comprobante */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Comprobante (opcional)</p>
            {attachFile ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                {attachFile.type.startsWith('image/') ? <FileImage size={16} className="text-emerald-600 shrink-0" /> : <FileText size={16} className="text-emerald-600 shrink-0" />}
                <p className="flex-1 text-sm text-emerald-800 dark:text-emerald-200 truncate">{attachFile.name}</p>
                <button type="button" onClick={() => { setAttachFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="text-emerald-600 hover:text-red-600 transition-colors cursor-pointer shrink-0">
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer text-sm font-medium">
                <Upload size={16} /> Adjuntar imagen o PDF
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setAttachFile(f); }} />
          </div>

          <Button type="submit" fullWidth loading={saving || uploading}
            icon={form.tipo === 'ingreso' ? TrendingUp : TrendingDown}>
            {uploading ? 'Subiendo comprobante…' : saving ? 'Guardando…' : form.tipo === 'ingreso' ? 'Registrar ingreso' : 'Registrar egreso'}
          </Button>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deletingM} onClose={() => setDeletingM(null)}
        title="¿Eliminar movimiento?" icon={Trash2} size="sm">
        {deletingM && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Se eliminará el {deletingM.tipo} de <strong className="text-slate-900 dark:text-white">{formatCLP(deletingM.monto)}</strong> — {deletingM.descripcion || deletingM.categoria}.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" fullWidth onClick={() => setDeletingM(null)}>Cancelar</Button>
              <Button variant="danger" fullWidth loading={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
