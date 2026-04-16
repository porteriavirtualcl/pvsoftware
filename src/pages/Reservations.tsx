import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, deleteDoc, Timestamp, collectionGroup, orderBy } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Calendar, Clock, Plus, X, Package, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Reservation {
  id: string;
  userId: string;
  userName: string;
  facilityId: string;
  facilityName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  condoId: string;
  condoName?: string;
  unit?: string;
  createdAt: any;
}

const Reservations = () => {
  const { profile, user } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [facilities, setFacilities] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    facilityId: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '10:00',
    endTime: '12:00',
    condoId: ''
  });

  const [editingRes, setEditingRes] = useState<Reservation | null>(null);
  const [deletingRes, setDeletingRes] = useState<Reservation | null>(null);

  useEffect(() => {
    // Fetch condos for super_admin
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    // Fetch facilities for current condo
    const facilitiesPath = `condos/${profile.condoId || 'default'}/facilities`;
    const facUnsubscribe = onSnapshot(collection(db, facilitiesPath), (snapshot) => {
      setFacilities(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    // Reservations Query with Isolation
    let q;
    const isGlobal = profile.role === 'super_admin' || profile.condoScope === 'all';
    const isResident = profile.role === 'resident' || profile.role === 'usuario';
    if (isGlobal) {
      q = query(collectionGroup(db, 'reservations')); // no orderBy → sort client-side
    } else if (isResident) {
      q = query(collectionGroup(db, 'reservations'), where('userId', '==', user.uid));
    } else {
      const path = `condos/${profile.condoId || 'default'}/reservations`;
      q = query(collection(db, path), orderBy('date', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Reservation[];
      if (isGlobal || isResident) {
        list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) * -1 || (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      }
      setReservations(list);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'reservations');
    });

    return () => {
      unsubscribe();
      facUnsubscribe();
      condosUnsubscribe();
    };
  }, [profile, user]);

  const handleOpenAdd = () => {
    setEditingRes(null);
    setFormData({
      facilityId: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      startTime: '10:00',
      endTime: '12:00',
      condoId: profile?.condoId || ''
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    setSaving(true);

    const selectedCondo = condos.find(c => c.id === formData.condoId);
    const selectedFacility = facilities.find(f => f.id === formData.facilityId);
    const condoIdToUse = formData.condoId || profile.condoId || 'default';
    const path = `condos/${condoIdToUse}/reservations`;

    try {
      const dataToSave = {
        userId: user.uid,
        userName: profile.name,
        unit: profile.unit || '',
        facilityId: formData.facilityId,
        facilityName: selectedFacility?.name || 'Instalación',
        date: formData.date,
        startTime: formData.startTime,
        endTime: formData.endTime,
        status: 'approved' as Reservation['status'],
        condoId: condoIdToUse,
        condoName: selectedCondo?.name || profile.condoName || 'Condominio',
        updatedAt: Timestamp.now()
      };

      if (editingRes) {
        await updateDoc(doc(db, path, editingRes.id), dataToSave);
      } else {
        await addDoc(collection(db, path), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
    } catch (error) {
       handleFirestoreError(error, editingRes ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (res: Reservation, status: Reservation['status']) => {
    const path = `condos/${res.condoId}/reservations`;
    try {
      await updateDoc(doc(db, path, res.id), { status });
    } catch (error) {
      console.error(error);
    }
  };

  if (loading && !reservations.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
        <div className="space-y-0.5">
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-black text-white italic tracking-tight uppercase">Agenda de Reservas</h2>
          </div>
          <p className="text-gray-500 text-base font-medium italic">Gestión de espacios comunes y amenidades.</p>
        </div>
        <button onClick={handleOpenAdd} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl shadow-blue-600/30 flex items-center gap-2 text-lg">
          <Plus size={24} /> Reservar Ahora
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <AnimatePresence>
          {reservations.map((res) => (
            <motion.div layout key={res.id} className="relative group bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-[2.5rem] p-10 hover:border-blue-500/50 transition-all overflow-hidden">
               <div className="absolute top-0 right-0 p-10">
                  <div className={`px-4 py-1.5 rounded-full text-base font-black uppercase tracking-widest border ${
                    res.status === 'cancelled' ? 'bg-gray-800 text-gray-500 border-gray-700' :
                    res.status === 'rejected'  ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                    'bg-green-500/10 text-green-500 border-green-500/20'
                  }`}>
                    {res.status === 'cancelled' ? 'Cancelado' : res.status === 'rejected' ? 'Rechazado' : 'Confirmado'}
                  </div>
               </div>

               <div className="flex items-start gap-8 mb-8">
                  <div className="w-20 h-20 bg-gray-950 rounded-3xl flex items-center justify-center text-blue-500 border border-gray-800 shadow-xl group-hover:scale-105 transition-transform"><Package size={40} /></div>
                  <div className="space-y-1">
                     <h3 className="text-xl font-black text-white uppercase italic">{res.facilityName}</h3>
                     <p className="text-base text-gray-500 font-bold uppercase tracking-widest">{res.userName} • {res.unit}</p>
                     <p className="text-base text-blue-500 font-bold uppercase italic">{res.condoName}</p>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-6 pt-8 border-t border-gray-800">
                  <div className="space-y-1">
                     <p className="text-base font-black text-gray-600 uppercase italic">Fecha de Uso</p>
                     <div className="flex items-center gap-2 text-white font-bold"><Calendar size={14} className="text-blue-500" /> {res.date}</div>
                  </div>
                  <div className="space-y-1">
                     <p className="text-base font-black text-gray-600 uppercase italic">Ventana Horaria</p>
                     <div className="flex items-center gap-2 text-white font-bold"><Clock size={14} className="text-blue-500" /> {res.startTime} - {res.endTime}</div>
                  </div>
               </div>

               {(profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'operator') && res.status !== 'cancelled' && (
                 <div className="flex gap-4 mt-10">
                    <button onClick={() => updateStatus(res, 'cancelled')} className="flex-1 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all">
                       <XCircle size={18} /> Cancelar Reserva
                    </button>
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
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-xl bg-gray-900 border border-gray-800 rounded-[3rem] p-10 no-scrollbar shadow-[0_0_100px_rgba(59,130,246,0.1)]">
                <div className="flex justify-between items-center mb-10">
                   <h3 className="text-xl font-black text-white italic uppercase tracking-tight">Nueva Reserva</h3>
                   <button onClick={() => setShowAddModal(false)} className="w-12 h-12 bg-gray-800 hover:bg-gray-700 text-white rounded-2xl flex items-center justify-center"><X size={24} /></button>
                </div>
                <form onSubmit={handleSave} className="space-y-8">
                   <div className="space-y-3">
                      <label className="text-base font-black text-gray-500 uppercase tracking-widest pl-2">Seleccionar Instalación</label>
                      <select required value={formData.facilityId} onChange={(e) => setFormData({...formData, facilityId: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold focus:border-blue-600 outline-none">
                         <option value="">Seleccione espacio...</option>
                         {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest pl-2">Fecha</label>
                        <input required type="date" value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold" />
                      </div>
                      {profile?.role === 'super_admin' && (
                        <div className="space-y-3">
                           <label className="text-base font-black text-gray-500 uppercase tracking-widest pl-2">Condominio</label>
                           <select value={formData.condoId} onChange={(e) => setFormData({...formData, condoId: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold italic">
                              {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                           </select>
                        </div>
                      )}
                   </div>
                   <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest pl-2">Desde</label>
                        <input required type="time" value={formData.startTime} onChange={(e) => setFormData({...formData, startTime: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold" />
                      </div>
                      <div className="space-y-3">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest pl-2">Hasta</label>
                        <input required type="time" value={formData.endTime} onChange={(e) => setFormData({...formData, endTime: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold" />
                      </div>
                   </div>
                   <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-2xl">
                      {saving ? 'Guardando...' : 'Confirmar Reserva'}
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Reservations;
