import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Plus, User, MapPin, Phone, Mail, MoreVertical, CheckCircle2, AlertCircle, ShieldCheck, Edit2, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Operator {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'inactive';
  shift: string;
  activeAlerts: number;
  email?: string;
  phone?: string;
  condoId: string;
}

const Operators = () => {
  const { profile } = useAuth();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null);
  const [deletingOperator, setDeletingOperator] = useState<Operator | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    role: 'Operador Principal',
    status: 'active' as Operator['status'],
    shift: 'Día',
    email: '',
    phone: '',
    activeAlerts: 0
  });

  useEffect(() => {
    if (!profile?.condoId) return;

    const path = `condos/${profile.condoId}/operators`;
    const q = query(collection(db, path));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Operator[];
      setOperators(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [profile?.condoId]);

  const handleOpenAdd = () => {
    setFormData({
      name: '',
      role: 'Operador Principal',
      status: 'active',
      shift: 'Día',
      email: '',
      phone: '',
      activeAlerts: 0
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (op: Operator) => {
    setEditingOperator(op);
    setFormData({
      name: op.name,
      role: op.role,
      status: op.status,
      shift: op.shift,
      email: op.email || '',
      phone: op.phone || '',
      activeAlerts: op.activeAlerts
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.condoId) return;

    const path = `condos/${profile.condoId}/operators`;
    try {
      if (editingOperator) {
        const docRef = doc(db, path, editingOperator.id);
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
      }
      setShowAddModal(false);
      setEditingOperator(null);
    } catch (error) {
      handleFirestoreError(error, editingOperator ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!profile?.condoId || !deletingOperator) return;

    const path = `condos/${profile.condoId}/operators`;
    try {
      await deleteDoc(doc(db, path, deletingOperator.id));
      setDeletingOperator(null);
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
          <h2 className="text-3xl font-bold text-white tracking-tight">Operadores de Portería</h2>
          <p className="text-gray-400 mt-1">Gestiona el personal encargado de la vigilancia y accesos.</p>
        </div>
        {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Nuevo Operador
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {operators.map((op, i) => (
          <motion.div
            key={op.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-3xl p-8 hover:border-gray-700 transition-all group relative overflow-hidden"
          >
             <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl" />
            
            <div className="flex items-start justify-between mb-6">
              <div className="w-16 h-16 bg-blue-900/20 rounded-2xl flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                <ShieldCheck size={32} />
              </div>
              <div className="flex items-center gap-2">
                {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                  <div className="flex gap-2 mr-2">
                    <button 
                      onClick={() => handleOpenEdit(op)}
                      className="p-2 text-gray-500 hover:text-blue-400 transition-colors" 
                      title="Editar"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => setDeletingOperator(op)}
                      className="p-2 text-gray-500 hover:text-red-400 transition-colors" 
                      title="Eliminar"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
                <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                  op.status === 'active' ? 'bg-green-900/20 text-green-500' : 'bg-gray-800 text-gray-500'
                }`}>
                  {op.status === 'active' ? 'Activo' : 'Inactivo'}
                </div>
              </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-1">{op.name}</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium uppercase tracking-wider">{op.role}</p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Turno</p>
                <p className="text-lg font-bold text-white">{op.shift}</p>
              </div>
              <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Alertas</p>
                <p className={`text-lg font-bold ${op.activeAlerts > 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {op.activeAlerts}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-3 rounded-xl transition-all">
                Contactar
              </button>
              {op.email && (
                <a 
                  href={`mailto:${op.email}`}
                  className="p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-all"
                >
                  <Mail size={20} />
                </a>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingOperator) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingOperator(null); }}
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
                  {editingOperator ? 'Editar Operador' : 'Nuevo Operador'}
                </h3>
                <button onClick={() => { setShowAddModal(false); setEditingOperator(null); }} className="text-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Nombre Completo</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    placeholder="Ej: Marta Gómez"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Rol</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="Operador Principal">Operador Principal</option>
                      <option value="Operador Nocturno">Operador Nocturno</option>
                      <option value="Operador de Apoyo">Operador de Apoyo</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Turno</label>
                    <select
                      value={formData.shift}
                      onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="Día">Día</option>
                      <option value="Noche">Noche</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Teléfono</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      placeholder="+56 9 ..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Estado</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as Operator['status'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    placeholder="operador@ejemplo.com"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 mt-4"
                >
                  {editingOperator ? 'Guardar Cambios' : 'Crear Operador'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingOperator && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingOperator(null)}
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
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar operador?</h3>
              <p className="text-gray-400 mb-8">
                Esta acción no se puede deshacer. Se eliminará a "{deletingOperator.name}" permanentemente.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingOperator(null)}
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

export default Operators;
