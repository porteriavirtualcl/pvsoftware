import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Users, Search, Plus, Filter, MoreVertical, Mail, Building2, Home, Edit2, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp, where } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Condo {
  id: string;
  name: string;
}

interface Resident {
  id: string;
  uid: string;
  name: string;
  email: string;
  condoId: string;
  condoName?: string;
  unit: string;
  status: 'Activo' | 'Pendiente' | 'Inactivo';
  role: 'resident' | 'usuario';
  canGenerateQR?: boolean;
  hasFacilityAccess?: boolean;
}

const Residents = () => {
  const { profile } = useAuth();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [deletingResident, setDeletingResident] = useState<Resident | null>(null);
  const [condos, setCondos] = useState<Condo[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    unit: '',
    condoId: '',
    status: 'Activo' as Resident['status'],
    role: 'resident' as Resident['role'],
    canGenerateQR: false,
    hasFacilityAccess: true
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
      if (!formData.condoId && profile?.condoId) {
        setFormData(prev => ({ ...prev, condoId: profile.condoId }));
      }
    });

    if (!profile?.role) return () => condosUnsubscribe();

    const path = 'users';
    let q;
    
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      // Super admins or global operators/technicians see all residents
      q = query(
        collection(db, path),
        where('role', 'in', ['resident', 'usuario'])
      );
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      // Operators/technicians with multiple assigned condos
      q = query(
        collection(db, path),
        where('condoId', 'in', profile.condoIds),
        where('role', 'in', ['resident', 'usuario'])
      );
    } else if (profile.condoId) {
      // Condo admins or local operators/technicians see only their condo's residents
      q = query(
        collection(db, path), 
        where('condoId', '==', profile.condoId),
        where('role', 'in', ['resident', 'usuario'])
      );
    } else {
      setLoading(false);
      return () => condosUnsubscribe();
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Resident[];
      setResidents(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => {
      condosUnsubscribe();
      unsubscribe();
    };
  }, [profile?.condoId, profile?.role]);

  const handleOpenAdd = () => {
    setFormData({
      name: '',
      email: '',
      unit: '',
      condoId: profile?.condoId || (condos[0]?.id || ''),
      status: 'Activo',
      role: 'resident',
      canGenerateQR: false,
      hasFacilityAccess: true
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (resident: Resident) => {
    setEditingResident(resident);
    setFormData({
      name: resident.name,
      email: resident.email,
      unit: resident.unit,
      condoId: resident.condoId,
      status: resident.status,
      role: resident.role,
      canGenerateQR: resident.canGenerateQR || false,
      hasFacilityAccess: resident.hasFacilityAccess ?? true
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const path = 'users';
    
    try {
      if (editingResident) {
        console.log('Attempting UPDATE in users collection...');
        const docRef = doc(db, path, editingResident.id);
        await updateDoc(docRef, {
          ...formData,
          updatedAt: Timestamp.now()
        });
        console.log('Update successful');
      } else {
        console.log('Attempting CREATE in users collection...');
        const selectedCondo = condos.find(c => c.id === formData.condoId);
        await addDoc(collection(db, path), {
          ...formData,
          uid: `temp_${Date.now()}`,
          condoName: selectedCondo?.name || profile?.condoName || 'Condominio',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
        console.log('Create successful');
      }
      alert(editingResident ? 'Residente actualizado correctamente' : 'Residente creado correctamente');
      setShowAddModal(false);
      setEditingResident(null);
    } catch (error: any) {
      console.error('Error in Resident handleSave:', error);
      alert('Error Resident: ' + (error.message || 'Error desconocido'));
      handleFirestoreError(error, editingResident ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingResident) return;

    const path = 'users';
    try {
      await deleteDoc(doc(db, path, deletingResident.id));
      setDeletingResident(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const filteredResidents = residents.filter(r => 
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.unit.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading && profile?.condoId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-7xl mx-auto"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Residentes / Usuarios</h2>
          <p className="text-gray-400 mt-1">Gestiona los usuarios que habitan en los condominios.</p>
        </div>
        {(profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'operator') && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Nuevo Residente
          </button>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-gray-800 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Buscar por nombre, email o unidad..."
              className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            <Filter size={18} />
            Filtros
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800 bg-gray-900/50">
                <th className="px-6 py-4 font-medium text-white">Nombre / Email</th>
                <th className="px-6 py-4 font-medium text-white">Condominio</th>
                <th className="px-6 py-4 font-medium text-white">Unidad</th>
                <th className="px-6 py-4 font-medium text-white">Estado</th>
                <th className="px-6 py-4 font-medium text-white text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredResidents.map((resident) => (
                <tr key={resident.id} className="hover:bg-gray-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-900/30 rounded-full flex items-center justify-center text-blue-400 font-bold">
                        {resident.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{resident.name}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Mail size={12} />
                          {resident.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                      <Building2 size={16} className="text-gray-500" />
                      {resident.condoName || 'Condominio'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                      <Home size={16} className="text-gray-500" />
                      {resident.unit}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium w-fit ${
                        resident.status === 'Activo' ? 'bg-green-900/20 text-green-500' : 'bg-yellow-900/20 text-yellow-500'
                      }`}>
                        {resident.status}
                      </span>
                      <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">
                        {resident.role === 'usuario' ? 'Usuario' : 'Residente'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                        <>
                          <button 
                            onClick={() => handleOpenEdit(resident)}
                            className="p-2 text-gray-500 hover:text-blue-400 transition-colors" 
                            title="Editar"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button 
                            onClick={() => setDeletingResident(resident)}
                            className="p-2 text-gray-500 hover:text-red-400 transition-colors" 
                            title="Eliminar"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                      <button className="p-2 text-gray-500 hover:text-white transition-colors">
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingResident) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingResident(null); }}
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
                  {editingResident ? 'Editar Residente' : 'Nuevo Residente'}
                </h3>
                <button onClick={() => { setShowAddModal(false); setEditingResident(null); }} className="text-gray-400 hover:text-white">
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
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    placeholder="Ej: Juan Pérez"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
                  <input
                    required
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    placeholder="ejemplo@correo.com"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Unidad</label>
                    <input
                      required
                      type="text"
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      placeholder="Ej: Torre A - 402"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Rol</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value as Resident['role'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="resident">Residente</option>
                      <option value="usuario">Usuario (QR/Instalaciones)</option>
                    </select>
                  </div>
                </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Estado</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as Resident['status'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="Activo">Activo</option>
                      <option value="Pendiente">Pendiente</option>
                      <option value="Inactivo">Inactivo</option>
                    </select>
                  </div>

                  {profile?.role === 'super_admin' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">Condominio</label>
                      <select
                        value={formData.condoId}
                        onChange={(e) => setFormData({ ...formData, condoId: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      >
                        <option value="">Seleccionar Condominio</option>
                        {condos.map(condo => (
                          <option key={condo.id} value={condo.id}>{condo.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="hasFacilityAccess"
                      checked={formData.hasFacilityAccess}
                      onChange={(e) => setFormData({ ...formData, hasFacilityAccess: e.target.checked })}
                      className="w-5 h-5 rounded border-gray-800 bg-gray-950 text-blue-600 focus:ring-blue-600 focus:ring-offset-gray-900"
                    />
                    <label htmlFor="hasFacilityAccess" className="text-sm text-gray-300 cursor-pointer">
                      Acceso a Instalaciones (Piscina, Quincho, etc.)
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="canGenerateQR"
                      checked={formData.canGenerateQR}
                      onChange={(e) => setFormData({ ...formData, canGenerateQR: e.target.checked })}
                      className="w-5 h-5 rounded border-gray-800 bg-gray-950 text-blue-600 focus:ring-blue-600 focus:ring-offset-gray-900"
                    />
                    <label htmlFor="canGenerateQR" className="text-sm text-gray-300 cursor-pointer">
                      Puede generar códigos QR para visitas
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    editingResident ? 'Guardar Cambios' : 'Crear Residente'
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingResident && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingResident(null)}
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
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar residente?</h3>
              <p className="text-gray-400 mb-8">
                Esta acción no se puede deshacer. Se eliminará a "{deletingResident.name}" y su acceso al sistema.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingResident(null)}
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
    </motion.div>
  );
};

export default Residents;
