import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, collectionGroup } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { 
  Users, 
  Plus, 
  Search, 
  Tool, 
  Shield, 
  Phone, 
  Mail, 
  Edit2, 
  Trash2, 
  X, 
  CheckCircle2, 
  Clock, 
  Settings, 
  Wrench, 
  Building2,
  Lock,
  Globe,
  AlertTriangle,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Technician {
  id: string;
  uid?: string;
  name: string;
  email: string;
  phone: string;
  specialty: string;
  status: 'active' | 'inactive';
  assignment: string[]; // Condo IDs or ['all']
  createdAt: any;
  updatedAt: any;
}

const Technicians = () => {
  const { profile, user } = useAuth();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    specialty: '',
    status: 'active' as Technician['status'],
    assignment: [] as string[]
  });

  const [editingTech, setEditingTech] = useState<Technician | null>(null);
  const [deletingTech, setDeletingTech] = useState<Technician | null>(null);

  useEffect(() => {
    // Fetch condos for selection
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    // Query technicians with Role-based isolation
    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collection(db, 'users'), where('role', '==', 'technician'));
    } else {
       // Admins see techs assigned to their condo
       q = query(collection(db, 'users'), where('role', '==', 'technician'), where('assignment', 'array-contains-any', [profile.condoId, 'all']));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTechnicians(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Technician[]);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'users (technicians)');
    });

    return () => {
      unsubscribe();
      condosUnsubscribe();
    };
  }, [profile, user]);

  const handleOpenAdd = () => {
    setEditingTech(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      specialty: '',
      status: 'active',
      assignment: []
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    
    try {
      const dataToSave = {
        ...formData,
        role: 'technician',
        updatedAt: Timestamp.now()
      };

      if (editingTech) {
        await updateDoc(doc(db, 'users', editingTech.id), dataToSave);
      } else {
        await addDoc(collection(db, 'users'), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
    } catch (error) {
       handleFirestoreError(error, editingTech ? OperationType.UPDATE : OperationType.CREATE, 'users');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingTech) return;
    try {
      await deleteDoc(doc(db, 'users', deletingTech.id));
      setDeletingTech(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'users');
    }
  };

  const filteredTechs = technicians.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.specialty.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading && !technicians.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900 border border-gray-800 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
         <div className="absolute top-0 right-0 p-8 text-blue-500/10"><Wrench size={100} /></div>
         <div className="flex items-center gap-6 relative">
            <div className="w-16 h-16 bg-blue-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-blue-600/30"><Settings size={32} /></div>
            <div>
               <h2 className="text-4xl font-black text-white italic uppercase tracking-tight">Staff Técnico</h2>
               <p className="text-gray-500 font-medium">Mantenimiento preventivo y correctivo especializado.</p>
            </div>
         </div>
         <button onClick={handleOpenAdd} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl flex items-center gap-3 text-lg group relative">
            <Plus size={24} className="group-hover:rotate-90 transition-transform" />
            Integrar Especialista
         </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <AnimatePresence>
          {filteredTechs.map((tech) => (
            <motion.div layout key={tech.id} className="relative group bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 hover:border-blue-500/50 transition-all duration-500 overflow-hidden">
               <div className="absolute top-0 right-0 p-10 flex gap-2">
                  <span className={`px-2 py-1 rounded text-base font-black uppercase tracking-widest ${tech.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-gray-800 text-gray-500'}`}>
                    {tech.status}
                  </span>
               </div>

               <div className="flex items-center gap-6 mb-8">
                  <div className="w-16 h-16 bg-gray-950 rounded-2xl flex items-center justify-center text-blue-500 border border-gray-800 group-hover:scale-110 transition-transform shadow-xl shadow-black/40"><Wrench size={28} /></div>
                  <div className="space-y-1">
                     <h3 className="text-xl font-black text-white uppercase italic tracking-tight">{tech.name}</h3>
                     <p className="text-base text-blue-500 font-black uppercase tracking-[0.2em]">{tech.specialty}</p>
                  </div>
               </div>

               <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-3 text-base text-gray-400 font-medium"><Phone size={14} className="text-blue-500" /> {tech.phone}</div>
                  <div className="flex items-center gap-3 text-base text-gray-400 font-medium"><Mail size={14} className="text-blue-500" /> {tech.email}</div>
                  <div className="flex flex-wrap gap-2 pt-4">
                     {tech.assignment.includes('all') ? (
                       <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-base font-black uppercase text-gray-500 tracking-widest italic">Global Mastery Access</span>
                     ) : (
                       tech.assignment.map(id => (
                          <span key={id} className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-base font-black uppercase text-gray-500 tracking-widest italic">{condos.find(c => c.id === id)?.name || 'Condominio'}</span>
                       ))
                     )}
                  </div>
               </div>

               <div className="flex items-center justify-between pt-8 border-t border-gray-800">
                  <div className="flex items-center gap-2">
                     <Globe size={14} className="text-green-500" />
                     <span className="text-base font-black text-gray-500 uppercase">Red Sincronizada</span>
                  </div>
                  <div className="flex gap-2">
                     <button onClick={() => { setEditingTech(tech); setFormData({...tech}); setShowAddModal(true); }} className="p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-all"><Edit2 size={18} /></button>
                     <button onClick={() => setDeletingTech(tech)} className="p-3 bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-white rounded-xl transition-all"><Trash2 size={18} /></button>
                  </div>
               </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

       <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-xl bg-gray-900 border border-gray-800 rounded-[3rem] p-10 overflow-y-auto max-h-[90vh] no-scrollbar shadow-[0_0_100px_rgba(59,130,246,0.1)]">
                <h3 className="text-xl font-black text-white italic uppercase tracking-tight mb-10">Ficha Técnica</h3>
                <form onSubmit={handleSave} className="space-y-6">
                   <div className="space-y-2">
                      <label className="text-base font-black text-gray-400 uppercase tracking-widest ml-1">Nombre Completo Specialist</label>
                      <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black" />
                   </div>
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-base font-black text-gray-400 uppercase tracking-widest ml-1">Especialidad / Firma</label>
                        <input required type="text" value={formData.specialty} onChange={(e) => setFormData({...formData, specialty: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-blue-500 font-bold" placeholder="Ej: Redes / CCTV" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-base font-black text-gray-400 uppercase tracking-widest ml-1">Teléfono</label>
                        <input required type="text" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold" />
                      </div>
                   </div>
                   <div className="space-y-2">
                      <label className="text-base font-black text-gray-400 uppercase tracking-widest ml-1">Email de Acceso</label>
                      <input required type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold" />
                   </div>
                   <div className="space-y-2">
                      <label className="text-base font-black text-gray-400 uppercase tracking-widest ml-1">Asignación de Condominios</label>
                      <div className="p-6 bg-gray-950 border border-gray-800 rounded-2xl space-y-3 max-h-40 overflow-y-auto no-scrollbar">
                         <label className="flex items-center gap-3 cursor-pointer group">
                            <input type="checkbox" checked={formData.assignment.includes('all')} onChange={(e) => setFormData({...formData, assignment: e.target.checked ? ['all'] : []})} className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-blue-600" />
                            <span className="text-base font-black text-gray-500 group-hover:text-white uppercase italic tracking-widest transition-colors">Maestría Global (Todos)</span>
                         </label>
                         {condos.map(c => (
                            <label key={c.id} className="flex items-center gap-3 cursor-pointer group">
                               <input type="checkbox" disabled={formData.assignment.includes('all')} checked={formData.assignment.includes(c.id)} onChange={(e) => {
                                  let newAssign = [...formData.assignment];
                                  if (e.target.checked) newAssign.push(c.id);
                                  else newAssign = newAssign.filter(id => id !== c.id);
                                  setFormData({...formData, assignment: newAssign});
                               }} className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-blue-600" />
                               <span className="text-base font-bold text-gray-500 group-hover:text-white transition-colors">{c.name}</span>
                            </label>
                         ))}
                      </div>
                   </div>
                   <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-600/30 text-lg">
                      {saving ? 'Registrando...' : 'Actualizar Credenciales'}
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Technicians;
