import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import {
  collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc,
  Timestamp, orderBy, getDoc, setDoc,
} from 'firebase/firestore';
import {
  AlertOctagon, Plus, Edit2, Trash2, CheckCircle2, XCircle, ChevronDown,
  Settings, DollarSign,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, cn } from '../../lib/utils';
import { Button, Card, Field, Input, Modal, Badge, StatCard, EmptyState, Spinner } from '../../components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Multa {
  id: string;
  condoId: string;
  condoName: string;
  residenteId: string;
  residenteNombre: string;
  unidad: string;
  nivel: 'baja' | 'media' | 'alta';
  factorUtm: number;
  valorUtm: number;
  monto: number;
  descripcion: string;
  estado: 'pendiente' | 'pagada' | 'condonada';
  fecha: string;
  createdAt: any;
}

interface Props {
  condoId: string;
  condoName: string;
  condos: { id: string; name: string }[];
  isGlobal: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const UTM_DEFAULT = 68306; // CLP — actualizar mensualmente

const NIVELES: Record<Multa['nivel'], { label: string; factor: number; variant: 'warn' | 'danger' | 'brand'; color: string }> = {
  baja:  { label: 'Cortesía Baja',  factor: 1, variant: 'warn',   color: 'text-amber-600 dark:text-amber-400'  },
  media: { label: 'Cortesía Media', factor: 3, variant: 'danger', color: 'text-orange-600 dark:text-orange-400' },
  alta:  { label: 'Cortesía Alta',  factor: 5, variant: 'brand',  color: 'text-red-600 dark:text-red-400'      },
};

const ESTADO_BADGE: Record<Multa['estado'], { variant: 'warn' | 'success' | 'muted'; label: string }> = {
  pendiente:  { variant: 'warn',    label: 'Pendiente'  },
  pagada:     { variant: 'success', label: 'Pagada'     },
  condonada:  { variant: 'muted',   label: 'Condonada'  },
};

const selectClass = 'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';

const formatCLP = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function MultasTab({ condoId, condoName, condos, isGlobal }: Props) {
  const [multas,      setMultas]      = useState<Multa[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [valorUtm,    setValorUtm]    = useState(UTM_DEFAULT);
  const [showModal,   setShowModal]   = useState(false);
  const [editingM,    setEditingM]    = useState<Multa | null>(null);
  const [deletingM,   setDeletingM]   = useState<Multa | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [showUtmModal,setShowUtmModal]= useState(false);
  const [utmInput,    setUtmInput]    = useState('');

  const [form, setForm] = useState({
    residenteNombre: '',
    unidad: '',
    nivel: 'baja' as Multa['nivel'],
    descripcion: '',
    fecha: new Date().toISOString().split('T')[0],
    condoId: condoId,
  });

  // ── Load UTM value ──────────────────────────────────────────────────────────
  useEffect(() => {
    getDoc(doc(db, 'config', 'utm')).then(snap => {
      if (snap.exists()) setValorUtm(snap.data().valor ?? UTM_DEFAULT);
    }).catch(() => {});
  }, []);

  // ── Load multas ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const cid = condoId || condos[0]?.id;
    if (!cid) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(
      query(collection(db, `condos/${cid}/multas`), orderBy('createdAt', 'desc')),
      snap => {
        setMultas(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Multa[]);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [condoId, condos]);

  const targetCondoId = form.condoId || condoId || condos[0]?.id || '';

  const openCreate = () => {
    setEditingM(null);
    setForm({
      residenteNombre: '', unidad: '', nivel: 'baja', descripcion: '',
      fecha: new Date().toISOString().split('T')[0], condoId: condoId,
    });
    setShowModal(true);
  };

  const openEdit = (m: Multa) => {
    setEditingM(m);
    setForm({
      residenteNombre: m.residenteNombre, unidad: m.unidad, nivel: m.nivel,
      descripcion: m.descripcion, fecha: m.fecha, condoId: m.condoId,
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const nivelData = NIVELES[form.nivel];
    const monto = nivelData.factor * valorUtm;
    const cid = targetCondoId;
    const cName = condos.find(c => c.id === cid)?.name || condoName;
    try {
      const data: Partial<Multa> = {
        condoId: cid,
        condoName: cName,
        residenteId: '',
        residenteNombre: form.residenteNombre,
        unidad: form.unidad,
        nivel: form.nivel,
        factorUtm: nivelData.factor,
        valorUtm,
        monto,
        descripcion: form.descripcion,
        estado: 'pendiente',
        fecha: form.fecha,
        updatedAt: Timestamp.now(),
      } as any;
      if (editingM) {
        await updateDoc(doc(db, `condos/${cid}/multas`, editingM.id), data);
      } else {
        await addDoc(collection(db, `condos/${cid}/multas`), { ...data, createdAt: Timestamp.now() });
      }
      setShowModal(false);
    } catch (err) {
      handleFirestoreError(err, editingM ? OperationType.UPDATE : OperationType.CREATE, 'multas');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingM) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, `condos/${deletingM.condoId}/multas`, deletingM.id));
      setDeletingM(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'multas');
    } finally {
      setDeleting(false);
    }
  };

  const cambiarEstado = async (m: Multa, estado: Multa['estado']) => {
    await updateDoc(doc(db, `condos/${m.condoId}/multas`, m.id), { estado, updatedAt: Timestamp.now() });
  };

  const handleSaveUtm = async () => {
    const val = parseFloat(utmInput);
    if (!val || val < 1) return;
    await setDoc(doc(db, 'config', 'utm'), { valor: val, actualizadaEl: Timestamp.now() }, { merge: true });
    setValorUtm(val);
    setShowUtmModal(false);
  };

  const pendientes = multas.filter(m => m.estado === 'pendiente');
  const totalPendiente = pendientes.reduce((s, m) => s + m.monto, 0);

  return (
    <div className="space-y-5">
      {/* UTM header */}
      <Card className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Valor UTM vigente</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatCLP(valorUtm)}</p>
          <div className="flex gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
            {Object.entries(NIVELES).map(([k, v]) => (
              <span key={k}><strong className={v.color}>{v.label}</strong>: {v.factor} UTM = {formatCLP(v.factor * valorUtm)}</span>
            ))}
          </div>
        </div>
        <button
          onClick={() => { setUtmInput(valorUtm.toString()); setShowUtmModal(true); }}
          className="p-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer shrink-0"
          aria-label="Actualizar UTM"
          title="Actualizar valor UTM"
        >
          <Settings size={16} />
        </button>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Pendientes" value={pendientes.length} icon={AlertOctagon} accent="warn" />
        <StatCard label="Total por cobrar" value={`$${Math.round(totalPendiente / 1000)}K`} icon={DollarSign} accent="danger" />
        <StatCard label="Total multas" value={multas.length} icon={AlertOctagon} accent="brand" />
      </div>

      {/* Actions */}
      <div className="flex justify-end">
        <Button icon={Plus} onClick={openCreate}>Nueva multa</Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={32} /></div>
      ) : multas.length === 0 ? (
        <EmptyState
          icon={AlertOctagon}
          title="Sin multas registradas"
          description="Registra multas por infracciones al reglamento del condominio."
          action={<Button icon={Plus} onClick={openCreate}>Nueva multa</Button>}
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {multas.map(m => {
              const nivelInfo = NIVELES[m.nivel];
              const estadoInfo = ESTADO_BADGE[m.estado];
              return (
                <motion.div key={m.id} layout
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.15 }}>
                  <Card hoverable className="flex items-start gap-4">
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm',
                      m.nivel === 'baja'  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                      m.nivel === 'media' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' :
                                           'bg-red-500/10 text-red-600 dark:text-red-400',
                    )}>
                      {m.factorUtm}U
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 dark:text-white truncate">{m.residenteNombre || 'Residente'}</p>
                        {m.unidad && <span className="text-xs text-slate-500 dark:text-slate-400">· {m.unidad}</span>}
                        <Badge variant={nivelInfo.variant}>{nivelInfo.label}</Badge>
                        <Badge variant={estadoInfo.variant}>{estadoInfo.label}</Badge>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{m.descripcion || '—'} · {m.fecha}</p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-bold text-lg text-slate-900 dark:text-white">{formatCLP(m.monto)}</p>
                      <p className="text-xs text-slate-400">{m.factorUtm} UTM</p>
                    </div>

                    <div className="flex flex-col gap-1 shrink-0">
                      {m.estado === 'pendiente' && (
                        <>
                          <button onClick={() => cambiarEstado(m, 'pagada')}
                            className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition-colors cursor-pointer"
                            aria-label="Marcar pagada" title="Pagada">
                            <CheckCircle2 size={14} />
                          </button>
                          <button onClick={() => cambiarEstado(m, 'condonada')}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-500/10 dark:hover:text-amber-400 transition-colors cursor-pointer"
                            aria-label="Condonar" title="Condonar">
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                      <button onClick={() => openEdit(m)}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer"
                        aria-label="Editar">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setDeletingM(m)}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                        aria-label="Eliminar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editingM ? 'Editar multa' : 'Nueva multa'} icon={AlertOctagon} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Residente / Nombre" required>
              <Input required value={form.residenteNombre}
                onChange={e => setForm(f => ({ ...f, residenteNombre: e.target.value }))}
                placeholder="Nombre del residente" />
            </Field>
            <Field label="Unidad">
              <Input value={form.unidad}
                onChange={e => setForm(f => ({ ...f, unidad: e.target.value }))}
                placeholder="Depto 101" />
            </Field>
          </div>

          <Field label="Nivel de cortesía" required>
            <div className="relative">
              <select value={form.nivel}
                onChange={e => setForm(f => ({ ...f, nivel: e.target.value as Multa['nivel'] }))}
                className={selectClass}>
                {Object.entries(NIVELES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label} — {v.factor} UTM ({formatCLP(v.factor * valorUtm)})</option>
                ))}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          {/* Monto preview */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
            <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
              {NIVELES[form.nivel].factor} UTM × {formatCLP(valorUtm)}
            </p>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">
              = {formatCLP(NIVELES[form.nivel].factor * valorUtm)}
            </p>
          </div>

          {isGlobal && (
            <Field label="Condominio">
              <div className="relative">
                <select value={form.condoId}
                  onChange={e => setForm(f => ({ ...f, condoId: e.target.value }))}
                  className={selectClass}>
                  {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </Field>
          )}

          <Field label="Descripción / Motivo">
            <Input value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Ruidos molestos, mascotas sin correa…" />
          </Field>

          <Field label="Fecha">
            <Input type="date" value={form.fecha}
              onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
          </Field>

          <Button type="submit" fullWidth loading={saving} icon={AlertOctagon}>
            {saving ? 'Guardando…' : editingM ? 'Guardar cambios' : 'Registrar multa'}
          </Button>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deletingM} onClose={() => setDeletingM(null)}
        title="¿Eliminar multa?" icon={Trash2} size="sm">
        {deletingM && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Se eliminará la multa de <strong className="text-slate-900 dark:text-white">{deletingM.residenteNombre}</strong> ({formatCLP(deletingM.monto)}).
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

      {/* UTM modal */}
      <Modal open={showUtmModal} onClose={() => setShowUtmModal(false)}
        title="Actualizar valor UTM" icon={Settings} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            El valor de la UTM cambia mensualmente. Actualízalo según el SII.
          </p>
          <Field label="Valor UTM (CLP)" required>
            <Input
              type="number"
              min="1"
              autoFocus
              value={utmInput}
              onChange={e => setUtmInput(e.target.value)}
              placeholder="68306"
              className="text-lg font-semibold"
            />
          </Field>
          <Button fullWidth icon={Settings} onClick={handleSaveUtm}>
            Guardar UTM
          </Button>
        </div>
      </Modal>
    </div>
  );
}
