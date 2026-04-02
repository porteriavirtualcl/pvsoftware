import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Plus, MapPin, Users, MoreVertical, CheckCircle2, AlertCircle, Clock, Info, Edit2, Trash2, X, Image as ImageIcon } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp, collectionGroup, where } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Condo {
  id: string;
  name: string;
}

interface Facility {
  id: string;
  name: string;
  type: 'reservable' | 'non-reservable';
  status: 'enabled' | 'disabled';
  capacity: string;
  image: string;
  condoId: string;
  condoName?: string;
}

const Facilities = () => {
  const { profile } = useAuth();
  const [condos, setCondos] = useState<Condo[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [deletingFacility, setDeletingFacility] = useState<Facility | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'reservable' as Facility['type'],
    status: 'enabled' as Facility['status'],
    capacity: '',
    image: '',
    condoId: ''
  });

  useEffect(() => {
    // Fetch condos for selection
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })) as Condo[]);
    });

    if (!profile?.role) return () => condosUnsubscribe();

    let q;
    let path = 'facilities'; // Default for collectionGroup

    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'facilities'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      q = query(
        collectionGroup(db, 'facilities'),
        where('condoId', 'in', profile.condoIds)
      );
    } else if (profile.condoId) {
      path = `condos/${profile.condoId}/facilities`;
      q = query(collection(db, path));
    } else {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Facility[];
      setFacilities(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => {
      condosUnsubscribe();
      unsubscribe();
    };
  }, [profile?.condoId]);

  const handleOpenAdd = () => {
    setFormData({
      name: '',
      type: 'reservable',
      status: 'enabled',
      capacity: '',
      image: `https://picsum.photos/seed/${Math.random()}/800/600`,
      condoId: profile?.condoId || ''
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (facility: Facility) => {
    setEditingFacility(facility);
    setFormData({
      name: facility.name,
      type: facility.type,
      status: facility.status,
      capacity: facility.capacity,
      image: facility.image,
      condoId: facility.condoId
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.condoId) return;

    const path = `condos/${formData.condoId}/facilities`;
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    
    try {
      if (editingFacility) {
        const docRef = doc(db, path, editingFacility.id);
        await updateDoc(docRef, {
          ...formData,
          condoName: selectedCondo?.name,
          updatedAt: Timestamp.now()
        });
      } else {
        await addDoc(collection(db, path), {
          ...formData,
          condoName: selectedCondo?.name,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
      setEditingFacility(null);
    } catch (error) {
      handleFirestoreError(error, editingFacility ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!profile?.condoId || !deletingFacility) return;

    const path = `condos/${profile.condoId}/facilities`;
    try {
      await deleteDoc(doc(db, path, deletingFacility.id));
      setDeletingFacility(null);
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
          <h2 className="text-3xl font-bold text-white tracking-tight">Instalaciones y Reservas</h2>
          <p className="text-gray-400 mt-1">Reserva áreas comunes y consulta disponibilidad en tiempo real.</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2.5 px-6 rounded-xl transition-all">
            <Calendar size={20} />
            Mis Reservas
          </button>
          {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
            <button 
              onClick={handleOpenAdd}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
            >
              <Plus size={20} />
              Nueva Instalación
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {facilities.map((facility, i) => (
          <motion.div
            key={facility.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden hover:border-gray-700 transition-all group"
          >
            <div className="relative h-48">
              <img
                src={facility.image}
                alt={facility.name}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-transparent" />
              <div className="absolute top-4 right-4 flex gap-2">
                {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                  <>
                    <button 
                      onClick={() => handleOpenEdit(facility)}
                      className="p-2 bg-gray-900/80 hover:bg-blue-600 text-white rounded-full backdrop-blur-sm transition-all" 
                      title="Editar"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button 
                      onClick={() => setDeletingFacility(facility)}
                      className="p-2 bg-gray-900/80 hover:bg-red-600 text-white rounded-full backdrop-blur-sm transition-all" 
                      title="Eliminar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  facility.status === 'enabled' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                }`}>
                  {facility.status === 'enabled' ? 'Disponible' : 'Cerrado'}
                </span>
              </div>
            </div>
            
            <div className="p-6">
              <h3 className="text-lg font-bold text-white mb-2">{facility.name}</h3>
              <div className="space-y-3 text-sm text-gray-400 mb-6">
                <div className="flex items-center gap-2">
                  <Users size={14} />
                  <span>Capacidad: {facility.capacity}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Info size={14} />
                  <span className="capitalize">{facility.type.replace('-', ' ')}</span>
                </div>
              </div>
              
              {facility.type === 'reservable' && facility.status === 'enabled' ? (
                <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all">
                  Reservar Ahora
                </button>
              ) : (
                <button disabled className="w-full bg-gray-800 text-gray-500 font-bold py-3 rounded-xl cursor-not-allowed">
                  No Reservable
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingFacility) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingFacility(null); }}
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
                  {editingFacility ? 'Editar Instalación' : 'Nueva Instalación'}
                </h3>
                <button onClick={() => { setShowAddModal(false); setEditingFacility(null); }} className="text-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Nombre</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                      placeholder="Ej: Piscina Exterior"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Condominio</label>
                    <select
                      required
                      disabled={profile?.role !== 'super_admin'}
                      value={formData.condoId}
                      onChange={(e) => setFormData({ ...formData, condoId: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all disabled:opacity-50"
                    >
                      <option value="">Seleccionar Condominio</option>
                      {condos.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Tipo</label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as Facility['type'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="reservable">Reservable</option>
                      <option value="non-reservable">No Reservable</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Estado</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as Facility['status'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="enabled">Disponible</option>
                      <option value="disabled">Cerrado</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Capacidad</label>
                  <input
                    required
                    type="text"
                    value={formData.capacity}
                    onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    placeholder="Ej: 20 personas"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">URL de Imagen</label>
                  <div className="relative">
                    <ImageIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                      type="url"
                      value={formData.image}
                      onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-12 pr-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                      placeholder="https://images.unsplash.com/..."
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 mt-4"
                >
                  {editingFacility ? 'Guardar Cambios' : 'Crear Instalación'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingFacility && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingFacility(null)}
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
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar instalación?</h3>
              <p className="text-gray-400 mb-8">
                Esta acción no se puede deshacer. Se eliminará "{deletingFacility.name}" permanentemente.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingFacility(null)}
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

export default Facilities;
