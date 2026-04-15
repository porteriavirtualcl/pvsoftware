import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, deleteDoc, Timestamp, collectionGroup, orderBy } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { DollarSign, Calendar, FileText, CheckCircle, Clock, AlertTriangle, Plus, X, Trash2, Edit2, Download, TrendingUp, TrendingDown, Building2, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

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

const Expenses = () => {
  const { profile, user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    userId: '',
    userName: '',
    unit: '',
    month: 'Enero',
    year: new Date().getFullYear().toString(),
    amount: '',
    status: 'pending' as Expense['status'],
    date: new Date().toISOString().split('T')[0],
    condoId: ''
  });

  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);

  useEffect(() => {
    // Fetch condos for super_admin
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    // Expenses Query with Isolation
    let q;
    const isGlobal = profile.role === 'super_admin' || profile.condoScope === 'all';
    const isResident = profile.role === 'resident' || profile.role === 'usuario';
    if (isGlobal) {
      q = query(collectionGroup(db, 'expenses')); // no orderBy → sort client-side
    } else if (isResident) {
      q = query(collectionGroup(db, 'expenses'), where('userId', '==', user.uid));
    } else {
      const path = `condos/${profile.condoId || 'default'}/expenses`;
      q = query(collection(db, path), orderBy('date', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Expense[];
      if (isGlobal || isResident) {
        list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) * -1 || (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      }
      setExpenses(list);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'expenses');
    });

    return () => {
      unsubscribe();
      condosUnsubscribe();
    };
  }, [profile, user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);

    const selectedCondo = condos.find(c => c.id === formData.condoId);
    const condoIdToUse = formData.condoId || profile.condoId || 'default';
    const path = `condos/${condoIdToUse}/expenses`;

    try {
      const dataToSave = {
        ...formData,
        condoName: selectedCondo?.name || profile.condoName || 'Condominio',
        updatedAt: Timestamp.now()
      };

      if (editingExpense) {
        await updateDoc(doc(db, path, editingExpense.id), dataToSave);
      } else {
        await addDoc(collection(db, path), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
      setEditingExpense(null);
    } catch (error) {
       handleFirestoreError(error, editingExpense ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingExpense) return;
    const path = `condos/${deletingExpense.condoId}/expenses`;
    try {
      await deleteDoc(doc(db, path, deletingExpense.id));
      setDeletingExpense(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const updateStatus = async (expense: Expense, status: Expense['status']) => {
    const path = `condos/${expense.condoId}/expenses`;
    try {
      await updateDoc(doc(db, path, expense.id), { status });
    } catch (error) {
      console.error(error);
    }
  };

  if (loading && !expenses.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white/50 dark:bg-gray-900/50 p-6 rounded-2xl border border-slate-200 dark:border-gray-800">
        <div className="space-y-0.5">
           <div className="flex items-center gap-3">
              <DollarSign className="text-blue-500" size={24} />
              <h2 className="text-3xl font-black text-slate-900 dark:text-white italic tracking-tight uppercase">Gastos Comunes</h2>
           </div>
           <p className="text-slate-500 dark:text-gray-500 text-base font-medium italic">Control financiero, cobranza y reportes de tesorería.</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-2.5 px-5 rounded-xl transition-all shadow-xl flex items-center gap-2 text-base uppercase tracking-widest">
          <Plus size={18} /> Nueva Boleta
        </button>
      </div>

       {/* Financial Dashboard Widgets */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 relative overflow-hidden group shadow-sm dark:shadow-none">
           <div className="absolute top-0 right-0 p-6 text-blue-500/10 group-hover:scale-110 transition-transform"><TrendingUp size={32} /></div>
           <p className="text-[11px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest mb-2">Recaudado Mes</p>
           <h3 className="text-xl font-black text-slate-900 dark:text-white">$4.2M</h3>
           <p className="text-[11px] text-green-500 mt-2 font-bold uppercase tracking-tighter cursor-default">+12% vs Anterior</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 relative overflow-hidden group shadow-sm dark:shadow-none">
           <div className="absolute top-0 right-0 p-6 text-red-500/10 group-hover:scale-110 transition-transform"><TrendingDown size={32} /></div>
           <p className="text-[11px] font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest mb-2">Morosidad Total</p>
           <h3 className="text-xl font-black text-slate-900 dark:text-white">$850K</h3>
           <p className="text-[11px] text-red-500 mt-2 font-bold uppercase tracking-tighter cursor-default">-4% Eficiencia</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm dark:shadow-none">
           <p className="text-[11px] font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest mb-2">Boletas Pendientes</p>
           <h3 className="text-xl font-black text-slate-900 dark:text-white">{expenses.filter(e => e.status === 'pending').length}</h3>
           <p className="text-[11px] text-blue-500 mt-2 font-bold uppercase tracking-tighter cursor-default">En Proceso</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm dark:shadow-none">
           <p className="text-[11px] font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest mb-2">Total Registros</p>
           <h3 className="text-xl font-black text-slate-900 dark:text-white">{expenses.length}</h3>
           <p className="text-[11px] text-gray-500 mt-2 font-bold uppercase tracking-tighter cursor-default">Histórico</p>
        </div>
      </div>

       <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
        <AnimatePresence>
          {expenses.map((expense) => (
            <motion.div layout key={expense.id} className="relative group bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 hover:border-blue-500/50 transition-all shadow-sm dark:shadow-none">
                <div className="flex justify-between items-start mb-6">
                   <div className="w-12 h-12 bg-white dark:bg-gray-950 rounded-xl flex items-center justify-center text-blue-500 shadow-xl border border-slate-200 dark:border-gray-800 group-hover:scale-110 transition-transform shadow-inner"><FileText size={24} /></div>
                   <div className={`px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-widest border ${
                    expense.status === 'paid' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                    expense.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                    'bg-red-500/10 text-red-500 border-red-500/20'
                   }`}>
                    {expense.status === 'paid' ? 'Pagado' : expense.status === 'pending' ? 'Pendiente' : 'Vencido'}
                   </div>
                </div>

                <div className="space-y-0.5 mb-6">
                   <h3 className="text-xl font-black text-slate-900 dark:text-white italic uppercase">${expense.amount}</h3>
                   <div className="flex items-center gap-2 text-base text-slate-500 dark:text-gray-500 font-bold uppercase tracking-widest">
                      <Calendar size={12} /> {expense.month} {expense.year}
                   </div>
                   <div className="text-base text-blue-500 font-black uppercase italic mt-1">{expense.condoName}</div>
                </div>

                <div className="flex items-center gap-4 py-6 border-t border-slate-200 dark:border-gray-800">
                    <div className="flex-1">
                       <p className="text-[11px] font-black text-slate-400 dark:text-gray-600 uppercase mb-1">Destinatario</p>
                       <p className="text-base font-bold text-slate-700 dark:text-gray-300">{expense.userName || 'Residente'}</p>
                    </div>
                    <div className="flex-1">
                       <p className="text-[11px] font-black text-slate-400 dark:text-gray-600 uppercase mb-1">Unidad</p>
                       <p className="text-base font-bold text-slate-700 dark:text-gray-300">{expense.unit || 'Ficha'}</p>
                    </div>
                </div>

                <div className="flex gap-3 pt-8 border-t border-slate-200 dark:border-gray-800">
                   {profile?.role === 'super_admin' ? (
                     <>
                        <button onClick={() => updateStatus(expense, 'paid')} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-black py-4 rounded-xl text-base transition-all uppercase">Pagado</button>
                        <button onClick={() => setDeletingExpense(expense)} className="p-4 bg-red-600/10 text-red-500 rounded-xl hover:bg-red-600 hover:text-white transition-all"><Trash2 size={18} /></button>
                     </>
                   ) : (
                     <button className="flex-1 bg-white text-black font-black py-4 rounded-xl flex items-center justify-center gap-2 text-base uppercase tracking-widest"><Download size={14} /> Descargar PDF</button>
                   )}
                </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

       <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/40 dark:bg-black/95 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-[3rem] p-10 shadow-2xl">
                <h3 className="text-xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight mb-10">Emitir Gasto Común</h3>
                <form onSubmit={handleSave} className="space-y-8">
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-base font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Mes</label>
                        <select value={formData.month} onChange={(e) => setFormData({...formData, month: e.target.value})} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black">
                           {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-base font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">Año</label>
                        <input required type="text" value={formData.year} onChange={(e) => setFormData({...formData, year: e.target.value})} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black" />
                      </div>
                   </div>
                   <div className="space-y-2">
                      <label className="text-base font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">Monto ($)</label>
                      <input required type="text" value={formData.amount} onChange={(e) => setFormData({...formData, amount: e.target.value})} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-blue-500 font-black text-3xl" placeholder="65.000" />
                   </div>
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-base font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">Email Residente</label>
                        <input required type="email" value={formData.userName} onChange={(e) => setFormData({...formData, userName: e.target.value})} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-bold" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-base font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">Condominio</label>
                        <select value={formData.condoId} onChange={(e) => setFormData({...formData, condoId: e.target.value})} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black">
                           {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                   </div>
                   <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl">
                      {saving ? 'Procesando...' : 'Emitir Cobranza'}
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Expenses;
