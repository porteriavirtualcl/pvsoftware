import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Building2, Plus, MapPin, Users, Edit2, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Condo {
  id: string;
  name: string;
  address: string;
  residentsCount?: number;
}

const Condos = () => {
  const { profile } = useAuth();
  const [condos, setCondos] = useState<Condo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCondo, setEditingCondo] = useState<Condo | null>(null);
  const [deletingCondo, setDeletingCondo] = useState<Condo | null>(null);
  const [formData, setFormData] = useState({ name: '', address: '' });

  useEffect(() => {
    const path = 'condos';
    const q = query(collection(db, path));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Condo[];
      setCondos(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, []);

  const handleOpenAdd = () => {
    setFormData({ name: '', address: '' });
    setShowAddModal(true);
  };

  const handleOpenEdit = (condo: Condo) => {
    setEditingCondo(condo);
    setFormData({ name: condo.name, address: condo.address });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const path = 'condos';
    try {
      if (editingCondo) {
        await updateDoc(doc(db, path, editingCondo.id), { ...formData, updatedAt: Timestamp.now() });
      } else {
        await addDoc(collection(db, path), { ...formData, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      }
      setShowAddModal(false);
      setEditingCondo(null);
    } catch (error) {
      handleFirestoreError(error, editingCondo ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!deletingCondo) return;
    try {
      await deleteDoc(doc(db, 'condos', deletingCondo.id));
      setDeletingCondo(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'condos');
    }
  };

  if (loading) {
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
          <h2 className="text-3xl font-black text-white tracking-tight uppercase italic">Condominios</h2>
          <p className="text-gray-500 mt-1 italic font-medium">Administra los complejos residenciales registrados.</p>
        </div>
        {profile?.role === 'super_admin' && (
          <button
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20 uppercase tracking-widest text-sm"
          >
            <Plus size={20} />
            Nuevo Condominio
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {condos.map((condo, i) => (
          <motion.div
            key={condo.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-[2.5rem] p-8 hover:border-blue-500/50 transition-all group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-blue-600/10 transition-colors" />
            
            <div className="flex items-start justify-between mb-8 relative">
              <div className="w-14 h-14 bg-gray-950 rounded-2xl border border-gray-800 flex items-center justify-center text-blue-500 group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 shadow-inner">
                <Building2 size={28} />
              </div>
              {profile?.role === 'super_admin' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenEdit(condo)}
                    className="p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                    title="Editar"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => setDeletingCondo(condo)}
                    className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                    title="Eliminar"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4 relative">
              <h3 className="text-2xl font-black text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight italic">{condo.name}</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-gray-500 font-bold text-sm uppercase tracking-widest">
                  <MapPin size={16} className="text-blue-500" />
                  <span className="truncate">{condo.address}</span>
                </div>
                <div className="flex items-center gap-3 text-gray-500 font-bold text-sm uppercase tracking-widest">
                  <Users size={16} className="text-blue-500" />
                  <span>{condo.residentsCount || 0} Residentes</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-white/5 grid grid-cols-2 gap-4 relative">
              <button className="bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest py-4 rounded-2xl transition-all border border-white/5">
                Edificios
              </button>
              <button className="bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest py-4 rounded-2xl transition-all border border-white/5">
                Unidades
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingCondo) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingCondo(null); }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
              className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-2xl font-black text-white italic uppercase tracking-tight">
                  {editingCondo ? 'Editar Ficha' : 'Nuevo Condominio'}
                </h3>
                <button onClick={() => { setShowAddModal(false); setEditingCondo(null); }} className="w-12 h-12 bg-white/5 hover:bg-white/10 text-gray-400 rounded-full flex items-center justify-center transition-all">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleSave} className="space-y-8">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nombre del Complejo</label>
                  <input
                    required type="text" value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold focus:border-blue-600 outline-none transition-all"
                    placeholder="Ej: Condominio Los Olivos"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Ubicación / Dirección</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={18} />
                    <input
                      required type="text" value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-12 pr-6 text-white font-bold focus:border-blue-600 outline-none transition-all"
                      placeholder="Av. Principal 123, Ciudad"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-2xl shadow-blue-600/30 text-lg uppercase tracking-widest mt-4"
                >
                  {editingCondo ? 'Actualizar Datos' : 'Registrar Condominio'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {deletingCondo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDeletingCondo(null)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 text-center shadow-2xl"
            >
              <div className="w-20 h-20 bg-red-600/10 rounded-full flex items-center justify-center text-red-500 mx-auto mb-8 shadow-inner">
                <Trash2 size={36} />
              </div>
              <h3 className="text-2xl font-black text-white mb-3 italic">¿Eliminar Ficha?</h3>
              <p className="text-gray-500 text-sm font-medium mb-10 leading-relaxed uppercase tracking-wider">
                Se anulará permanentemente el condominio <span className="text-white font-bold italic">"{deletingCondo.name}"</span>.
              </p>
              <div className="flex gap-4">
                <button onClick={() => setDeletingCondo(null)} className="flex-1 bg-gray-800 text-white py-4 rounded-2xl font-black uppercase tracking-widest transition-all">
                  Volver
                </button>
                <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl shadow-red-600/20">
                  Confirmar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Condos;
