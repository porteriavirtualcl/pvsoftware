import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Users, Search, Plus, Filter, MoreVertical, Mail, Building2, Home, Edit2, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, setDoc, Timestamp, where } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
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
  phone?: string;
  plate?: string;
  emergencyContact?: string;
  condoId: string;
  condoName?: string;
  unit: string;
  status: 'Activo' | 'Pendiente' | 'Inactivo';
  role: 'resident' | 'usuario';
  password?: string;
  canGenerateQR?: boolean;
  hasFacilityAccess?: boolean;
  plates?: string[];
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
    phone: '',
    plate: '',
    emergencyContact: '',
    unit: '',
    condoId: '',
    status: 'Activo' as Resident['status'],
    role: 'resident' as Resident['role'],
<<<<<<< HEAD
    password: '',
    canGenerateQR: true,
    hasFacilityAccess: true
=======
    canGenerateQR: false,
    hasFacilityAccess: true,
    plates: [] as string[]
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
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
      q = query(
        collection(db, path),
        where('role', 'in', ['resident', 'usuario'])
      );
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      q = query(
        collection(db, path),
        where('condoId', 'in', profile.condoIds),
        where('role', 'in', ['resident', 'usuario'])
      );
    } else if (profile.condoId) {
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

<<<<<<< HEAD
    return () => unsubscribe();
  }, [profile?.condoId, profile?.role, profile?.condoScope, profile?.condoIds]);
=======
    return () => {
      condosUnsubscribe();
      unsubscribe();
    };
  }, [profile?.condoId, profile?.role]);
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01

  const handleOpenAdd = () => {
    setEditingResident(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      plate: '',
      emergencyContact: '',
      unit: '',
<<<<<<< HEAD
      status: 'Pendiente',
      role: 'resident',
      password: '',
      canGenerateQR: true,
      hasFacilityAccess: true
=======
      condoId: profile?.condoId || (condos[0]?.id || ''),
      status: 'Activo',
      role: 'resident',
      canGenerateQR: false,
      hasFacilityAccess: true,
      plates: []
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (resident: Resident) => {
    setEditingResident(resident);
    setFormData({
      name: resident.name,
      email: resident.email,
      phone: resident.phone || '',
      plate: resident.plate || '',
      emergencyContact: resident.emergencyContact || '',
      unit: resident.unit,
      condoId: resident.condoId,
      status: resident.status,
      role: resident.role,
<<<<<<< HEAD
      password: '',
      canGenerateQR: resident.canGenerateQR ?? true,
      hasFacilityAccess: resident.hasFacilityAccess ?? true
=======
      canGenerateQR: resident.canGenerateQR || false,
      hasFacilityAccess: resident.hasFacilityAccess ?? true,
      plates: resident.plates || []
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
<<<<<<< HEAD
    if (!profile?.condoId && profile?.role !== 'super_admin') return;
    setLoading(true);

=======
    setSaving(true);
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
    const path = 'users';
    
    try {
      let finalUid = editingResident?.uid || '';

      if (!editingResident && formData.password) {
        try {
          const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
          const secondaryAuth = getAuth(secondaryApp);
          
          const userCredential = await createUserWithEmailAndPassword(
            secondaryAuth, 
            formData.email, 
            formData.password
          );
          finalUid = userCredential.user.uid;
          
          await signOut(secondaryAuth);
          await deleteApp(secondaryApp);
        } catch (authErr: any) {
          console.warn("Auth Registration Warning:", authErr);
          alert('Aviso: No se pudo registrar en el sistema de autenticación. Razón: ' + authErr.message);
        }
      }

      if (editingResident) {
        console.log('Attempting UPDATE in users collection...');
        const docRef = doc(db, path, editingResident.id);
        await updateDoc(docRef, {
          ...formData,
          updatedAt: Timestamp.now()
        });
        console.log('Update successful');
      } else {
<<<<<<< HEAD
        await addDoc(collection(db, path), {
          ...formData,
          uid: finalUid,
          condoId: profile.condoId,
          condoName: profile.condoName || 'Condominio',
=======
        console.log('Attempting CREATE in users collection...');
        const selectedCondo = condos.find(c => c.id === formData.condoId);
        await addDoc(collection(db, path), {
          ...formData,
          status: formData.status || 'active',
          uid: `temp_${Date.now()}`,
          condoName: selectedCondo?.name || profile?.condoName || 'Condominio',
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
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
<<<<<<< HEAD
      setLoading(false);
=======
      setSaving(false);
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
    }
  };

  const handleDelete = async () => {
    if (!profile || !deletingResident) return;

    const path = 'users';
    try {
      await deleteDoc(doc(db, path, deletingResident.id));
      setDeletingResident(null);
    } catch (error) {
      console.error('Error in Resident handleDelete:', error);
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const filteredResidents = residents.filter(r => 
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.unit.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.plate && r.plate.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleWhatsApp = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    window.open(`https://wa.me/${cleanPhone}`, '_blank');
  };

  if (loading && (profile?.condoId || profile?.role === 'super_admin')) {
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
          <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <Users className="text-blue-500" size={28} />
            </div>
            Residentes / Usuarios
          </h2>
          <p className="text-gray-400 mt-1 italic">Gestión integral de la comunidad y control de accesos.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-xl font-semibold transition-all border border-gray-700">
            Exportar
          </button>
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20 active:scale-95"
          >
            <Plus size={20} />
            Nuevo Residente
          </button>
        </div>
<<<<<<< HEAD
=======
        {(profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'operator') && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Nuevo Residente
          </button>
        )}
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl shadow-black/50">
        <div className="p-6 border-b border-gray-800 flex flex-col md:flex-row gap-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input
              type="text"
              placeholder="Buscar por nombre, unidad o patente..."
              className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-3 pl-12 pr-4 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-all font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="flex items-center justify-center gap-2 bg-gray-950 hover:bg-gray-800 text-gray-300 px-6 py-3 rounded-2xl text-sm font-bold transition-colors border border-gray-800">
            <Filter size={18} />
            Filtros Avanzados
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-[0.2em] border-b border-gray-800 bg-black/20">
                <th className="px-8 py-5 font-black">Información Personal</th>
                <th className="px-8 py-5 font-black">Unidad / Patente</th>
                <th className="px-8 py-5 font-black">Estado / Rol</th>
                <th className="px-8 py-5 font-black text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filteredResidents.map((resident) => (
                <tr key={resident.id} className="hover:bg-blue-600/5 transition-all group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-600/30 to-indigo-600/10 rounded-2xl flex items-center justify-center text-blue-400 font-black text-lg border border-blue-500/20 shadow-inner">
                        {resident.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-black text-white group-hover:text-blue-400 transition-colors">{resident.name}</p>
                        <div className="flex flex-col gap-0.5 mt-1">
                          <p className="text-xs text-gray-500 flex items-center gap-1.5 font-medium">
                            <Mail size={12} className="text-gray-600" />
                            {resident.email}
                          </p>
                          {resident.phone && (
                            <p className="text-xs text-gray-500 flex items-center gap-1.5 font-medium">
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                              {resident.phone}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-200 font-bold bg-gray-800/50 w-fit px-3 py-1 rounded-lg">
                        <Home size={14} className="text-blue-500" />
                        {resident.unit}
                      </div>
                      {resident.plate && (
                        <div className="flex items-center gap-2 text-[10px] font-black text-blue-400 uppercase tracking-widest bg-blue-500/10 w-fit px-3 py-1 rounded-lg border border-blue-500/20">
                          Patente: {resident.plate}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-col gap-2">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter w-fit border ${
                        resident.status === 'Activo' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 
                        resident.status === 'Pendiente' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'
                      }`}>
                        {resident.status}
                      </span>
                      <div className="flex gap-2">
                        {resident.canGenerateQR && (
                          <div title="Puede generar QR" className="p-1 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20">
                            <QrCode size={12} />
                          </div>
                        )}
                        {resident.hasFacilityAccess && (
                          <div title="Acceso a Instalaciones" className="p-1 bg-indigo-500/10 text-indigo-400 rounded border border-indigo-500/20">
                            <Building2 size={12} />
                          </div>
                        )}
                        <span className="text-[10px] text-gray-400 font-bold uppercase self-center bg-gray-800 px-2 py-0.5 rounded">
                          {resident.role === 'usuario' ? 'Invitado' : 'Dueño'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-1 translate-x-2">
                      {resident.phone && (
                        <button 
                          onClick={() => handleWhatsApp(resident.phone!)}
                          className="p-2 text-gray-500 hover:text-green-500 transition-all hover:scale-110" 
                          title="WhatsApp"
                        >
                          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                            <path d="M12.031 6.172c-2.315 0-4.191 1.876-4.191 4.191 0 .743.194 1.442.533 2.049L7.83 14.12l1.742-.544c.582.313 1.238.491 1.939.491 2.315 0 4.191-1.876 4.191-4.191s-1.876-4.191-4.191-4.191zm2.342 5.378c-.062-.103-.227-.165-.474-.289-.247-.124-1.464-.722-1.691-.804-.227-.082-.392-.124-.556.124-.165.247-.639.804-.784.969-.144.165-.289.186-.536.062-.247-.124-1.042-.384-1.984-1.225-.733-.654-1.228-1.462-1.372-1.709-.144-.247-.015-.381.109-.504.111-.11.247-.289.371-.433.124-.144.165-.247.247-.412.082-.165.041-.309-.021-.433-.062-.124-.556-1.341-.763-1.835-.201-.48-.403-.414-.556-.422-.144-.007-.309-.009-.474-.009-.165 0-.433.062-.659.309-.227.247-.866.845-.866 2.062s.886 2.392.989 2.536c.103.144 1.743 2.661 4.223 3.731.59.255 1.05.407 1.408.521.593.188 1.134.161 1.56.097.476-.071 1.464-.598 1.67-1.175.206-.577.206-1.072.144-1.175zM12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22c-5.523 0-10-4.477-10-10S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                          </svg>
                        </button>
                      )}
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
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div
<<<<<<< HEAD
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-[2.5rem] overflow-hidden shadow-2xl"
=======
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar"
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-600"></div>
              <div className="p-10">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-3xl font-black text-white italic">
                      {editingResident ? 'Actualizar Ficha' : 'Nuevo Residente'}
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">{editingResident ? 'Modificando datos del usuario existente' : 'Ingrese los datos básicos del nuevo integrante'}</p>
                  </div>
                  <button onClick={() => { setShowAddModal(false); setEditingResident(null); }} className="p-3 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-2xl transition-all">
                    <X size={24} />
                  </button>
                </div>

<<<<<<< HEAD
                <form onSubmit={handleSave} className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">Nombre Completo</label>
                      <input
                        required
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full bg-black border border-gray-800 rounded-2xl py-4 px-5 text-white focus:border-blue-600 outline-none transition-all font-medium"
                        placeholder="Ej: Juan Pérez"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Correo Electrónico</label>
                      <input
                        required
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-[14px] py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                        placeholder="cmedina@fire-master.cl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Contraseña de Acceso</label>
                      <input
                        required={!editingResident}
                        type="text"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-[14px] py-3 px-4 text-white focus:border-blue-600 outline-none transition-all font-mono"
                        placeholder="Min. 6 caracteres"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Teléfono</label>
                      <input
                        type="text"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="+56 9 1234 5678"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">Patente Vehicular</label>
                      <input
                        type="text"
                        value={formData.plate}
                        onChange={(e) => setFormData({ ...formData, plate: e.target.value })}
                        className="w-full bg-black border border-gray-800 rounded-2xl py-4 px-5 text-white focus:border-blue-600 outline-none transition-all font-medium uppercase"
                        placeholder="ABCD-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">Unidad (Casa/Depto)</label>
                      <input
                        required
                        type="text"
                        value={formData.unit}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        className="w-full bg-black border border-gray-800 rounded-2xl py-4 px-5 text-white focus:border-blue-600 outline-none transition-all font-medium"
                        placeholder="Ej: Torre A - 402"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">Rol en Sistema</label>
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value as Resident['role'] })}
                        className="w-full bg-black border border-gray-800 rounded-2xl py-4 px-5 text-white focus:border-blue-600 outline-none transition-all appearance-none font-medium"
                      >
                        <option value="resident">Residente Propietario</option>
                        <option value="usuario">Usuario / Invitado Permanente</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-6 bg-blue-600/5 rounded-3xl border border-blue-500/10 space-y-4">
                    <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mb-4">Privilegios y Accesos</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setFormData({ ...formData, hasFacilityAccess: !formData.hasFacilityAccess })}>
                        <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${formData.hasFacilityAccess ? 'bg-blue-600 border-blue-600 shadow-lg shadow-blue-600/20' : 'border-gray-800'}`}>
                          {formData.hasFacilityAccess && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                        </div>
                        <label className="text-sm text-gray-300 font-medium cursor-pointer">Acceso a Amenidades</label>
                      </div>

                      <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setFormData({ ...formData, canGenerateQR: !formData.canGenerateQR })}>
                        <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${formData.canGenerateQR ? 'bg-blue-600 border-blue-600 shadow-lg shadow-blue-600/20' : 'border-gray-800'}`}>
                          {formData.canGenerateQR && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                        </div>
                        <label className="text-sm text-gray-300 font-medium cursor-pointer">Generar Códigos QR</label>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-600/20 active:scale-[0.98] text-lg italic"
                  >
                    {editingResident ? 'Guardar Cambios' : 'Registrar Residente'}
                  </button>
                </form>
              </div>
=======
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

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Patentes de Vehículos (Separadas por coma)</label>
                  <input
                    type="text"
                    value={formData.plates.join(', ')}
                    onChange={(e) => setFormData({ ...formData, plates: e.target.value.split(',').map(p => p.trim().toUpperCase()).filter(p => p !== '') })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all font-mono text-sm"
                    placeholder="Ej: ABCD12, FGHI34"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Esto permitirá el acceso automático vía cámara LPR.</p>
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
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
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
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-3xl p-10 shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-red-600/10 rounded-full flex items-center justify-center text-red-500 mx-auto mb-6 border border-red-500/20 shadow-inner">
                <Trash2 size={36} />
              </div>
              <h3 className="text-2xl font-black text-white italic mb-2">¿Eliminar ficha?</h3>
              <p className="text-gray-500 mb-8 font-medium leading-relaxed">
                Esta acción es irreversible. Se revocarán todos los accesos de <span className="text-white">"{deletingResident.name}"</span>.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setDeletingResident(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-4 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-red-600/20"
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
