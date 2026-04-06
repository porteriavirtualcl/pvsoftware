import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Users, Search, Plus, Filter, MoreVertical, Mail, Building2, Home, Edit2, Trash2, X, User, ShieldAlert, QrCode } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp, where } from 'firebase/firestore';
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
    password: '',
    canGenerateQR: true,
    hasFacilityAccess: true,
    plates: [] as string[]
  });

  useEffect(() => {
    const condosPath = 'condos';
    const condosUnsubscribe = onSnapshot(collection(db, condosPath), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || 'Condominio'
      })) as Condo[];
      setCondos(data);
    });

    if (!profile?.role) return () => condosUnsubscribe();

    const path = 'users';
    let q;
    
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collection(db, path), where('role', 'in', ['resident', 'usuario']));
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      q = query(collection(db, path), where('condoId', 'in', profile.condoIds), where('role', 'in', ['resident', 'usuario']));
    } else {
      q = query(collection(db, path), where('condoId', '==', profile.condoId), where('role', 'in', ['resident', 'usuario']));
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
    setEditingResident(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      plate: '',
      emergencyContact: '',
      unit: '',
      condoId: profile?.condoId || (condos[0]?.id || ''),
      status: 'Pendiente',
      role: 'resident',
      password: '',
      canGenerateQR: true,
      hasFacilityAccess: true,
      plates: []
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
      password: '',
      canGenerateQR: resident.canGenerateQR ?? true,
      hasFacilityAccess: resident.hasFacilityAccess ?? true,
      plates: resident.plates || []
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const path = 'users';
    
    try {
      let finalUid = editingResident?.uid || '';

      if (!editingResident && formData.password) {
        try {
          const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
          const secondaryAuth = getAuth(secondaryApp);
          const userCredential = await createUserWithEmailAndPassword(secondaryAuth, formData.email, formData.password);
          finalUid = userCredential.user.uid;
          await signOut(secondaryAuth);
          await deleteApp(secondaryApp);
        } catch (authErr: any) {
          console.warn("Auth Registration Warning:", authErr);
        }
      }

      const selectedCondo = condos.find(c => c.id === formData.condoId);
      const dataToSave = {
        ...formData,
        uid: finalUid,
        condoName: selectedCondo?.name || profile?.condoName || 'Condominio',
        updatedAt: Timestamp.now()
      };

      if (editingResident) {
        await updateDoc(doc(db, path, editingResident.id), dataToSave);
      } else {
        await addDoc(collection(db, path), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });
      }
      
      setShowAddModal(false);
      setEditingResident(null);
    } catch (error) {
      handleFirestoreError(error, editingResident ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingResident) return;
    try {
      await deleteDoc(doc(db, 'users', deletingResident.id));
      setDeletingResident(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'users');
    }
  };

  const filteredResidents = residents.filter(r => 
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.unit.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <Users className="text-blue-500" size={28} />
            Residentes / Usuarios
          </h2>
          <p className="text-gray-400 mt-1 italic">Gestión integral de la comunidad y control de accesos.</p>
        </div>
        <button onClick={handleOpenAdd} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2">
          <Plus size={20} /> Nuevo Residente
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-gray-800 bg-gray-900/50 flex flex-col md:flex-row gap-4">
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-sans">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-[0.2em] border-b border-gray-800">
                <th className="px-8 py-5 font-black">Información Personal</th>
                <th className="px-8 py-5 font-black">Unidad / Patente</th>
                <th className="px-8 py-5 font-black">Estado</th>
                <th className="px-8 py-5 font-black text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filteredResidents.map((resident) => (
                <tr key={resident.id} className="hover:bg-blue-600/5 transition-all">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-400 font-black">
                        {resident.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white tracking-tight">{resident.name}</p>
                        <p className="text-xs text-gray-500 font-medium">{resident.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-gray-300 font-bold">
                        <Home size={14} className="text-blue-500" /> {resident.unit}
                      </div>
                      {resident.plate && <div className="text-[10px] text-blue-400 font-black uppercase tracking-widest">{resident.plate}</div>}
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                      resident.status === 'Activo' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'
                    }`}>
                      {resident.status}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleOpenEdit(resident)} className="p-2 text-gray-500 hover:text-blue-400 transition-colors"><Edit2 size={18} /></button>
                      <button onClick={() => setDeletingResident(resident)} className="p-2 text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 overflow-y-auto max-h-[90vh]">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-black text-white italic">{editingResident ? 'Editar Ficha' : 'Nuevo Residente'}</h3>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white"><X size={24} /></button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Nombre</label>
                    <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Correo</label>
                    <input required type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Contraseña</label>
                    <input required={!editingResident} type="text" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none font-mono" placeholder="Definir contraseña" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Unidad</label>
                    <input required type="text" value={formData.unit} onChange={(e) => setFormData({...formData, unit: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none" />
                  </div>
                </div>

                {profile?.role === 'super_admin' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Condominio</label>
                    <select value={formData.condoId} onChange={(e) => setFormData({...formData, condoId: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none">
                      {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="bg-blue-600/5 p-4 rounded-2xl border border-blue-500/20 flex gap-3">
                  <ShieldAlert className="text-blue-500 shrink-0" size={18} />
                  <p className="text-[10px] text-blue-400 font-bold italic leading-relaxed">
                    Nota: El sistema registrará automáticamente al residente para que pueda entrar con su email y clave al instante.
                  </p>
                </div>

                <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl transition-all shadow-xl shadow-blue-600/20 flex items-center justify-center gap-2">
                  {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : (editingResident ? 'Guardar Cambios' : 'Registrar Residente')}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deletingResident && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingResident(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-3xl p-10 text-center shadow-2xl">
                <Trash2 className="text-red-500 mx-auto mb-4" size={48} />
                <h3 className="text-xl font-bold text-white mb-2">¿Eliminar residente?</h3>
                <p className="text-gray-500 text-sm mb-8">Esta acción no se puede deshacer.</p>
                <div className="flex gap-4">
                  <button onClick={() => setDeletingResident(null)} className="flex-1 bg-gray-800 text-white py-3 rounded-xl font-bold">No</button>
                  <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold">Sí, eliminar</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Residents;
