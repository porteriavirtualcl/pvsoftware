import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Plus, Camera, Shield, Wifi, MoreVertical, CheckCircle2, AlertCircle, Edit2, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface EquipmentItem {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'maintenance' | 'inactive';
  lastMaint: string;
  condoId: string;
  condoName?: string;
  group?: string;
}

const Equipment = () => {
  const { profile } = useAuth();
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<EquipmentItem | null>(null);
  const [deletingEquipment, setDeletingEquipment] = useState<EquipmentItem | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'Cámara IP',
    status: 'active' as EquipmentItem['status'],
    lastMaint: new Date().toISOString().split('T')[0],
    group: ''
  });

  useEffect(() => {
    if (!profile?.condoId) return;

    const path = `condos/${profile.condoId}/equipment`;
    const q = query(collection(db, path));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as EquipmentItem[];
      setEquipment(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [profile?.condoId]);

  const handleOpenAdd = () => {
    setFormData({
      name: '',
      type: 'Cámara IP',
      status: 'active',
      lastMaint: new Date().toISOString().split('T')[0],
      group: ''
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (item: EquipmentItem) => {
    setEditingEquipment(item);
    setFormData({
      name: item.name,
      type: item.type,
      status: item.status,
      lastMaint: item.lastMaint,
      group: item.group || ''
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.condoId) return;

    const path = `condos/${profile.condoId}/equipment`;
    try {
      if (editingEquipment) {
        const docRef = doc(db, path, editingEquipment.id);
        await updateDoc(docRef, {
          ...formData,
          updatedAt: Timestamp.now()
        });
      } else {
        await addDoc(collection(db, path), {
          ...formData,
          condoId: profile.condoId,
          condoName: profile.condoName || 'Condominio',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
      setEditingEquipment(null);
    } catch (error) {
      handleFirestoreError(error, editingEquipment ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!profile?.condoId || !deletingEquipment) return;

    const path = `condos/${profile.condoId}/equipment`;
    try {
      await deleteDoc(doc(db, path, deletingEquipment.id));
      setDeletingEquipment(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const groupedEquipment = equipment.reduce((acc, item) => {
    const group = item.group || 'Sin Grupo';
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, EquipmentItem[]>);

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
          <h2 className="text-3xl font-bold text-white tracking-tight">Equipamiento Tecnológico</h2>
          <p className="text-gray-400 mt-1">Inventario y estado de salud de los dispositivos instalados.</p>
        </div>
        {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Nuevo Equipo
          </button>
        )}
      </div>

      <div className="space-y-12">
        {Object.entries(groupedEquipment).map(([groupName, items]: [string, EquipmentItem[]]) => (
          <div key={groupName}>
            <div className="flex items-center gap-4 mb-6">
              <h3 className="text-xl font-bold text-white">{groupName}</h3>
              <div className="h-px flex-1 bg-gray-800" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">
                {items.length} {items.length === 1 ? 'Equipo' : 'Equipos'}
              </span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {items.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-all group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      item.status === 'active' ? 'bg-green-900/20 text-green-500' :
                      item.status === 'maintenance' ? 'bg-yellow-900/20 text-yellow-500' :
                      'bg-red-900/20 text-red-500'
                    }`}>
                      {item.type === 'Cámara IP' ? <Camera size={24} /> : item.type === 'Barrera' ? <Shield size={24} /> : <Wifi size={24} />}
                    </div>
                    {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleOpenEdit(item)}
                          className="p-2 text-gray-500 hover:text-blue-400 transition-colors" 
                          title="Editar"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => setDeletingEquipment(item)}
                          className="p-2 text-gray-500 hover:text-red-400 transition-colors" 
                          title="Eliminar"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">{item.name}</h3>
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-4">{item.type}</p>
                  
                  <div className="space-y-3 text-sm text-gray-400">
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Estado</span>
                      <span className={`text-xs font-bold uppercase ${
                        item.status === 'active' ? 'text-green-500' :
                        item.status === 'maintenance' ? 'text-yellow-500' :
                        'text-red-500'
                      }`}>{item.status}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Última Mant.</span>
                      <span className="text-xs font-medium text-white">{item.lastMaint}</span>
                    </div>
                  </div>
                  <div className="mt-6 pt-6 border-t border-gray-800">
                    <button className="w-full bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold py-2 rounded-lg transition-all">
                      Ver Historial
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingEquipment) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingEquipment(null); }}
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
                  {editingEquipment ? 'Editar Equipo' : 'Nuevo Equipo'}
                </h3>
                <button onClick={() => { setShowAddModal(false); setEditingEquipment(null); }} className="text-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Condominio</label>
                    <input
                      disabled
                      type="text"
                      value={profile?.condoName || 'Cargando...'}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-gray-500 outline-none cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Grupo (Opcional)</label>
                    <input
                      type="text"
                      list="equipment-groups"
                      value={formData.group}
                      onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      placeholder="Ej: Cámaras Perimetrales"
                    />
                    <datalist id="equipment-groups">
                      {Array.from(new Set(equipment.map(e => e.group).filter(Boolean))).map(group => (
                        <option key={group} value={group} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Nombre del Equipo</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    placeholder="Ej: Cámara Principal Acceso A"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Tipo</label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="Cámara IP">Cámara IP</option>
                      <option value="Barrera">Barrera</option>
                      <option value="IP Intercom">IP Intercom</option>
                      <option value="Sensor">Sensor</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Estado</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as EquipmentItem['status'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="active">Activo</option>
                      <option value="maintenance">Mantenimiento</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Última Mantenimiento</label>
                  <input
                    required
                    type="date"
                    value={formData.lastMaint}
                    onChange={(e) => setFormData({ ...formData, lastMaint: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 mt-4"
                >
                  {editingEquipment ? 'Guardar Cambios' : 'Crear Equipo'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingEquipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingEquipment(null)}
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
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar equipo?</h3>
              <p className="text-gray-400 mb-8">
                Esta acción no se puede deshacer. Se eliminará "{deletingEquipment.name}" permanentemente.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingEquipment(null)}
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

export default Equipment;
