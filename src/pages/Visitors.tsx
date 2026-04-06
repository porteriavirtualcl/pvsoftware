import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, orderBy, doc, updateDoc, deleteDoc, collectionGroup } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { QrCode, Plus, Calendar, Clock, User, Car, Download, X, AlertCircle, Edit2, Trash2, ShieldCheck, Share2, Building2, Info } from 'lucide-react';
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
  });

  useEffect(() => {
    // Fetch condos for super_admin
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    let q;
    let path = 'visitors';
    
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(
        collectionGroup(db, 'visitors'),
        orderBy('createdAt', 'desc')
      );
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      q = query(
        collectionGroup(db, 'visitors'),
        where('condoId', 'in', profile.condoIds),
        orderBy('createdAt', 'desc')
      );
    } else {
      path = `condos/${profile.condoId || 'default'}/visitors`;
      if (profile.role === 'resident' || profile.role === 'usuario') {
        q = query(
          collection(db, path),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
      } else {
        q = query(
          collection(db, path),
          orderBy('createdAt', 'desc')
        );
      }
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
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => {
      condosUnsubscribe();
      unsubscribe();
    };
  }, [profile, user]);

  const syncWithHardware = async (visitor: any, action: 'ADD' | 'REMOVE' = 'ADD') => {
    if (!visitor.licensePlate && !visitor.qrCodeValue) return;
    
    setSyncing(true);
    try {
      // Create a sync ticket for the hardware bridge
      await addDoc(collection(db, 'sync_queue'), {
        type: visitor.licensePlate ? 'LPR_SYNC' : 'QR_SYNC',
        payload: {
          id: visitor.id,
          name: visitor.visitorName,
          plate: visitor.licensePlate?.toUpperCase().replace(/[^A-Z0-9]/g, '') || '',
          qrCode: visitor.qrCodeValue || '',
          condoId: visitor.condoId,
          validUntil: visitor.date + ' ' + visitor.exitTime,
          action: action
        },
        status: 'pending',
        createdAt: Timestamp.now()
      });
      console.log(`Sync ticket (${action}) created successfully for hardware`);
    } catch (error) {
      console.error("Hardware Sync Error:", error);
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenAdd = () => {
    if (profile?.role === 'resident' && !profile?.canGenerateQR) {
      alert('Tu cuenta no tiene habilitada la generación de QR. Por favor solicita activación a la administración.');
      return;
    }
    setEditingVisitor(null);
    setNewVisitor({
      visitorName: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: format(new Date(), 'HH:mm'),
      exitTime: format(new Date(Date.now() + 6 * 3600000), 'HH:mm'), // +6 hours
      licensePlate: '',
      condoId: profile?.condoId || '',
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
    });
    setShowAddModal(true);
  };

  const handleSaveVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    const condoId = profile.role === 'super_admin' ? newVisitor.condoId : profile.condoId;
    if (!condoId) {
      alert('Por favor selecciona un condominio.');
      return;
    }

    const path = `condos/${condoId}/visitors`;
    
    try {
      if (editingVisitor) {
        const docRef = doc(db, path, editingVisitor.id);
        const visitorData = { ...newVisitor, updatedAt: Timestamp.now() };
        await updateDoc(docRef, visitorData);
        await syncWithHardware({ ...visitorData, id: editingVisitor.id, qrCodeValue: editingVisitor.qrCodeValue });
      } else {
        const qrValue = `PV-${condoId.slice(0,3)}-${user.uid.slice(0,4)}-${Date.now().toString().slice(-6)}`;
        const visitorData = {
          ...newVisitor,
          userId: user.uid,
          condoId: condoId,
          qrCodeValue: qrValue,
          status: 'pending',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };
        const docRef = await addDoc(collection(db, path), visitorData);
        await syncWithHardware({ ...visitorData, id: docRef.id });
      }
      setShowAddModal(false);
      setEditingVisitor(null);
    } catch (error) {
      handleFirestoreError(error, editingVisitor ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDeleteVisitor = async () => {
    if (!profile || !deletingVisitor) return;
    const path = `condos/${deletingVisitor.condoId || profile.condoId || 'default'}/visitors`;
    try {
      // Sync removal with hardware
      await syncWithHardware(deletingVisitor, 'REMOVE');
      
      await deleteDoc(doc(db, path, deletingVisitor.id));
      setDeletingVisitor(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  if (loading && !visitors.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
        <div className="space-y-0.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
              <ShieldCheck size={20} />
            </div>
            <h2 className="text-xl font-black text-white tracking-tight uppercase italic">Visitantes</h2>
          </div>
          <p className="text-gray-500 text-xs font-medium italic">Gestión de accesos inteligentes y pases autorizados.</p>
        </div>
        
        <button
          onClick={handleOpenAdd}
          className="group relative flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-xl shadow-blue-600/20 overflow-hidden active:scale-95 text-sm uppercase tracking-widest"
        >
          <Plus size={18} />
          <span>Generar Pase</span>
        </button>
      </div>

      {/* Stats/Info Banner */}
      {!profile?.canGenerateQR && profile?.role === 'resident' && (
        <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-3xl p-6 flex items-start gap-4">
          <AlertCircle className="text-yellow-500 mt-1 shrink-0" size={24} />
          <div>
            <h4 className="text-yellow-500 font-bold text-lg">Activación Pendiente</h4>
            <p className="text-gray-400">Tu cuenta aún no tiene permiso para generar códigos QR. Por favor contacta a administración.</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {visitors.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-6">
          <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center text-gray-700">
            <QrCode size={48} />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-white">No tienes visitas programadas</h3>
            <p className="text-gray-500 max-w-sm mx-auto">Cuando generes tu primer código QR, aparecerá aquí.</p>
          </div>
        </div>
      )}

      {/* Visitors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <AnimatePresence>
          {visitors.map((visitor, i) => (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              key={visitor.id}
              className="relative group bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-blue-500/50 transition-all duration-300 shadow-lg"
              onClick={() => setSelectedVisitor(visitor)}
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="flex items-start justify-between mb-6">
                <div className="w-12 h-12 bg-gray-950 rounded-xl border border-gray-800 flex items-center justify-center text-blue-500 shadow-inner group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white transition-all cursor-pointer">
                  <QrCode size={24} />
                </div>
                <div className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.1em] border ${
                  visitor.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                  visitor.status === 'entered' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                  'bg-gray-800/50 text-gray-500 border-gray-700'
                }`}>
                  {visitor.status === 'pending' ? 'Próximo' : visitor.status === 'entered' ? 'En Sitio' : 'Finalizado'}
                </div>
              </div>

              <div className="space-y-0.5 mb-6">
                <h3 className="text-lg font-black text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight italic">{visitor.visitorName}</h3>
                <div className="flex items-center gap-2 text-gray-500 font-bold text-[10px] uppercase tracking-widest">
                  <Building2 size={12} />
                  <span>{profile?.condoName || 'Condominio'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-white/5 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Fecha Validez</p>
                  <p className="text-sm font-bold text-gray-200">{visitor.date}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Patente LPR</p>
                  <p className="text-sm font-bold text-blue-400">{visitor.licensePlate || 'PEATORAL'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-white/5">
                <div className="flex items-center gap-1">
                   {(profile?.role === 'super_admin' || visitor.userId === user?.uid) && (
                    <>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleOpenEdit(visitor); }}
                        className="p-2.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-xl transition-all" 
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeletingVisitor(visitor); }}
                        className="p-2.5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all" 
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  )}
                </div>
                <button className="flex items-center gap-2 text-[10px] font-black text-white px-4 py-2 bg-white/5 rounded-xl hover:bg-white/10 transition-all uppercase tracking-widest">
                  Compartir
                  <Share2 size={14} className="text-blue-500" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Add/Edit Visitor Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="relative w-full max-w-2xl bg-gray-900 border border-white/5 rounded-[3rem] p-10 shadow-[0_0_100px_rgba(0,0,0,0.5)] max-h-[90vh] overflow-y-auto no-scrollbar">
              <div className="flex items-center justify-between mb-10">
                <div className="space-y-1">
                  <h3 className="text-3xl font-black text-white italic uppercase tracking-tight">
                    {editingVisitor ? 'Gestionar Pase' : 'Programar Visita'}
                  </h3>
                  <p className="text-gray-500 font-medium text-sm">Completa los datos para generar el acceso automático.</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="w-12 h-12 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-full flex items-center justify-center transition-all">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSaveVisitor} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {(profile?.role === 'super_admin' || profile?.condoScope === 'all') && (
                    <div className="col-span-1 md:col-span-2 space-y-3">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Condominio Destino</label>
                      <div className="relative">
                        <Building2 className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                        <select required value={newVisitor.condoId} onChange={(e) => setNewVisitor({ ...newVisitor, condoId: e.target.value })} className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none appearance-none">
                          <option value="">Seleccionar...</option>
                          {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nombre Invitado</label>
                    <div className="relative">
                      <User className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input required type="text" value={newVisitor.visitorName} onChange={(e) => setNewVisitor({ ...newVisitor, visitorName: e.target.value })} className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none" placeholder="Nombre completo" />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Patente Vehicular (Opcional)</label>
                    <div className="relative">
                      <Car className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input type="text" value={newVisitor.licensePlate} onChange={(e) => setNewVisitor({ ...newVisitor, licensePlate: e.target.value.toUpperCase() })} className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none font-mono" placeholder="AAAA-00" />
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-[2.5rem] p-8 space-y-6">
                  <div className="flex items-center gap-3 mb-2 text-blue-400"><Clock size={18} /><span className="font-black text-[10px] uppercase tracking-widest">Ventana de Validez</span></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                       <p className="text-[9px] text-gray-500 font-bold uppercase pl-1">Fecha</p>
                      <input required type="date" value={newVisitor.date} onChange={(e) => setNewVisitor({ ...newVisitor, date: e.target.value })} className="w-full bg-gray-950 border border-white/5 rounded-xl py-3 px-4 text-white font-bold" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[9px] text-gray-500 font-bold uppercase pl-1">Entrada</p>
                      <input required type="time" value={newVisitor.entryTime} onChange={(e) => setNewVisitor({ ...newVisitor, entryTime: e.target.value })} className="w-full bg-gray-950 border border-white/5 rounded-xl py-3 px-4 text-white font-bold" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[9px] text-gray-500 font-bold uppercase pl-1">Salida</p>
                      <input required type="time" value={newVisitor.exitTime} onChange={(e) => setNewVisitor({ ...newVisitor, exitTime: e.target.value })} className="w-full bg-gray-950 border border-white/5 rounded-xl py-3 px-4 text-white font-bold" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-5 bg-blue-600/10 rounded-2xl border border-blue-500/20">
                  <Info className="text-blue-400 shrink-0" size={20} />
                  <p className="text-[10px] text-blue-400 font-black uppercase tracking-wide leading-relaxed">
                    Sincronización automática: Al generar el pase, tanto el código QR como la patente se enviarán a las cámaras LPR y dispositivos de acceso de inmediato.
                  </p>
                </div>

                <button type="submit" disabled={syncing} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.5rem] transition-all shadow-2xl shadow-blue-600/30 flex items-center justify-center gap-3 text-xl">
                  {syncing ? <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <><QrCode size={24} />{editingVisitor ? 'Actualizar Pase' : 'Generar Pase Autorizado'}</>}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* QR Details Modal */}
      <AnimatePresence>
        {selectedVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedVisitor(null)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white rounded-[3rem] p-10 text-gray-950">
              <div className="flex flex-col items-center">
                <div className="w-full flex justify-between items-center mb-10">
                   <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Pase Digital Activo</span>
                   <button onClick={() => setSelectedVisitor(null)} className="text-gray-300 hover:text-gray-950 transition-colors"><X size={24} /></button>
                </div>
                <div className="p-8 bg-gray-50 rounded-[2.5rem] mb-10"><QRCodeSVG value={selectedVisitor.qrCodeValue} size={220} includeMargin={true} /></div>
                <div className="text-center space-y-2 mb-10">
                  <h3 className="text-3xl font-black uppercase tracking-tight">{selectedVisitor.visitorName}</h3>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Acceso {profile?.condoName || 'Condominio'}</p>
                </div>
                <div className="w-full space-y-3 mb-10">
                   <div className="flex justify-between py-3 border-b border-gray-100"><span className="text-xs font-bold text-gray-400 uppercase">Validez</span><span className="text-sm font-black">{selectedVisitor.date}</span></div>
                   <div className="flex justify-between py-3 border-b border-gray-100"><span className="text-xs font-bold text-gray-400 uppercase">Patente LPR</span><span className="text-sm font-black text-blue-600">{selectedVisitor.licensePlate || 'Peatonal'}</span></div>
                </div>
                <button className="w-full bg-gray-950 text-white font-black py-5 rounded-[1.5rem] flex items-center justify-center gap-3"><Download size={20} /> Guardar Pase</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deletingVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingVisitor(null)} className="absolute inset-0 bg-black/90" />
             <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-sm bg-gray-900 border border-white/5 rounded-[2.5rem] p-10 text-center">
                <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center text-red-500 mx-auto mb-6"><Trash2 size={36} /></div>
                <h3 className="text-2xl font-black text-white italic mb-2">¿Anular Invitación?</h3>
                <p className="text-gray-500 text-sm font-medium mb-10">El código QR de <span className="text-white font-bold">{deletingVisitor.visitorName}</span> será desactivado.</p>
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => setDeletingVisitor(null)} className="bg-gray-800 text-white py-4 rounded-2xl font-black">Cancelar</button>
                  <button onClick={handleDeleteVisitor} className="bg-red-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-red-600/20">Anular</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Visitors;
