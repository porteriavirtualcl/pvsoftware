import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, orderBy, collectionGroup } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { 
  Package, 
  Plus, 
  Search, 
  MapPin, 
  Users, 
  Clock, 
  Edit2, 
  Trash2, 
  X, 
  CheckCircle2, 
  AlertCircle,
  Building2,
  Calendar,
  ShieldCheck,
  Zap,
  Smartphone,
  Lock,
  ArrowUpRight,
  TrendingUp,
  CreditCard,
  ShieldAlert,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Facility {
  id: string;
  name: string;
  description: string;
  capacity: number;
  status: 'active' | 'maintenance' | 'inactive';
  location: string;
  price?: string;
  condoId: string;
  condoName: string;
  rules?: string;
  images?: string[];
  createdAt: any;
  updatedAt: any;
}

const Facilities = () => {
  const { profile, user } = useAuth();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    capacity: 0,
    status: 'active' as Facility['status'],
    location: '',
    price: '',
    condoId: profile?.condoId || '',
    rules: ''
  });

  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [deletingFacility, setDeletingFacility] = useState<Facility | null>(null);

  useEffect(() => {
    // Fetch condos for super_admin
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'facilities'), orderBy('createdAt', 'desc'));
    } else {
      const path = `condos/${profile.condoId || 'default'}/facilities`;
      q = query(collection(db, path), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setFacilities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Facility[]);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'facilities');
    });

    return () => {
      unsubscribe();
      condosUnsubscribe();
    };
  }, [profile, user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    const condoIdToUse = formData.condoId || profile.condoId || 'default';
    const path = `condos/${condoIdToUse}/facilities`;

    try {
      const dataToSave = {
        ...formData,
        capacity: Number(formData.capacity),
        condoName: selectedCondo?.name || profile.condoName || 'Condominio',
        updatedAt: Timestamp.now()
      };

      if (editingFacility) {
        await updateDoc(doc(db, path, editingFacility.id), dataToSave);
      } else {
        await addDoc(collection(db, path), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
      setEditingFacility(null);
    } catch (error) {
       handleFirestoreError(error, editingFacility ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!deletingFacility) return;
    const path = `condos/${deletingFacility.condoId}/facilities`;
    try {
      await deleteDoc(doc(db, path, deletingFacility.id));
      setDeletingFacility(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const filteredFacilities = facilities.filter(f =>
    f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading && !facilities.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900 border border-gray-800 p-10 rounded-[2.5rem]">
         <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-blue-600/10 rounded-3xl flex items-center justify-center text-blue-500 border border-blue-500/20 shadow-xl shadow-blue-600/10"><Package size={36} /></div>
            <div>
               <h2 className="text-4xl font-black text-white italic uppercase tracking-tight">Espacios Comunes</h2>
               <p className="text-gray-500 font-medium">Gestión de quinchos, piscinas, salones y amenidades.</p>
            </div>
         </div>
         {profile?.role !== 'resident' && (
           <button onClick={() => { setEditingFacility(null); setShowAddModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl flex items-center gap-3 text-lg">
              <Plus size={24} /> Nueva Instalación
           </button>
         )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <AnimatePresence>
          {filteredFacilities.map((facility) => (
            <motion.div layout key={facility.id} className="relative group bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-[2.5rem] p-10 hover:border-blue-500/30 transition-all">
                <div className="absolute top-0 right-0 p-10">
                   <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                    facility.status === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                    facility.status === 'maintenance' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                    'bg-red-500/10 text-red-500 border-red-500/20'
                   }`}>
                    {facility.status === 'active' ? 'Disponible' : facility.status === 'maintenance' ? 'Mantenimiento' : 'Cerrado'}
                   </div>
                </div>

                <div className="space-y-2 mb-8 pr-12">
                   <h3 className="text-2xl font-black text-white italic uppercase tracking-tight">{facility.name}</h3>
                   <p className="text-sm text-gray-400 font-medium line-clamp-2 leading-relaxed">{facility.description}</p>
                   <div className="flex items-center gap-2 text-[10px] text-blue-500 font-black uppercase italic mt-2">{facility.condoName}</div>
                </div>

                <div className="grid grid-cols-2 gap-6 py-8 border-y border-gray-800">
                    <div className="space-y-1">
                       <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest italic">Aforo Máximo</p>
                       <div className="flex items-center gap-2 text-white font-bold"><Users size={14} className="text-blue-500" /> {facility.capacity} Personas</div>
                    </div>
                    <div className="space-y-1">
                       <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest italic">Ubicación</p>
                       <div className="flex items-center gap-2 text-white font-bold"><MapPin size={14} className="text-blue-500" /> {facility.location}</div>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-8">
                   <div className="flex items-center gap-2">
                       <CreditCard size={16} className="text-gray-600" />
                       <span className="text-sm font-black text-gray-300">{facility.price && facility.price !== '0' ? `$${facility.price}` : 'Gratuito'}</span>
                   </div>
                   <div className="flex gap-2">
                      {profile?.role !== 'resident' && (
                        <>
                          <button onClick={() => { setEditingFacility(facility); setFormData({...facility}); setShowAddModal(true); }} className="p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-all shadow-xl"><Edit2 size={18} /></button>
                          <button onClick={() => setDeletingFacility(facility)} className="p-3 bg-red-600/10 text-red-500 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-xl"><Trash2 size={18} /></button>
                        </>
                      )}
                      {facility.status === 'active' && (
                        <button className="px-6 py-3 bg-blue-600 text-white font-black rounded-xl text-xs uppercase tracking-widest hover:bg-blue-500 transition-all flex items-center gap-2">
                           <Calendar size={14} /> Reservar
                        </button>
                      )}
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
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-xl bg-gray-900 border border-gray-800 rounded-[3rem] p-10 overflow-y-auto max-h-[90vh]">
                <h3 className="text-3xl font-black text-white italic uppercase tracking-tight mb-10">Configurar Espacio</h3>
                <form onSubmit={handleSave} className="space-y-6">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Nombre Instalación</label>
                      <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black" placeholder="Ej: Quincho Principal" />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Descripción</label>
                      <textarea required value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white h-24 resize-none" />
                   </div>
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Capacidad Máx.</label>
                        <input required type="number" value={formData.capacity} onChange={(e) => setFormData({...formData, capacity: Number(e.target.value)})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Costo Uso ($)</label>
                        <input type="text" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black" placeholder="0" />
                      </div>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Estado</label>
                        <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value as Facility['status']})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black">
                           <option value="active">Activo / Disponible</option>
                           <option value="maintenance">En Mantenimiento</option>
                           <option value="inactive">Clausurado / Fuera de Servicio</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Ubicación</label>
                        <input required type="text" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black" placeholder="Sector A / Terraza" />
                      </div>
                   </div>
                   {profile?.role === 'super_admin' && (
                     <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Condominio</label>
                        <select value={formData.condoId} onChange={(e) => setFormData({...formData, condoId: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black italic">
                           {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                     </div>
                   )}
                   <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-600/30">
                      Publicar Instalación
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Facilities;
