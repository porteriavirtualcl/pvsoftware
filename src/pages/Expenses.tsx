import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CreditCard, Plus, Download, CheckCircle2, AlertCircle, FileText, TrendingUp, TrendingDown, Edit2, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp, orderBy, collectionGroup, where } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType, sendNotification } from '../lib/utils';
import { getDocs } from 'firebase/firestore';

interface Expense {
  id: string;
  month: string;
  year: string;
  amount: string;
  status: 'paid' | 'pending' | 'overdue';
  date: string;
  condoId: string;
}

const Expenses = () => {
  const { profile } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [formData, setFormData] = useState({
    month: 'Marzo',
    year: '2024',
    amount: '',
    status: 'paid' as Expense['status'],
    date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (!profile?.role) return;

    let q;
    let path = 'expenses'; // Default for collectionGroup

    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'expenses'), orderBy('date', 'desc'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      q = query(
        collectionGroup(db, 'expenses'),
        where('condoId', 'in', profile.condoIds),
        orderBy('date', 'desc')
      );
    } else if (profile.condoId) {
      path = `condos/${profile.condoId}/expenses`;
      q = query(collection(db, path), orderBy('date', 'desc'));
    } else {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Expense[];
      setExpenses(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [profile?.condoId]);

  const handleOpenAdd = () => {
    setFormData({
      month: 'Marzo',
      year: '2024',
      amount: '',
      status: 'paid',
      date: new Date().toISOString().split('T')[0]
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setFormData({
      month: expense.month,
      year: expense.year,
      amount: expense.amount,
      status: expense.status,
      date: expense.date
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.condoId) return;

    const path = `condos/${profile.condoId}/expenses`;
    try {
      if (editingExpense) {
        const docRef = doc(db, path, editingExpense.id);
        await updateDoc(docRef, {
          ...formData,
          updatedAt: Timestamp.now()
        });
      } else {
        await addDoc(collection(db, path), {
          ...formData,
          condoId: profile.condoId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });

        // Notify Residents of this condo
        try {
          const resQuery = query(collection(db, 'users'), where('role', '==', 'resident'), where('condoId', '==', profile.condoId));
          const resSnaps = await getDocs(resQuery);
          resSnaps.forEach(resDoc => {
            sendNotification(
              resDoc.id,
              'Nuevo Gasto Común',
              `Se ha publicado el gasto común de ${formData.month} ${formData.year}. Monto: $${formData.amount}`,
              'expense'
            );
          });
        } catch (nErr) {
          console.error("Error notifying residents:", nErr);
        }
      }
      setShowAddModal(false);
      setEditingExpense(null);
    } catch (error) {
      handleFirestoreError(error, editingExpense ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!profile?.condoId || !deletingExpense) return;

    const path = `condos/${profile.condoId}/expenses`;
    try {
      await deleteDoc(doc(db, path, deletingExpense.id));
      setDeletingExpense(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  if (loading && profile?.condoId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Gastos Comunes</h2>
          <p className="text-gray-400 mt-1">Consulta y paga tus gastos comunes de forma segura.</p>
        </div>
        <div className="flex gap-2">
          {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
            <button 
              onClick={handleOpenAdd}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
            >
              <Plus size={20} />
              Nuevo Gasto
            </button>
          )}
          <button className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2.5 px-6 rounded-xl transition-all">
            <FileText size={20} />
            Historial Completo
          </button>
          <button className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-green-600/20">
            <CreditCard size={20} />
            Pagar Ahora
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-lg font-bold text-white mb-4">Últimos Pagos</h3>
          {expenses.map((expense, i) => (
            <motion.div
              key={expense.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex items-center justify-between hover:border-gray-700 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-green-900/20 rounded-xl flex items-center justify-center text-green-500">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white">{expense.month} {expense.year}</h4>
                  <p className="text-sm text-gray-500">Pagado el {expense.date}</p>
                </div>
              </div>
              <div className="text-right flex items-center gap-6">
                <div>
                  <p className="text-xl font-bold text-white">${expense.amount}</p>
                  <p className={`text-xs font-bold uppercase tracking-wider ${
                    expense.status === 'paid' ? 'text-green-500' :
                    expense.status === 'pending' ? 'text-yellow-500' :
                    'text-red-500'
                  }`}>
                    {expense.status === 'paid' ? 'Pagado' : expense.status === 'pending' ? 'Pendiente' : 'Vencido'}
                  </p>
                </div>
                {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleOpenEdit(expense)}
                      className="p-2 text-gray-500 hover:text-blue-400 transition-colors" 
                      title="Editar"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => setDeletingExpense(expense)}
                      className="p-2 text-gray-500 hover:text-red-400 transition-colors" 
                      title="Eliminar"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
                <button className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-all">
                  <Download size={20} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full -mr-16 -mt-16 blur-2xl" />
            <h3 className="text-lg font-bold text-white mb-6">Resumen de Cuenta</h3>
            <div className="space-y-6">
              <div>
                <p className="text-sm text-gray-400 mb-1">Saldo Actual</p>
                <p className="text-4xl font-bold text-white">$0</p>
                <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  Al día con tus pagos
                </p>
              </div>
              <div className="pt-6 border-t border-gray-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Promedio Mensual</span>
                  <span className="text-sm font-bold text-white">$44.925</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Variación Anual</span>
                  <span className="text-sm font-bold text-red-500 flex items-center gap-1">
                    <TrendingUp size={14} />
                    +2.4%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-600 rounded-3xl p-8 text-white">
            <h3 className="text-lg font-bold mb-4">Pago Automático</h3>
            <p className="text-sm text-blue-100 mb-6 leading-relaxed">
              Activa el pago automático y olvídate de las fechas de vencimiento.
            </p>
            <button className="w-full bg-white text-blue-600 font-bold py-3 rounded-xl hover:bg-blue-50 transition-all">
              Configurar Ahora
            </button>
          </div>
        </div>
      </div>
      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingExpense) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingExpense(null); }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold text-white">
                  {editingExpense ? 'Editar Gasto' : 'Nuevo Gasto'}
                </h3>
                <button onClick={() => { setShowAddModal(false); setEditingExpense(null); }} className="text-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Mes</label>
                    <select
                      value={formData.month}
                      onChange={(e) => setFormData({ ...formData, month: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Año</label>
                    <input
                      required
                      type="text"
                      value={formData.year}
                      onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      placeholder="Ej: 2024"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Monto ($)</label>
                  <input
                    required
                    type="text"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    placeholder="Ej: 45.000"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Estado</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as Expense['status'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="paid">Pagado</option>
                      <option value="pending">Pendiente</option>
                      <option value="overdue">Vencido</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Fecha de Pago/Venc.</label>
                    <input
                      required
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 mt-4"
                >
                  {editingExpense ? 'Guardar Cambios' : 'Crear Gasto'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingExpense && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingExpense(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center text-red-500 mx-auto mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar gasto?</h3>
              <p className="text-gray-400 mb-8">
                Esta acción no se puede deshacer. Se eliminará el registro de "{deletingExpense.month} {deletingExpense.year}" permanentemente.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingExpense(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl transition-all"
                >
                  Eliminar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Expenses;
