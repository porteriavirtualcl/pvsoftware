import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, orderBy, doc, updateDoc, deleteDoc, collectionGroup } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { QrCode, Plus, Calendar, Clock, User, Car, Download, X, AlertCircle, Edit2, Trash2, ShieldCheck, Share2, Info, Building2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Visitor {
  id: string;
  userId: string;
  visitorName: string;
  entryTime: string;
  exitTime: string;
  date: string;
  licensePlate?: string;
  qrCodeValue: string;
  status: 'pending' | 'entered' | 'exited';
  condoId: string;
  condoName?: string;
  createdAt: any;
}

const Visitors = () => {
  const { profile, user } = useAuth();
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [editingVisitor, setEditingVisitor] = useState<Visitor | null>(null);
  const [deletingVisitor, setDeletingVisitor] = useState<Visitor | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);
  
  const [newVisitor, setNewVisitor] = useState({
    visitorName: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    entryTime: '12:00',
    exitTime: '18:00',
    licensePlate: '',
    condoId: '',
    condoName: '',
  });

  useEffect(() => {
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    let q;
    const isResident = profile.role === 'resident' || profile.role === 'usuario';
    
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'visitors'), orderBy('createdAt', 'desc'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      q = query(collectionGroup(db, 'visitors'), where('condoId', 'in', profile.condoIds), orderBy('createdAt', 'desc'));
    } else if (isResident) {
      const path = `condos/${profile.condoId || 'default'}/visitors`;
      q = query(collection(db, path), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    } else {
      const path = `condos/${profile.condoId || 'default'}/visitors`;
      q = query(collection(db, path), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const visitorData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Visitor[];
      setVisitors(visitorData);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'visitors');
    });

    return () => {
      condosUnsubscribe();
      unsubscribe();
    };
  }, [profile, user]);

  const syncWithHardware = async (visitor: any) => {
    setSyncing(true);
    // Mock hardware sync
    await new Promise(r => setTimeout(r, 1000));
    setSyncing(false);
  };

  const handleOpenAdd = () => {
    if (profile?.role === 'resident' && !profile?.canGenerateQR) {
      alert('Tu cuenta no tiene habilitada la generación de QR. Solicita activación.');
      return;
    }
    setEditingVisitor(null);
    setNewVisitor({
      visitorName: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: format(new Date(), 'HH:mm'),
      exitTime: format(new Date(Date.now() + 6 * 3600000), 'HH:mm'),
      licensePlate: '',
      condoId: profile?.condoId || '',
      condoName: profile?.condoName || '',
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (visitor: Visitor) => {
    setEditingVisitor(visitor);
    setNewVisitor({
      visitorName: visitor.visitorName,
      date: visitor.date,
      entryTime: visitor.entryTime,
      exitTime: visitor.exitTime,
      licensePlate: visitor.licensePlate || '',
      condoId: visitor.condoId,
      condoName: visitor.condoName || '',
    });
    setShowAddModal(true);
  };

  const handleSaveVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    const targetCondoId = profile.role === 'super_admin' ? newVisitor.condoId : profile.condoId;
    if (!targetCondoId) return alert('Selecciona un condominio.');

    const path = `condos/${targetCondoId}/visitors`;
    try {
      if (editingVisitor) {
        await updateDoc(doc(db, path, editingVisitor.id), { ...newVisitor, updatedAt: Timestamp.now() });
      } else {
        const qrValue = `PV-${targetCondoId.slice(0,3)}-${user.uid.slice(0,4)}-${Date.now()}`;
        const docRef = await addDoc(collection(db, path), {
          ...newVisitor,
          userId: user.uid,
          qrCodeValue: qrValue,
          status: 'pending',
          condoId: targetCondoId,
          condoName: newVisitor.condoName || profile.condoName,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
        await syncWithHardware({ visitorName: newVisitor.visitorName, qrCodeValue: qrValue });
      }
      setShowAddModal(false);
      setEditingVisitor(null);
    } catch (error) {
      handleFirestoreError(error, editingVisitor ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDeleteVisitor = async () => {
    if (!deletingVisitor) return;
    const path = `condos/${deletingVisitor.condoId || profile?.condoId}/visitors`;
    try {
      await deleteDoc(doc(db, path, deletingVisitor.id));
      setDeletingResident(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  if (loading && !visitors.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
             <ShieldCheck className="text-blue-500" size={32} />
             <h2 className="text-4xl font-black text-white tracking-tight">Visitantes Autorizados</h2>
          </div>
          <p className="text-gray-400 mt-2 font-medium">Control de acceso inteligente vía QR y Patente LPR.</p>
        </div>
        <button onClick={handleOpenAdd} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-xl shadow-blue-600/30 flex items-center gap-2">
          <Plus size={22} /> Generar Pase de Acceso
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {visitors.map((visitor) => (
          <motion.div layout key={visitor.id} onClick={() => setSelectedVisitor(visitor)} className="bg-gray-900 border border-gray-800 rounded-[2.5rem] p-8 hover:border-blue-500/50 transition-all cursor-pointer group">
            <div className="flex justify-between items-start mb-6">
              <div className="w-14 h-14 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-400"><QrCode size={28} /></div>
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${visitor.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-500'}`}>
                {visitor.status === 'pending' ? 'Próximo' : 'En Sitio'}
              </span>
            </div>
            <h3 className="text-2xl font-black text-white mb-1">{visitor.visitorName}</h3>
            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-6">{visitor.condoName || 'Condominio'}</p>
            <div className="grid grid-cols-2 gap-4 pt-6 border-t border-gray-800">
               <div><p className="text-[10px] text-gray-600 font-black uppercase">Validez</p><p className="text-sm font-bold text-gray-300">{visitor.date}</p></div>
               <div><p className="text-[10px] text-gray-600 font-black uppercase">Patente</p><p className="text-sm font-bold text-blue-500">{visitor.licensePlate || 'N/A'}</p></div>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-[3rem] p-10 overflow-y-auto max-h-[90vh]">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-2xl font-black text-white italic">{editingVisitor ? 'Editar Pase' : 'Programar Visita'}</h3>
                  <button onClick={() => setShowAddModal(false)}><X size={24} className="text-gray-400" /></button>
                </div>
                <form onSubmit={handleSaveVisitor} className="space-y-6">
                   {profile?.role === 'super_admin' && (
                     <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Condominio</label>
                        <select required value={newVisitor.condoId} onChange={(e) => { const s = e.target.selectedOptions[0]; setNewVisitor({...newVisitor, condoId: e.target.value, condoName: s.text}); }} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white">
                           <option value="">Seleccionar...</option>
                           {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                     </div>
                   )}
                   <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Nombre Invitado</label>
                      <input required type="text" value={newVisitor.visitorName} onChange={(e) => setNewVisitor({...newVisitor, visitorName: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white" />
                   </div>
                   <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Patente (Opcional)</label>
                        <input type="text" value={newVisitor.licensePlate} onChange={(e) => setNewVisitor({...newVisitor, licensePlate: e.target.value.toUpperCase()})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-mono" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Fecha</label>
                        <input required type="date" value={newVisitor.date} onChange={(e) => setNewVisitor({...newVisitor, date: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white" />
                      </div>
                   </div>
                   <button type="submit" disabled={syncing} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2">
                      {syncing ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Generar Pase Autorizado'}
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedVisitor(null)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white rounded-[3rem] p-10 text-center">
                <QRCodeSVG value={selectedVisitor.qrCodeValue} size={200} className="mx-auto mb-6" />
                <h3 className="text-2xl font-black text-gray-900 mb-1">{selectedVisitor.visitorName}</h3>
                <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-6">{selectedVisitor.condoName}</p>
                <div className="bg-gray-100 p-4 rounded-2xl text-left space-y-2 mb-8">
                   <div className="flex justify-between"><span className="text-[10px] font-bold text-gray-400">FECHA</span><span className="text-xs font-black">{selectedVisitor.date}</span></div>
                   <div className="flex justify-between"><span className="text-[10px] font-bold text-gray-400">PATENTE</span><span className="text-xs font-black">{selectedVisitor.licensePlate || 'Peatonal'}</span></div>
                </div>
                <button onClick={() => setSelectedVisitor(null)} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-black">Cerrar</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Visitors;
