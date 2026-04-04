import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, orderBy, doc, updateDoc, deleteDoc, collectionGroup, getDocs } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { QrCode, Plus, Calendar, Clock, User, Car, Download, X, CheckCircle2, AlertCircle, Edit2, Trash2, ShieldCheck, Share2, Info, Building2 } from 'lucide-react';
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
  
  const [newVisitor, setNewVisitor] = useState({
    visitorName: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    entryTime: '12:00',
    exitTime: '18:00',
    licensePlate: '',
  });

  useEffect(() => {
    if (!profile || !user) return;

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
    } else if (profile.role === 'resident' || profile.role === 'usuario') {
      path = `condos/${profile.condoId || 'default'}/visitors`;
      q = query(
        collection(db, path),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
    } else {
      path = `condos/${profile.condoId || 'default'}/visitors`;
      q = query(
        collection(db, path),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const visitorData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Visitor[];
      setVisitors(visitorData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile, user]);

  // Sync Logic Mock
  const syncWithHardware = async (visitor: any) => {
    setSyncing(true);
    console.log('--- Inician Sincronización Automática ---');
    console.log(`1. Vinculando QR [${visitor.qrCodeValue}] con dispositivos del condominio: ${profile?.condoId}`);
    
    // Mock device sync
    await new Promise(r => setTimeout(r, 1000));
    console.log('2. QR sincronizado en controladores de acceso facial/QR.');

    if (visitor.licensePlate) {
      console.log(`3. Detectada patente [${visitor.licensePlate}]. Sincronizando con cámara LPR...`);
      await new Promise(r => setTimeout(r, 800));
      console.log('4. Patente autorizada en Gateway vehicular.');
    }
    
    console.log('--- Sincronización Completada ---');
    setSyncing(false);
  };

  const handleOpenAdd = () => {
    if (!profile?.canGenerateQR && profile?.role !== 'super_admin' && profile?.role !== 'condo_admin') {
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
    });
    setShowAddModal(true);
  };

  const handleSaveVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    const condoId = profile.condoId || 'default';
    const path = `condos/${condoId}/visitors`;
    
    try {
      let visitorData;
      if (editingVisitor) {
        const docRef = doc(db, path, editingVisitor.id);
        visitorData = {
          ...newVisitor,
          updatedAt: Timestamp.now()
        };
        await updateDoc(docRef, visitorData);
        await syncWithHardware({ ...visitorData, id: editingVisitor.id, qrCodeValue: editingVisitor.qrCodeValue });
      } else {
        const qrValue = `PV-${condoId.slice(0,3)}-${user.uid.slice(0,4)}-${Date.now().toString().slice(-6)}`;
        visitorData = {
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
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-600/30">
              <ShieldCheck size={24} />
            </div>
            <h2 className="text-4xl font-black text-white tracking-tight">Visitantes Autorizados</h2>
          </div>
          <p className="text-gray-400 text-lg max-w-2xl font-medium">
            Control de acceso inteligente. Genera pases QR temporales y autoriza vehículos automáticamente.
          </p>
        </div>
        
        <button
          onClick={handleOpenAdd}
          className="group relative flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-8 rounded-2xl transition-all shadow-2xl shadow-blue-600/40 overflow-hidden active:scale-95"
        >
          <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          <Plus size={22} />
          <span className="relative">Nuevo Pase de Acceso</span>
        </button>
      </div>

      {/* Stats/Info Banner */}
      {!profile?.canGenerateQR && profile?.role === 'resident' && (
        <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-3xl p-6 flex items-start gap-4">
          <AlertCircle className="text-yellow-500 mt-1 shrink-0" size={24} />
          <div>
            <h4 className="text-yellow-500 font-bold text-lg">Activación Pendiente</h4>
            <p className="text-gray-400">Tu cuenta aún no tiene permiso para generar códigos QR. Por favor, solicita la activación en el módulo de administración o contacta al personal del condominio.</p>
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
            <p className="text-gray-500 max-w-sm mx-auto">Cuando generes tu primer código QR, aparecerá aquí para que puedas gestionarlo y descargarlo.</p>
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
              className="relative group bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-[2.5rem] p-8 hover:border-blue-500/50 hover:bg-gray-900 transition-all duration-300"
              onClick={() => setSelectedVisitor(visitor)}
            >
              <div className="absolute -top-4 -right-4 w-24 h-24 bg-blue-600/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="flex items-start justify-between mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl flex items-center justify-center text-blue-400 shadow-xl group-hover:from-blue-600 group-hover:to-blue-700 group-hover:text-white transition-all cursor-pointer">
                  <QrCode size={30} />
                </div>
                <div className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.1em] border ${
                  visitor.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                  visitor.status === 'entered' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                  'bg-gray-800/50 text-gray-500 border-gray-700'
                }`}>
                  {visitor.status === 'pending' ? 'Próximo' : visitor.status === 'entered' ? 'En Sitio' : 'Finalizado'}
                </div>
              </div>

              <div className="space-y-1 mb-6">
                <h3 className="text-2xl font-black text-white group-hover:text-blue-400 transition-colors">{visitor.visitorName}</h3>
                <div className="flex items-center gap-2 text-gray-500 font-bold text-xs uppercase tracking-wider">
                  <Building2 size={12} />
                  <span>{profile?.condoName || 'Condominio'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-white/5 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Fecha Inicio</p>
                  <p className="text-sm font-bold text-gray-200">{visitor.date}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Patente</p>
                  <p className="text-sm font-bold text-blue-400">{visitor.licensePlate || 'NO VEHÍCULO'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-white/5">
                <div className="flex items-center gap-1">
                   {(profile?.role === 'super_admin' || profile?.role === 'condo_admin' || visitor.userId === user?.uid) && (
                    <>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleOpenEdit(visitor); }}
                        className="p-2.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-xl transition-all" 
                        title="Editar"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeletingVisitor(visitor); }}
                        className="p-2.5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all" 
                        title="Eliminar"
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  )}
                </div>
                <button className="flex items-center gap-2 text-sm font-black text-white px-4 py-2 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
                  Detalles
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
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingVisitor(null); }}
              className="absolute inset-0 bg-black/95 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="relative w-full max-w-2xl bg-gray-900 border border-white/5 rounded-[3rem] p-10 shadow-[0_0_100px_rgba(0,0,0,0.5)] max-h-[90vh] overflow-y-auto no-scrollbar"
            >
              <div className="flex items-center justify-between mb-10">
                <div className="space-y-1">
                  <h3 className="text-3xl font-black text-white">
                    {editingVisitor ? 'Gestionar Pase' : 'Programar Visita'}
                  </h3>
                  <p className="text-gray-500 font-medium text-sm">Completa los datos para generar el acceso automático.</p>
                </div>
                <button onClick={() => { setShowAddModal(false); setEditingVisitor(null); }} className="w-12 h-12 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-full flex items-center justify-center transition-all">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSaveVisitor} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-2">Datos del Invitado</label>
                    <div className="relative">
                      <User className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input
                        required
                        type="text"
                        value={newVisitor.visitorName}
                        onChange={(e) => setNewVisitor({ ...newVisitor, visitorName: e.target.value })}
                        className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none transition-all placeholder:text-gray-700"
                        placeholder="Nombre completo"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-2">Acceso Vehicular (Opcional)</label>
                    <div className="relative">
                      <Car className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input
                        type="text"
                        value={newVisitor.licensePlate}
                        onChange={(e) => setNewVisitor({ ...newVisitor, licensePlate: e.target.value.toUpperCase() })}
                        className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none transition-all font-mono placeholder:text-gray-700"
                        placeholder="AAAA-00"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-[2rem] p-8 space-y-6">
                   <div className="flex items-center gap-3 mb-2 text-blue-400">
                    <Clock size={18} />
                    <span className="font-black text-xs uppercase tracking-widest">Ventana de Tiempo</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                       <p className="text-[10px] text-gray-500 font-bold uppercase pl-1">Fecha</p>
                      <input
                        required
                        type="date"
                        value={newVisitor.date}
                        onChange={(e) => setNewVisitor({ ...newVisitor, date: e.target.value })}
                        className="w-full bg-gray-950 border border-white/5 rounded-2xl py-3 px-4 text-white font-bold focus:border-blue-600 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 font-bold uppercase pl-1">Entrada</p>
                      <input
                        required
                        type="time"
                        value={newVisitor.entryTime}
                        onChange={(e) => setNewVisitor({ ...newVisitor, entryTime: e.target.value })}
                        className="w-full bg-gray-950 border border-white/5 rounded-2xl py-3 px-4 text-white font-bold focus:border-blue-600 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 font-bold uppercase pl-1">Salida</p>
                      <input
                        required
                        type="time"
                        value={newVisitor.exitTime}
                        onChange={(e) => setNewVisitor({ ...newVisitor, exitTime: e.target.value })}
                        className="w-full bg-gray-950 border border-white/5 rounded-2xl py-3 px-4 text-white font-bold focus:border-blue-600 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20">
                  <Info className="text-blue-400 shrink-0" size={20} />
                  <p className="text-xs text-gray-400 font-medium">
                    Al generar el pase, tanto el código QR como la patente se sincronizarán automáticamente con los dispositivos de acceso y cámaras LPR del condominio.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={syncing}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.5rem] transition-all shadow-2xl shadow-blue-600/30 flex items-center justify-center gap-3 text-lg disabled:opacity-50"
                >
                  {syncing ? (
                    <>
                      <div className="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                      Sincronizando Hardware...
                    </>
                  ) : (
                    <>
                      <QrCode size={24} />
                      {editingVisitor ? 'Sincronizar Cambios' : 'Generar Pase Autorizado'}
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete/Details/QR Modals would go here with same premium style */}
      {/* (Adding QR detail modal refinement) */}
      <AnimatePresence>
        {selectedVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedVisitor(null)}
              className="absolute inset-0 bg-black/95 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-[3rem] p-10 shadow-[0_0_100px_rgba(255,255,255,0.1)] text-gray-950 overflow-y-auto no-scrollbar max-h-[90vh]"
            >
              <div className="flex flex-col items-center">
                <div className="w-full flex justify-between items-center mb-10">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Pase Activo</span>
                  </div>
                  <button onClick={() => setSelectedVisitor(null)} className="text-gray-300 hover:text-gray-900 transition-colors">
                    <X size={24} />
                  </button>
                </div>
                
                <div className="relative p-8 bg-gray-50 rounded-[2.5rem] mb-10 group">
                   <div className="absolute inset-0 bg-blue-600/5 rounded-[2.5rem] group-hover:scale-105 transition-transform" />
                  <QRCodeSVG value={selectedVisitor.qrCodeValue} size={220} level="H" includeMargin={true} />
                </div>

                <div className="text-center space-y-2 mb-10">
                  <h3 className="text-3xl font-black">{selectedVisitor.visitorName}</h3>
                  <div className="bg-gray-100 px-4 py-1.5 rounded-full inline-block">
                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{profile?.condoName || 'Acceso Condominio'}</p>
                  </div>
                </div>

                <div className="w-full space-y-3 mb-10">
                   <div className="flex justify-between items-center py-3 border-b border-gray-100">
                    <span className="text-xs font-bold text-gray-400 uppercase">Validez</span>
                    <span className="text-sm font-black">{selectedVisitor.date}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-gray-100">
                    <span className="text-xs font-bold text-gray-400 uppercase">Patente Autorizada</span>
                    <span className="text-sm font-black text-blue-600">{selectedVisitor.licensePlate || 'Peatonal'}</span>
                  </div>
                </div>

                <button className="w-full bg-gray-950 hover:bg-black text-white font-black py-5 rounded-[1.5rem] transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95">
                  <Download size={20} />
                  Guardar en Wallet
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal Refined */}
      <AnimatePresence>
        {deletingVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingVisitor(null)}
              className="absolute inset-0 bg-black/90"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-white/5 rounded-[2.5rem] p-8 text-center"
            >
              <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center text-red-500 mx-auto mb-6">
                <Trash2 size={36} />
              </div>
              <h3 className="text-2xl font-black text-white mb-2">¿Anular Invitación?</h3>
              <p className="text-gray-400 font-medium mb-8">
                El código QR de <span className="text-white font-bold">{deletingVisitor.visitorName}</span> dejará de funcionar en todos los dispositivos de acceso.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setDeletingVisitor(null)}
                  className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-4 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteVisitor}
                  className="bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-red-600/20"
                >
                  Anular Pase
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Visitors;
