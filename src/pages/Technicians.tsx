import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wrench, Plus, User, MapPin, Phone, Mail, MoreVertical, CheckCircle2, AlertCircle, Star, Edit2, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp, where, getDocs } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Technician {
  id: string;
  name: string;
  specialty: string;
  status: 'active' | 'inactive';
  rating: number;
  activeCases: number;
  phone?: string;
  email?: string;
  condoId: string;
  condoIds?: string[];
  condoName?: string;
  condoScope: 'single' | 'multiple' | 'all';
}

interface Condo {
  id: string;
  name: string;
}

const Technicians = () => {
  const { profile } = useAuth();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTech, setEditingTech] = useState<Technician | null>(null);
  const [deletingTech, setDeletingTech] = useState<Technician | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    specialty: '',
    status: 'active' as Technician['status'],
    phone: '',
    email: '',
    rating: 5.0,
    activeCases: 0,
    assignment: [] as string[]
  });

  useEffect(() => {
    // Fetch condos for the dropdown
    const condosPath = 'condos';
    const condosUnsubscribe = onSnapshot(collection(db, condosPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || 'Condominio sin nombre'
      })) as Condo[];
      setCondos(data);
      if (formData.assignment.length === 0 && profile?.condoId) {
        setFormData(prev => ({ ...prev, assignment: [profile.condoId] }));
      }
    });

    let unsubscribe: () => void;

    if (profile?.role === 'super_admin') {
      // Super admins see all technicians from the users collection
      const q = query(collection(db, 'users'), where('role', '==', 'technician'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Technician[];
        setTechnicians(data);
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
    } else if (profile?.condoId) {
      // Condo admins only see technicians for their condo
      const path = `condos/${profile.condoId}/technicians`;
      const q = query(collection(db, path));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Technician[];
        setTechnicians(data);
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      });
    } else {
      setLoading(false);
      return () => condosUnsubscribe();
    }

    return () => {
      condosUnsubscribe();
      if (unsubscribe) unsubscribe();
    };
  }, [profile?.condoId, profile?.role]);

  const handleOpenAdd = () => {
    setFormData({
      name: '',
      specialty: '',
      status: 'active',
      phone: '',
      email: '',
      rating: 5.0,
      activeCases: 0,
      assignment: profile?.condoId ? [profile.condoId] : []
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (tech: Technician) => {
    setEditingTech(tech);
    setFormData({
      name: tech.name,
      specialty: tech.specialty,
      status: tech.status,
      phone: tech.phone || '',
      email: tech.email || '',
      rating: tech.rating,
      activeCases: tech.activeCases,
      assignment: tech.condoScope === 'all' ? ['all'] : (tech.condoIds || [tech.condoId])
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    const isAll = formData.assignment.includes('all');
    const selectedCondoIds = isAll ? condos.map(c => c.id) : formData.assignment;
    const selectedCondoNames = isAll 
      ? 'Todos' 
      : condos.filter(c => formData.assignment.includes(c.id)).map(c => c.name).join(', ');
    
    // Determine the primary condo ID for storage
    const primaryCondoId = isAll 
      ? (profile.condoId || selectedCondoIds[0] || 'global') 
      : (formData.assignment[0] || profile.condoId || 'global');
    
    const finalCondoId = isAll ? (profile.condoId || 'all') : primaryCondoId;
    const finalCondoName = isAll ? 'Todos' : (selectedCondoNames || profile.condoName || 'Condominio');

    // Only use nested path if we have a valid condoId, otherwise use a root collection if super admin
    const path = finalCondoId !== 'all' && finalCondoId !== 'global' 
      ? `condos/${finalCondoId}/technicians` 
      : 'technicians';
    const usersPath = 'users';
    try {
      const saveData = {
        name: formData.name,
        specialty: formData.specialty,
        status: formData.status,
        phone: formData.phone,
        email: formData.email,
        rating: formData.rating,
        activeCases: formData.activeCases,
        condoId: finalCondoId,
        condoIds: selectedCondoIds,
        condoName: finalCondoName,
        condoScope: isAll ? 'all' : (formData.assignment.length > 1 ? 'multiple' : 'single'),
        updatedAt: Timestamp.now()
      };

      if (editingTech) {
        const docRef = doc(db, path, editingTech.id);
        await updateDoc(docRef, saveData);

        // Also update the user profile in the central users collection if email exists
        if (formData.email) {
          const userQuery = query(collection(db, usersPath), where('email', '==', formData.email));
          const userSnapshot = await getDocs(userQuery);
          if (!userSnapshot.empty) {
            const userDocRef = doc(db, usersPath, userSnapshot.docs[0].id);
            await updateDoc(userDocRef, {
              name: formData.name,
              role: 'technician',
              condoId: finalCondoId,
              condoIds: selectedCondoIds,
              condoName: finalCondoName,
              condoScope: isAll ? 'all' : (formData.assignment.length > 1 ? 'multiple' : 'single'),
              updatedAt: Timestamp.now()
            });
          }
        }
      } else {
        await addDoc(collection(db, path), {
          ...saveData,
          createdAt: Timestamp.now()
        });

        // Create a user profile in the central users collection if email exists
        if (formData.email) {
          await addDoc(collection(db, usersPath), {
            uid: `temp_${Date.now()}`, // In a real app, this would be the Firebase Auth UID
            email: formData.email,
            name: formData.name,
            role: 'technician',
            condoId: finalCondoId,
            condoIds: selectedCondoIds,
            condoName: finalCondoName,
            condoScope: isAll ? 'all' : (formData.assignment.length > 1 ? 'multiple' : 'single'),
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });
        }
      }
      setShowAddModal(false);
      setEditingTech(null);
    } catch (error) {
      handleFirestoreError(error, editingTech ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!profile || !deletingTech) return;

    const targetCondoId = deletingTech.condoId || profile.condoId;
    const path = targetCondoId && targetCondoId !== 'all' && targetCondoId !== 'global'
      ? `condos/${targetCondoId}/technicians`
      : 'technicians';
    try {
      await deleteDoc(doc(db, path, deletingTech.id));
      setDeletingTech(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  if (loading && profile) {
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
          <h2 className="text-3xl font-bold text-white tracking-tight">Equipo Técnico</h2>
          <p className="text-gray-400 mt-1">Gestiona el personal de mantenimiento y soporte técnico.</p>
        </div>
        {(profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'operator') && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Nuevo Técnico
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {technicians.map((tech, i) => (
          <motion.div
            key={tech.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-3xl p-8 hover:border-gray-700 transition-all group relative overflow-hidden"
          >
             <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl" />
            
            <div className="flex items-start justify-between mb-6">
              <div className="w-16 h-16 bg-blue-900/20 rounded-2xl flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                <Wrench size={32} />
              </div>
              <div className="flex items-center gap-2">
                {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                  <div className="flex gap-2 mr-2">
                    <button 
                      onClick={() => handleOpenEdit(tech)}
                      className="p-2 text-gray-500 hover:text-blue-400 transition-colors" 
                      title="Editar"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => setDeletingTech(tech)}
                      className="p-2 text-gray-500 hover:text-red-400 transition-colors" 
                      title="Eliminar"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1 bg-gray-950 px-2 py-1 rounded-lg border border-gray-800">
                  <Star className="text-yellow-500 fill-yellow-500" size={14} />
                  <span className="text-xs font-bold text-white">{tech.rating}</span>
                </div>
              </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-1">{tech.name}</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium uppercase tracking-wider">{tech.specialty}</p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Casos Activos</p>
                <p className="text-lg font-bold text-white">{tech.activeCases}</p>
              </div>
              <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Alcance</p>
                <p className="text-lg font-bold text-white">
                  {tech.condoScope === 'all' ? 'Global' : 'Local'}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-3 rounded-xl transition-all">
                Asignar Caso
              </button>
              {tech.phone && (
                <a 
                  href={`tel:${tech.phone}`}
                  className="p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-all"
                >
                  <Phone size={20} />
                </a>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingTech) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingTech(null); }}
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
                  {editingTech ? 'Editar Técnico' : 'Nuevo Técnico'}
                </h3>
                <button onClick={() => { setShowAddModal(false); setEditingTech(null); }} className="text-gray-400 hover:text-white">
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
                    placeholder="Ej: Carlos Medina"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Especialidad</label>
                  <input
                    required
                    type="text"
                    value={formData.specialty}
                    onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    placeholder="Ej: Cámaras IP / Redes"
                  />
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
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as Technician['status'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Asignación de Condominios</label>
                    <div className="space-y-2 max-h-40 overflow-y-auto bg-gray-950 border border-gray-800 rounded-xl p-4">
                      <label className="flex items-center space-x-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={formData.assignment.includes('all')}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({ ...formData, assignment: ['all'] });
                            } else {
                              setFormData({ ...formData, assignment: [] });
                            }
                          }}
                          className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-600 focus:ring-offset-gray-900"
                        />
                        <span className="text-white group-hover:text-blue-400 transition-colors font-medium">Todos los Condominios</span>
                      </label>
                      <div className="h-px bg-gray-800 my-2" />
                      {condos.map(condo => (
                        <label key={condo.id} className="flex items-center space-x-3 cursor-pointer group">
                          <input
                            type="checkbox"
                            disabled={formData.assignment.includes('all')}
                            checked={formData.assignment.includes(condo.id)}
                            onChange={(e) => {
                              let newAssignment = [...formData.assignment];
                              if (e.target.checked) {
                                newAssignment = newAssignment.filter(id => id !== 'all');
                                newAssignment.push(condo.id);
                              } else {
                                newAssignment = newAssignment.filter(id => id !== condo.id);
                              }
                              setFormData({ ...formData, assignment: newAssignment });
                            }}
                            className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-600 focus:ring-offset-gray-900 disabled:opacity-50"
                          />
                          <span className={`text-white group-hover:text-blue-400 transition-colors ${formData.assignment.includes('all') ? 'opacity-50' : ''}`}>
                            {condo.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      placeholder="tecnico@ejemplo.com"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 mt-4"
                >
                  {editingTech ? 'Guardar Cambios' : 'Crear Técnico'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingTech && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingTech(null)}
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
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar técnico?</h3>
              <p className="text-gray-400 mb-8">
                Esta acción no se puede deshacer. Se eliminará a "{deletingTech.name}" permanentemente.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingTech(null)}
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

export default Technicians;
