import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, getDocs } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Plus, Search, User, Home, QrCode, ShieldCheck, Mail, Edit2, Trash2, X, AlertOctagon, Car, Settings, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';

// We need the config for the secondary app trick
import firebaseConfig from '../../firebase-applet-config.json';

interface Resident {
  id: string;
  uid?: string;
  name: string;
  email: string;
  unit: string;
  condoId: string;
  condoName: string;
  status: 'Activo' | 'Inactivo' | 'Pendiente';
  role: 'resident' | 'usuario';
  plates: string[];
  canGenerateQR: boolean;
  hasFacilityAccess: boolean;
  createdAt: any;
  updatedAt: any;
}

const Residents = () => {
  const { profile, user } = useAuth();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '', // For automated Auth registration
    unit: '',
    condoId: '',
    status: 'Activo' as Resident['status'],
    role: 'resident' as Resident['role'],
    plates: [] as string[],
    canGenerateQR: true,
    hasFacilityAccess: true
  });

  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [deletingResident, setDeletingResident] = useState<Resident | null>(null);

  useEffect(() => {
    // Fetch condos for super_admin
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    // Isolation logic
    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collection(db, 'users'), where('role', 'in', ['resident', 'usuario']));
    } else if (profile.condoScope === 'multiple' && profile.condoIds) {
      q = query(collection(db, 'users'), where('condoId', 'in', profile.condoIds), where('role', 'in', ['resident', 'usuario']));
    } else {
      q = query(collection(db, 'users'), where('condoId', '==', profile.condoId || 'default'), where('role', 'in', ['resident', 'usuario']));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setResidents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Resident[]);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => {
      unsubscribe();
      condosUnsubscribe();
    };
  }, [profile, user]);

  const handleOpenAdd = () => {
    setEditingResident(null);
    setFormData({
      name: '',
      email: '',
      password: '',
      unit: '',
      condoId: profile?.condoId || '',
      status: 'Activo',
      role: 'resident',
      plates: [],
      canGenerateQR: true,
      hasFacilityAccess: true
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (resident: Resident) => {
    setEditingResident(resident);
    setFormData({
      name: resident.name,
      email: resident.email,
      password: '', // Don't show existing passwords
      unit: resident.unit,
      condoId: resident.condoId,
      status: resident.status,
      role: resident.role,
      plates: resident.plates || [],
      canGenerateQR: resident.canGenerateQR ?? true,
      hasFacilityAccess: resident.hasFacilityAccess ?? true
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);

    const selectedCondo = condos.find(c => c.id === formData.condoId);
    let finalUid = editingResident?.uid || '';

    // LOGIC: Automated Auth Provisioning for NEW residents
    if (!editingResident && formData.password) {
      try {
        const secondaryApp = initializeApp(firebaseConfig, 'SecondaryAppResidents');
        const secondaryAuth = getAuth(secondaryApp);
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, formData.email, formData.password);
        finalUid = userCredential.user.uid;
        await signOut(secondaryAuth);
        await deleteApp(secondaryApp);
      } catch (authErr: any) {
        console.warn("Auth Registration Warning:", authErr);
        // If user already exists in Auth, we might want to check that later
      }
    }

    try {
      const dataToSave = {
        ...formData,
        uid: finalUid,
        condoName: selectedCondo?.name || profile?.condoName || 'Condominio',
        updatedAt: Timestamp.now()
      };
      // Password shouldn't be in Firestore
      const { password, ...firestoreData } = dataToSave;

      if (editingResident) {
        await updateDoc(doc(db, 'users', editingResident.id), firestoreData);
      } else {
        await addDoc(collection(db, 'users'), {
          ...firestoreData,
          createdAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
    } catch (error) {
       handleFirestoreError(error, editingResident ? OperationType.UPDATE : OperationType.CREATE, 'users');
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

  if (loading && !residents.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
        <div className="space-y-0.5">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-white italic tracking-tight uppercase">Gestión de Residentes</h2>
            <div className="bg-blue-600/10 text-blue-500 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border border-blue-500/20">
              {residents.length} Totales
            </div>
          </div>
          <p className="text-gray-500 text-xs font-medium italic">Administración de accesos, unidades y dispositivos LPR.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por nombre, unidad o correo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-64 bg-gray-950 border border-gray-800 rounded-xl py-3 pl-12 pr-4 text-white text-sm focus:border-blue-600 outline-none transition-all"
            />
          </div>
          <button
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Nuevo Residente
          </button>
        </div>
      </div>

      {/* Grid of cards instead of simple table for better design */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <AnimatePresence>
          {filteredResidents.map((resident) => (
            <motion.div
              layout
              key={resident.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-blue-500/50 transition-all group relative overflow-hidden shadow-lg"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-blue-600/10 transition-colors" />
              
              <div className="flex justify-between items-start mb-4">
                <div className="w-11 h-11 bg-gray-950 rounded-xl flex items-center justify-center text-blue-500 border border-gray-800 group-hover:scale-110 transition-transform shadow-inner">
                  <User size={20} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                    resident.status === 'Activo' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 
                    resident.status === 'Pendiente' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 
                    'bg-red-500/10 text-red-500 border-red-500/20'
                  }`}>
                    {resident.status}
                  </span>
                  <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">{resident.condoName}</p>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div>
                  <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">{resident.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                    <Mail size={12} />
                    <span>{resident.email}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-950/50 p-3 rounded-xl border border-gray-800/50">
                    <p className="text-[9px] text-gray-600 font-black uppercase tracking-tighter mb-1">Unidad/Depto</p>
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
                      <Home size={14} className="text-blue-500" />
                      {resident.unit}
                    </div>
                  </div>
                  <div className="bg-gray-950/50 p-3 rounded-xl border border-gray-800/50">
                    <p className="text-[9px] text-gray-600 font-black uppercase tracking-tighter mb-1">Acceso LPR</p>
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
                      <Car size={14} className="text-blue-500" />
                      {resident.plates?.length || 0} Vehículos
                    </div>
                  </div>
                </div>
                
                {resident.plates && resident.plates.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {resident.plates.map((plate, idx) => (
                      <span key={idx} className="bg-gray-800 text-[10px] font-black px-2 py-0.5 rounded text-gray-400 font-mono">{plate}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-gray-800/50">
                <div className="flex gap-2">
                  <div className={`p-2 rounded-lg ${resident.canGenerateQR ? 'text-green-500 bg-green-500/10' : 'text-gray-700 bg-gray-800/20'}`} title="Pases QR">
                    <QrCode size={16} />
                  </div>
                  <div className={`p-2 rounded-lg ${resident.hasFacilityAccess ? 'text-blue-500 bg-blue-500/10' : 'text-gray-700 bg-gray-800/20'}`} title="Instalaciones">
                    <ShieldCheck size={16} />
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleOpenEdit(resident)} className="p-2.5 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"><Edit2 size={18} /></button>
                  <button onClick={() => setDeletingResident(resident)} className="p-2.5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"><Trash2 size={18} /></button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Modal - Unified form as requested */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-[3.5rem] p-10 overflow-y-auto max-h-[90vh] no-scrollbar shadow-[0_0_100px_rgba(37,99,235,0.1)]">
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h3 className="text-3xl font-black text-white italic">{editingResident ? 'Editar Ficha' : 'Nuevo Residente'}</h3>
                  <p className="text-gray-500 text-sm mt-1">Configuración técnica y de acceso para el recinto.</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="w-12 h-12 bg-gray-800 hover:bg-gray-700 rounded-2xl flex items-center justify-center text-white transition-all"><X size={24} /></button>
              </div>

              <form onSubmit={handleSave} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nombre Completo</label>
                    <div className="relative">
                       <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                       <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-12 pr-4 text-white font-bold focus:border-blue-600 outline-none transition-all" placeholder="Ej: Juan Pablo Pérez" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Email de Acceso</label>
                    <div className="relative">
                       <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                       <input required type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-12 pr-4 text-white font-bold focus:border-blue-600 outline-none transition-all" placeholder="vecino@correo.com" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Contraseña Provisoria</label>
                    <div className="relative">
                       <Settings size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                       <input required={!editingResident} type="text" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-12 pr-4 text-white font-bold focus:border-blue-600 outline-none transition-all font-mono" placeholder={editingResident ? '••••••••' : 'Ej: vecino123'} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Unidad / N° Casa</label>
                    <div className="relative">
                       <Home size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                       <input required type="text" value={formData.unit} onChange={(e) => setFormData({...formData, unit: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-12 pr-4 text-white font-bold focus:border-blue-600 outline-none transition-all" placeholder="Ej: Torre B - 204" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Estado</label>
                    <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value as Resident['status']})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold">
                       <option value="Activo">Activo</option>
                       <option value="Pendiente">Pendiente</option>
                       <option value="Inactivo">Inactivo</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Perfil</label>
                    <select value={formData.role} onChange={(e) => setFormData({...formData, role: e.target.value as Resident['role']})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold">
                       <option value="resident">Residente</option>
                       <option value="usuario">Usuario Extra</option>
                    </select>
                  </div>
                  {profile?.role === 'super_admin' && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Condominio</label>
                      <select value={formData.condoId} onChange={(e) => setFormData({...formData, condoId: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold">
                         {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-gray-950/50 p-8 rounded-3xl border border-gray-800">
                  <div className="space-y-4">
                     <div className="flex items-center gap-3">
                        <input type="checkbox" id="fac" checked={formData.hasFacilityAccess} onChange={(e) => setFormData({...formData, hasFacilityAccess: e.target.checked})} className="w-5 h-5 rounded border-gray-700 bg-black text-blue-600" />
                        <label htmlFor="fac" className="text-sm font-bold text-gray-300 cursor-pointer">Acceso a Instalaciones</label>
                     </div>
                     <div className="flex items-center gap-3">
                        <input type="checkbox" id="qr" checked={formData.canGenerateQR} onChange={(e) => setFormData({...formData, canGenerateQR: e.target.checked})} className="w-5 h-5 rounded border-gray-700 bg-black text-blue-600" />
                        <label htmlFor="qr" className="text-sm font-bold text-gray-300 cursor-pointer">Puede generar Pases QR</label>
                     </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Patentes Vehiculares (LPR)</label>
                    <div className="relative">
                       <Car size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                       <input type="text" value={formData.plates?.join(', ')} onChange={(e) => setFormData({...formData, plates: e.target.value.split(',').map(p => p.trim().toUpperCase()).filter(p => p !== '')})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-12 pr-4 text-white font-mono text-sm" placeholder="ABCD12, FGHI34..." />
                    </div>
                    <p className="text-[9px] text-gray-600 font-bold italic mt-1 italic">Sincronización automática con cámaras.</p>
                  </div>
                </div>

                <div className="bg-blue-600/5 p-5 rounded-2xl border border-blue-500/20 flex gap-4">
                  <ShieldAlert className="text-blue-500 shrink-0" size={24} />
                  <p className="text-[10px] text-blue-400 font-black tracking-wide leading-relaxed uppercase">
                    Aviso: Al guardar, se autorizará automáticamente el correo en el sistema maestro de autenticación.
                  </p>
                </div>

                <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-2xl shadow-blue-600/30 flex items-center justify-center gap-3 text-lg">
                  {saving ? <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : (editingResident ? 'Sincronizar Cambios' : 'Activar y Registrar Residente')}
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
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingResident(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 text-center shadow-2xl">
                <AlertOctagon className="text-red-500 mx-auto mb-6" size={56} />
                <h3 className="text-2xl font-black text-white mb-2 italic">¿Anular Residente?</h3>
                <p className="text-gray-500 text-sm font-medium mb-10 leading-relaxed">Se revocará el acceso de <span className="text-white font-bold">{deletingResident.name}</span> a todas las instalaciones y cámaras LPR.</p>
                <div className="flex gap-4">
                  <button onClick={() => setDeletingResident(null)} className="flex-1 bg-gray-800 text-white py-4 rounded-2xl font-black transition-all">No, Cancelar</button>
                  <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black transition-all shadow-xl shadow-red-600/20">Sí, Anular</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default Residents;
