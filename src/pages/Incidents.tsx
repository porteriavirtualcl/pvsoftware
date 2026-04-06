import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, orderBy, collectionGroup } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { 
  AlertTriangle, 
  Plus, 
  Search, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  MessageSquare, 
  User, 
  MapPin, 
  Camera, 
  Paperclip, 
  X, 
  MoreVertical,
  Edit2,
  Trash2,
  Filter,
  CheckCircle,
  HelpCircle,
  Info,
  Building2,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Incident {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  category: 'security' | 'maintenance' | 'facility' | 'other';
  location: string;
  condoId: string;
  condoName: string;
  reportedBy: string;
  reportedByName: string;
  createdAt: any;
  updatedAt: any;
  imageUrl?: string;
  assignedTo?: string;
}

const Incidents = () => {
  const { profile, user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as Incident['priority'],
    category: 'other' as Incident['category'],
    location: '',
    condoId: profile?.condoId || '',
  });

  const [editingIncident, setEditingIncident] = useState<Incident | null>(null);
  const [deletingIncident, setDeletingIncident] = useState<Incident | null>(null);

  useEffect(() => {
    // Fetch condos for super_admin
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'incidents'), orderBy('createdAt', 'desc'));
    } else if (profile.role === 'resident' || profile.role === 'usuario') {
      q = query(collectionGroup(db, 'incidents'), where('reportedBy', '==', user.uid), orderBy('createdAt', 'desc'));
    } else {
      const path = `condos/${profile.condoId || 'default'}/incidents`;
      q = query(collection(db, path), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setIncidents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Incident[]);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'incidents');
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
    const path = `condos/${condoIdToUse}/incidents`;

    try {
      if (editingIncident) {
        await updateDoc(doc(db, path, editingIncident.id), {
          ...formData,
          updatedAt: Timestamp.now()
        });
      } else {
        await addDoc(collection(db, path), {
          ...formData,
          status: 'open',
          reportedBy: user.uid,
          reportedByName: profile.name,
          condoName: selectedCondo?.name || profile.condoName || 'Condominio',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
      setEditingIncident(null);
    } catch (error) {
       handleFirestoreError(error, editingIncident ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const updateStatus = async (incident: Incident, status: Incident['status']) => {
    const path = `condos/${incident.condoId}/incidents`;
    try {
      await updateDoc(doc(db, path, incident.id), { status, updatedAt: Timestamp.now() });
    } catch (error) {
      console.error(error);
    }
  };

  const filteredIncidents = incidents.filter(inc => {
    const matchesSearch = inc.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         inc.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || inc.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      default: return 'bg-blue-500 text-white';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'resolved': return <CheckCircle2 className="text-green-500" size={16} />;
      case 'in_progress': return <Clock className="text-blue-500 animate-pulse" size={16} />;
      default: return <AlertCircle className="text-yellow-500" size={16} />;
    }
  };

  if (loading && !incidents.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900 border border-gray-800 p-10 rounded-[2.5rem]">
         <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-red-600/10 rounded-3xl flex items-center justify-center text-red-500 border border-red-500/20 shadow-xl shadow-red-600/10"><ShieldAlert size={36} /></div>
            <div>
               <h2 className="text-4xl font-black text-white italic uppercase tracking-tight">Reporte Crítico</h2>
               <p className="text-gray-500 font-medium">Protocolo de incidencias, fallas y seguridad.</p>
            </div>
         </div>
         <button onClick={() => setShowAddModal(true)} className="bg-red-600 hover:bg-red-500 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl flex items-center gap-3 text-lg">
            <Plus size={24} /> Reportar Incidencia
         </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-950 border border-gray-800 rounded-3xl p-6 relative overflow-hidden group">
           <div className={`absolute top-0 right-0 p-6 text-yellow-500/10 group-hover:scale-110 transition-transform`}><AlertCircle size={56} /></div>
           <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Pendientes</p>
           <h3 className="text-3xl font-black text-white">{incidents.filter(i => i.status === 'open').length}</h3>
        </div>
        <div className="bg-gray-950 border border-gray-800 rounded-3xl p-6 relative overflow-hidden group">
           <div className={`absolute top-0 right-0 p-6 text-blue-500/10 group-hover:scale-110 transition-transform`}><Clock size={56} /></div>
           <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">En Proceso</p>
           <h3 className="text-3xl font-black text-white">{incidents.filter(i => i.status === 'in_progress').length}</h3>
        </div>
        <div className="bg-gray-950 border border-gray-800 rounded-3xl p-6 relative overflow-hidden group">
           <div className={`absolute top-0 right-0 p-6 text-green-500/10 group-hover:scale-110 transition-transform`}><CheckCircle2 size={56} /></div>
           <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Resueltos</p>
           <h3 className="text-3xl font-black text-white">{incidents.filter(i => i.status === 'resolved').length}</h3>
        </div>
        <div className="bg-gray-950 border border-gray-800 rounded-3xl p-6">
           <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Total Reportado</p>
           <h3 className="text-3xl font-black text-white">{incidents.length}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
        <AnimatePresence>
          {filteredIncidents.map((incident) => (
            <motion.div layout key={incident.id} className="relative group bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-[2.5rem] p-10 hover:border-red-500/30 transition-all">
                <div className="flex justify-between items-start mb-8">
                   <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${getPriorityColor(incident.priority)}`}>
                      Prioridad {incident.priority}
                   </div>
                   <div className="flex items-center gap-2">
                      {getStatusIcon(incident.status)}
                      <span className="text-[10px] font-black text-gray-500 uppercase">{incident.status}</span>
                   </div>
                </div>

                <div className="space-y-2 mb-8">
                   <h3 className="text-2xl font-black text-white italic uppercase">{incident.title}</h3>
                   <p className="text-sm text-gray-400 font-medium line-clamp-3 leading-relaxed">{incident.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-6 pt-8 border-t border-gray-800">
                    <div className="space-y-1">
                       <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Ubicación</p>
                       <p className="text-xs font-bold text-gray-300">{incident.location}</p>
                    </div>
                    <div className="space-y-1">
                       <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Condominio</p>
                       <p className="text-xs font-bold text-red-500 italic">{incident.condoName}</p>
                    </div>
                </div>

                {profile?.role !== 'resident' && (
                  <div className="flex gap-4 mt-10">
                     <button onClick={() => updateStatus(incident, 'in_progress')} className="flex-1 bg-blue-600/10 hover:bg-blue-600 text-blue-500 hover:text-white font-black py-4 rounded-xl text-xs transition-all uppercase tracking-widest">Atender</button>
                     <button onClick={() => updateStatus(incident, 'resolved')} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-black py-4 rounded-xl text-xs transition-all uppercase tracking-widest">Resolver</button>
                  </div>
                )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

       <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-xl bg-gray-900 border border-gray-800 rounded-[3rem] p-10 overflow-y-auto max-h-[90vh]">
                <h3 className="text-3xl font-black text-white italic uppercase tracking-tight mb-10">Reportar Evento</h3>
                <form onSubmit={handleSave} className="space-y-8">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Título de la incidencia</label>
                      <input required type="text" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black" placeholder="Ej: Portón acceso norte bloqueado" />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Descripción técnica / Detalle</label>
                      <textarea required value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white h-32 resize-none" placeholder="Indicar detalles específicos..." />
                   </div>
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Prioridad</label>
                        <select value={formData.priority} onChange={(e) => setFormData({...formData, priority: e.target.value as Incident['priority']})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black">
                           <option value="low">Baja</option>
                           <option value="medium">Media</option>
                           <option value="high">Alta</option>
                           <option value="critical">Crítica</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Ubicación</label>
                        <input required type="text" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black" placeholder="Ej: Torre B, Estacionamiento" />
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
                   <button type="submit" className="w-full bg-red-600 hover:bg-red-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-red-600/30">
                      Emitir Reporte de Seguridad
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Incidents;
