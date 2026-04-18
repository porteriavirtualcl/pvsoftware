import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, deleteDoc, Timestamp, collectionGroup, orderBy } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  CreditCard, Calendar, FileText, CheckCircle2, Clock, AlertTriangle,
  Plus, Trash2, Edit2, Download, TrendingUp, TrendingDown, Building2, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';
import { PageHeader, Button, Card, Field, Input, Modal, Badge, StatCard, EmptyState, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

interface Expense {
  id: string;
  userId: string;
  userName: string;
  condoId: string;
  condoName: string;
  unit: string;
  month: string;
  year: string;
  amount: string;
  status: 'paid' | 'pending' | 'overdue';
  date: string;
  createdAt: any;
}

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const STATUS_BADGE: Record<Expense['status'], { variant: 'success'|'warn'|'danger'; label: string }> = {
  paid:    { variant: 'success', label: 'Pagado' },
  pending: { variant: 'warn',    label: 'Pendiente' },
  overdue: { variant: 'danger',  label: 'Vencido' },
};

const selectClass =
  'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';

const parseAmount = (raw: string) =>
  Number(raw.replace(/\./g, '').replace(',', '.')) || 0;

const formatCLP = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(0)}K`
    : `$${n}`;

const Expenses = () => {
  const { profile, user } = useAuth();
  const [expenses, setExpenses]       = useState<Expense[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [condos, setCondos]           = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving]           = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [deleting, setDeleting]       = useState(false);

  const [formData, setFormData] = useState({
    userId: '',
    userName: '',
    unit: '',
    month: 'Enero',
    year: new Date().getFullYear().toString(),
    amount: '',
    status: 'pending' as Expense['status'],
    date: new Date().toISOString().split('T')[0],
    condoId: '',
  });

  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), snap => {
      setCondos(snap.docs.map(d => ({ id: d.id, name: d.data().name })));
    });

    if (!profile || !user) return () => condosUnsub();

    let q;
    const isGlobal   = profile.role === 'super_admin' || profile.condoScope === 'all';
    const isResident = profile.role === 'resident' || profile.role === 'usuario';

    if (isGlobal) {
      q = query(collectionGroup(db, 'expenses'));
    } else if (isResident) {
      q = query(collectionGroup(db, 'expenses'), where('userId', '==', user.uid));
    } else {
      const path = `condos/${profile.condoId || 'default'}/expenses`;
      q = query(collection(db, path), orderBy('date', 'desc'));
    }

    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Expense[];
      if (isGlobal || isResident) {
        list.sort((a, b) =>
          (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) * -1 ||
          (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
        );
      }
      setExpenses(list);
      setLoading(false);
    }, err => {
      setLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'expenses');
    });

    return () => { unsub(); condosUnsub(); };
  }, [profile, user]);

  const openCreate = () => {
    setEditingExpense(null);
    setFormData({
      userId: '', userName: '', unit: '',
      month: 'Enero', year: new Date().getFullYear().toString(),
      amount: '', status: 'pending',
      date: new Date().toISOString().split('T')[0], condoId: '',
    });
    setShowAddModal(true);
  };

  const openEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setFormData({
      userId:   expense.userId,
      userName: expense.userName,
      unit:     expense.unit,
      month:    expense.month,
      year:     expense.year,
      amount:   expense.amount,
      status:   expense.status,
      date:     expense.date,
      condoId:  expense.condoId,
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    const selectedCondo  = condos.find(c => c.id === formData.condoId);
    const condoIdToUse   = formData.condoId || profile.condoId || 'default';
    const path           = `condos/${condoIdToUse}/expenses`;
    try {
      const dataToSave = {
        ...formData,
        condoName: selectedCondo?.name || profile.condoName || 'Condominio',
        updatedAt: Timestamp.now(),
      };
      if (editingExpense) {
        await updateDoc(doc(db, path, editingExpense.id), dataToSave);
      } else {
        await addDoc(collection(db, path), { ...dataToSave, createdAt: Timestamp.now() });
      }
      setShowAddModal(false);
      setEditingExpense(null);
    } catch (err) {
      handleFirestoreError(err, editingExpense ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingExpense) return;
    setDeleting(true);
    const path = `condos/${deletingExpense.condoId}/expenses`;
    try {
      await deleteDoc(doc(db, path, deletingExpense.id));
      setDeletingExpense(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    } finally {
      setDeleting(false);
    }
  };

  const updateStatus = async (expense: Expense, status: Expense['status']) => {
    const path = `condos/${expense.condoId}/expenses`;
    try {
      await updateDoc(doc(db, path, expense.id), { status });
    } catch (err) {
      console.error(err);
    }
  };

  const paidTotal    = expenses.filter(e => e.status === 'paid').reduce((s, e) => s + parseAmount(e.amount), 0);
  const overdueTotal = expenses.filter(e => e.status === 'overdue').reduce((s, e) => s + parseAmount(e.amount), 0);
  const pendingCount = expenses.filter(e => e.status === 'pending').length;

  if (loading && !expenses.length) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Spinner size={36} />
    </div>
  );

  const canAdmin = profile?.role === 'super_admin' || profile?.role === 'condo_admin';

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Finanzas"
        title="Gastos Comunes"
        description="Control financiero, cobranza y reportes de tesorería."
        icon={CreditCard}
        actions={
          canAdmin && (
            <Button icon={Plus} onClick={openCreate}>
              Nueva boleta
            </Button>
          )
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Recaudado"
          value={formatCLP(paidTotal)}
          icon={TrendingUp}
          accent="success"
          trend={{ value: 'Pagado', direction: 'up' }}
        />
        <StatCard
          label="Morosidad"
          value={formatCLP(overdueTotal)}
          icon={TrendingDown}
          accent="danger"
          trend={{ value: 'Vencido', direction: 'down' }}
        />
        <StatCard
          label="Pendientes"
          value={pendingCount}
          icon={Clock}
          accent="warn"
        />
        <StatCard
          label="Total registros"
          value={expenses.length}
          icon={FileText}
          accent="brand"
        />
      </div>

      {/* Expense cards */}
      {expenses.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="Sin gastos comunes registrados"
          description="Emite la primera boleta para comenzar el control de cobranza."
          action={canAdmin && <Button icon={Plus} onClick={openCreate}>Nueva boleta</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {expenses.map(expense => {
              const badge = STATUS_BADGE[expense.status];
              return (
                <motion.div
                  layout key={expense.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                >
                  <Card hoverable className="flex flex-col gap-4 h-full">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                        <FileText size={18} strokeWidth={2.2} />
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>

                    {/* Amount + period */}
                    <div>
                      <p className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                        ${expense.amount}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                        <Calendar size={12} />
                        {expense.month} {expense.year}
                      </p>
                      {expense.condoName && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-0.5">{expense.condoName}</p>
                      )}
                    </div>

                    {/* Resident + unit */}
                    <div className="flex gap-4 py-3 border-t border-slate-100 dark:border-white/5">
                      <div className="flex-1 min-w-0">
                        <p className="eyebrow mb-0.5">Destinatario</p>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                          {expense.userName || 'Residente'}
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="eyebrow mb-0.5">Unidad</p>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                          {expense.unit || '—'}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1 border-t border-slate-100 dark:border-white/5">
                      {canAdmin ? (
                        <>
                          {expense.status !== 'paid' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={CheckCircle2}
                              className="flex-1"
                              onClick={() => updateStatus(expense, 'paid')}
                            >
                              Marcar pagado
                            </Button>
                          )}
                          <button
                            onClick={() => openEdit(expense)}
                            aria-label="Editar"
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => setDeletingExpense(expense)}
                            aria-label="Eliminar"
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : (
                        <Button variant="secondary" size="sm" icon={Download} fullWidth>
                          Descargar PDF
                        </Button>
                      )}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); setEditingExpense(null); }}
        title={editingExpense ? 'Editar boleta' : 'Emitir gasto común'}
        icon={CreditCard}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Mes" required>
              <div className="relative">
                <select
                  value={formData.month}
                  onChange={e => setFormData(f => ({ ...f, month: e.target.value }))}
                  className={selectClass}
                >
                  {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </Field>
            <Field label="Año" required>
              <Input
                required
                value={formData.year}
                onChange={e => setFormData(f => ({ ...f, year: e.target.value }))}
                placeholder={new Date().getFullYear().toString()}
              />
            </Field>
          </div>

          <Field label="Monto ($)" required>
            <Input
              required
              value={formData.amount}
              onChange={e => setFormData(f => ({ ...f, amount: e.target.value }))}
              placeholder="65.000"
              className="text-lg font-semibold"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Email residente" required>
              <Input
                required
                type="email"
                value={formData.userName}
                onChange={e => setFormData(f => ({ ...f, userName: e.target.value }))}
                placeholder="residente@correo.cl"
              />
            </Field>
            <Field label="Unidad">
              <Input
                value={formData.unit}
                onChange={e => setFormData(f => ({ ...f, unit: e.target.value }))}
                placeholder="Depto 101"
              />
            </Field>
          </div>

          <Field label="Condominio">
            <div className="relative">
              <select
                value={formData.condoId}
                onChange={e => setFormData(f => ({ ...f, condoId: e.target.value }))}
                className={selectClass}
              >
                <option value="">Sin condominio asignado</option>
                {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          <Field label="Estado">
            <div className="relative">
              <select
                value={formData.status}
                onChange={e => setFormData(f => ({ ...f, status: e.target.value as Expense['status'] }))}
                className={selectClass}
              >
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
                <option value="overdue">Vencido</option>
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          <Button type="submit" fullWidth loading={saving} icon={CreditCard}>
            {saving ? 'Guardando…' : editingExpense ? 'Guardar cambios' : 'Emitir cobranza'}
          </Button>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!deletingExpense}
        onClose={() => setDeletingExpense(null)}
        title="¿Eliminar boleta?"
        icon={Trash2}
        size="sm"
      >
        {deletingExpense && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                ${deletingExpense.amount} — {deletingExpense.month} {deletingExpense.year}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{deletingExpense.userName}</p>
            </div>
            <p className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              Esta acción no se puede deshacer.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" fullWidth onClick={() => setDeletingExpense(null)}>
                Cancelar
              </Button>
              <Button variant="danger" fullWidth loading={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Expenses;
