import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, collectionGroup, where } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Plus, Search, Shield, Activity, Calendar, MapPin, AlertTriangle, Edit2, Trash2, X, CheckCircle2, Clock, Settings, Package, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Equipment {
  id: string;
  name: string;
  type: string;
  status: 'Operativo' | 'Mantenimiento' | 'Falla';
  location: string;
  lastMaintenance: string;
  nextMaintenance: string;
  condoId: string;
  condoName: string;
}

const Equipment = () => {
  const { profile, user } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    type: '',
    status: 'Operativo' as Equipment['status'],
    location: '',
    lastMaintenance: new Date().toISOString().split('T')[0],
    nextMaintenance: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    condoId: ''
  });

  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
  const [deletingEquipment, setDeletingEquipment] = useState<Equipment | null>(null);

  useEffect(() => {
    // Fetch condos for super_admin
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'equipment'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds) {
      q = query(collectionGroup(db, 'equipment'), where('condoId', 'in', profile.condoIds));
    } else {
      const path = `condos/${profile.condoId || 'default'}/equipment`;
      q = query(collection(db, path));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEquipment(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Equipment[]);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'equipment');
    });

    return () => {
      unsubscribe();
      condosUnsubscribe();
    };
  }, [profile, user]);

  const handleOpenAdd = () => {
    setEditingEquipment(null);
    setFormData({
      name: '',
      type: '',
      status: 'Operativo',
      location: '',
      lastMaintenance: new Date().toISOString().split('T')[0],
      nextMaintenance: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condoId: profile?.condoId || ''
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (item: Equipment) => {
    setEditingEquipment(item);
    setFormData({
      name: item.name,
      type: item.type,
      status: item.status,
      location: item.location,
      lastMaintenance: item.lastMaintenance,
      nextMaintenance: item.nextMaintenance,
      condoId: item.condoId
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    const condoIdToUse = formData.condoId || 'default';
    const path = `condos/${condoIdToUse}/equipment`;

    try {
      const dataToSave = {
        ...formData,
        condoName: selectedCondo?.name || profile?.condoName || 'Condominio',
        updatedAt: Timestamp.now()
      };

      if (editingEquipment) {
        await updateDoc(doc(db, path, editingEquipment.id), dataToSave);
      } else {
        await addDoc(collection(db, path), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
    } catch (error) {
       handleFirestoreError(error, editingEquipment ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!deletingEquipment) return;
    const path = `condos/${deletingEquipment.condoId}/equipment`;
    try {
      await deleteDoc(doc(db, path, deletingEquipment.id));
      setDeletingEquipment(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const filteredItems = equipment.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading && !equipment.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
        <div className="space-y-0.5">
           <div className="flex items-center gap-3">
              <Package className="text-blue-500" size={24} />
              <h2 className="text-3xl font-black text-white italic tracking-tight uppercase">Inventario de Equipos</h2>
           </div>
           <p className="text-gray-500 text-base font-medium italic">Control preventivo de activos e infraestructura.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar equipo o ubicación..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-64 bg-gray-950 border border-gray-800 rounded-xl py-3 pl-12 pr-4 text-white text-base focus:border-blue-600 outline-none"
            />
          </div>
          <button onClick={handleOpenAdd} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-xl shadow-blue-600/20">
            <Plus size={20} /> Nuevo Equipo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredItems.map((item) => (
          <motion.div layout key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-blue-500/50 transition-all group shadow-lg">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 bg-gray-950 rounded-lg flex items-center justify-center text-blue-500 border border-gray-800 shadow-inner"><Wrench size={20} /></div>
              <span className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-widest ${
                item.status === 'Operativo' ? 'bg-green-500/10 text-green-500' :
                item.status === 'Mantenimiento' ? 'bg-yellow-500/10 text-yellow-500' :
                'bg-red-500/10 text-red-500'
              }`}>
                {item.status}
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mb-2 italic uppercase">{item.name}</h3>
            <div className="space-y-2 text-base text-gray-500 mb-6">
               <div className="flex items-center gap-2 font-bold"><MapPin size={14} className="text-blue-500" /> {item.location}</div>
               <p className="text-base uppercase font-black text-gray-600 tracking-widest">{item.condoName}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-6 border-t border-gray-800">
               <div><p className="text-base font-black text-gray-600 uppercase">Último Manto.</p><p className="text-base font-bold text-gray-300">{item.lastMaintenance}</p></div>
               <div><p className="text-base font-black text-gray-600 uppercase">Siguiente</p><p className="text-base font-bold text-blue-500">{item.nextMaintenance}</p></div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
               <button onClick={() => handleOpenEdit(item)} className="p-2 text-gray-500 hover:text-white transition-colors"><Edit2 size={18} /></button>
               <button onClick={() => setDeletingEquipment(item)} className="p-2 text-gray-500 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Simplified Modal Logic */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10">
                <h3 className="text-xl font-black text-white italic mb-8">{editingEquipment ? 'Editar Equipo' : 'Nuevo Activo'}</h3>
                <form onSubmit={handleSave} className="space-y-6">
                   <div className="space-y-1">
                      <label className="text-base font-black text-gray-500 uppercase tracking-widest">Nombre del Equipo</label>
                      <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white" />
                   </div>
                   <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest">Típo/Modelo</label>
                        <input required type="text" value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest">Estado</label>
                        <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value as Equipment['status']})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white">
                           <option value="Operativo">Operativo</option>
                           <option value="Mantenimiento">Mantenimiento</option>
                           <option value="Falla">Falla</option>
                        </select>
                      </div>
                   </div>
                   <div className="space-y-1">
                      <label className="text-base font-black text-gray-500 uppercase tracking-widest">Ubicación Física</label>
                      <input required type="text" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white" />
                   </div>
                   {profile?.role === 'super_admin' && (
                     <div className="space-y-1">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest">Condominio</label>
                        <select value={formData.condoId} onChange={(e) => setFormData({...formData, condoId: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold">
                           <option value="">Seleccionar...</option>
                           {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                     </div>
                   )}
                   <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl transition-all shadow-xl shadow-blue-600/20">Guardar Cambios</button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Equipment;
