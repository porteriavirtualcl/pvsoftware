import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, Timestamp,
  orderBy, doc, updateDoc, deleteDoc, collectionGroup, getDoc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  QrCode, Plus, Clock, User, Car, Download, X, AlertCircle,
  Edit2, Trash2, ShieldCheck, Share2, Building2, Wifi, WifiOff,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';
import DahuaService from '../services/DahuaService';

// ─── types ────────────────────────────────────────────────────────────────────

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
  dahuaVisitorId?: string;
  dahuaQrCode?: string;
}

interface CondoOption {
  id: string;
  name: string;
  dahuaChannelIds?: string[];
}

function toUnixSeconds(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
}

// ─── component ────────────────────────────────────────────────────────────────

const Visitors = () => {
  const { profile, user } = useAuth();
  const [visitors, setVisitors]           = useState<Visitor[]>([]);
  const [loading, setLoading]             = useState(true);
  const [showAddModal, setShowAddModal]   = useState(false);
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [editingVisitor, setEditingVisitor]   = useState<Visitor | null>(null);
  const [deletingVisitor, setDeletingVisitor] = useState<Visitor | null>(null);
  const [condos, setCondos]               = useState<CondoOption[]>([]);
  const [newVisitor, setNewVisitor]       = useState({
    visitorName: '', date: format(new Date(), 'yyyy-MM-dd'),
    entryTime: '12:00', exitTime: '18:00', licensePlate: '', condoId: '',
  });

  // Dahua
  const [dahuaStatus, setDahuaStatus]       = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [dahuaChannelIds, setDahuaChannelIds] = useState<string[]>([]);

  // ── data ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), (snap) => {
      setCondos(snap.docs.map(d => ({
        id: d.id,
        name: d.data().name,
        dahuaChannelIds: d.data().dahuaChannelIds ?? [],
      })));
    });

    if (!profile || !user) return () => condosUnsub();

    let q;
    const path = 'visitors';

    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'visitors'), orderBy('createdAt', 'desc'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds?.length > 0) {
      q = query(collectionGroup(db, 'visitors'), where('condoId', 'in', profile.condoIds), orderBy('createdAt', 'desc'));
    } else {
      const colPath = `condos/${profile.condoId || 'default'}/visitors`;
      q = (profile.role === 'resident' || profile.role === 'usuario')
        ? query(collection(db, colPath), where('userId', '==', user.uid), orderBy('createdAt', 'desc'))
        : query(collection(db, colPath), orderBy('createdAt', 'desc'));
    }

    const unsub = onSnapshot(q, (snap) => {
      setVisitors(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Visitor[]);
      setLoading(false);
    }, (err) => { setLoading(false); handleFirestoreError(err, OperationType.LIST, path); });

    return () => { condosUnsub(); unsub(); };
  }, [profile, user]);

  // Load Dahua channels when condoId changes in the form
  useEffect(() => {
    if (!newVisitor.condoId) { setDahuaChannelIds([]); return; }
    const found = condos.find(c => c.id === newVisitor.condoId);
    if (found) { setDahuaChannelIds(found.dahuaChannelIds ?? []); return; }
    getDoc(doc(db, 'condos', newVisitor.condoId))
      .then(snap => setDahuaChannelIds(snap.data()?.dahuaChannelIds ?? []))
      .catch(() => setDahuaChannelIds([]));
  }, [newVisitor.condoId, condos]);

  // ── handlers ────────────────────────────────────────────────────────────────

  const handleOpenAdd = () => {
    if (profile?.role === 'resident' && !profile?.canGenerateQR) {
      alert('Tu cuenta no tiene habilitada la generación de QR. Por favor solicita activación a la administración.');
      return;
    }
    setEditingVisitor(null);
    setDahuaStatus('idle');
    setNewVisitor({
      visitorName: '', date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: format(new Date(), 'HH:mm'),
      exitTime: format(new Date(Date.now() + 6 * 3600000), 'HH:mm'),
      licensePlate: '', condoId: profile?.condoId || '',
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (visitor: Visitor) => {
    setEditingVisitor(visitor);
    setDahuaStatus('idle');
    setNewVisitor({
      visitorName: visitor.visitorName, date: visitor.date,
      entryTime: visitor.entryTime, exitTime: visitor.exitTime,
      licensePlate: visitor.licensePlate || '', condoId: visitor.condoId,
    });
    setShowAddModal(true);
  };

  const handleSaveVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    const condoId = profile.role === 'super_admin' ? newVisitor.condoId : profile.condoId;
    if (!condoId) { alert('Por favor selecciona un condominio.'); return; }

    const path = `condos/${condoId}/visitors`;

    try {
      if (editingVisitor) {
        await updateDoc(doc(db, path, editingVisitor.id), { ...newVisitor, updatedAt: Timestamp.now() });

      } else {
        const hexSeed = (Date.now() ^ parseInt(user.uid.replace(/\D/g, '').slice(0, 8) || '0', 10)) >>> 0;
        const qrValue = hexSeed.toString(16).toUpperCase().padStart(8, '0');

        const docRef = await addDoc(collection(db, path), {
          ...newVisitor, userId: user.uid, condoId,
          qrCodeValue: qrValue, status: 'pending',
          createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
        const savedId = docRef.id; // always use PK — never match by name/plate

        // ── Dahua sync (non-blocking) ──────────────────────────────────────
        if (dahuaChannelIds.length > 0) {
          setDahuaStatus('syncing');
          try {
            const result = await DahuaService.createVisitor({
              visitorName: newVisitor.visitorName,
              plate: newVisitor.licensePlate || undefined,
              startTs: toUnixSeconds(newVisitor.date, newVisitor.entryTime),
              endTs:   toUnixSeconds(newVisitor.date, newVisitor.exitTime),
              acsChannelIds: dahuaChannelIds,
            });
            await updateDoc(doc(db, path, savedId), {
              dahuaVisitorId: result.visitorId ?? null,
              dahuaQrCode:    result.qrcode    ?? null,
            });
            setDahuaStatus('ok');
          } catch (dahuaErr) {
            console.warn('[Dahua] sync failed — visitor saved in DB:', dahuaErr);
            setDahuaStatus('error');
            await new Promise(r => setTimeout(r, 1800)); // brief pause so user sees the warning
          }
        }
      }

      setShowAddModal(false); setEditingVisitor(null); setDahuaStatus('idle');
    } catch (err) {
      handleFirestoreError(err, editingVisitor ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDeleteVisitor = async () => {
    if (!profile || !deletingVisitor) return;
    const path = `condos/${deletingVisitor.condoId || profile.condoId || 'default'}/visitors`;
    try {
      await deleteDoc(doc(db, path, deletingVisitor.id));
      setDeletingVisitor(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading && !visitors.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 sm:space-y-10">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
        <div className="space-y-0.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20"><ShieldCheck size={20} /></div>
            <h2 className="text-xl font-black text-white tracking-tight uppercase italic">Visitantes</h2>
          </div>
          <p className="text-gray-500 text-xs font-medium italic">Gestión de accesos inteligentes y pases autorizados.</p>
        </div>
        <button onClick={handleOpenAdd}
          className="group relative flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-xl shadow-blue-600/20 overflow-hidden active:scale-95 text-sm uppercase tracking-widest">
          <Plus size={18} /><span>Generar Pase</span>
        </button>
      </div>

      {/* QR disabled warning */}
      {!profile?.canGenerateQR && profile?.role === 'resident' && (
        <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-3xl p-6 flex items-start gap-4">
          <AlertCircle className="text-yellow-500 mt-1 shrink-0" size={24} />
          <div>
            <h4 className="text-yellow-500 font-bold text-lg">Activación Pendiente</h4>
            <p className="text-gray-400">Tu cuenta aún no tiene permiso para generar códigos QR. Por favor contacta a administración.</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {visitors.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-6">
          <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center text-gray-700"><QrCode size={48} /></div>
          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-white">No tienes visitas programadas</h3>
            <p className="text-gray-500 max-w-sm mx-auto">Cuando generes tu primer código QR, aparecerá aquí.</p>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <AnimatePresence>
          {visitors.map((visitor, i) => (
            <motion.div layout key={visitor.id}
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
              className="relative group bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-blue-500/50 transition-all duration-300 shadow-lg"
              onClick={() => setSelectedVisitor(visitor)}>
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="flex items-start justify-between mb-6">
                <div className="w-12 h-12 bg-gray-950 rounded-xl border border-gray-800 flex items-center justify-center text-blue-500 shadow-inner group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white transition-all cursor-pointer">
                  <QrCode size={24} />
                </div>
                <div className="flex items-center gap-2">
                  {visitor.dahuaVisitorId
                    ? <span title="Sincronizado con Dahua DSS"><Wifi size={13} className="text-green-500" /></span>
                    : <span title="Sin sincronización DSS"><WifiOff size={13} className="text-gray-600" /></span>}
                  <div className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.1em] border ${
                    visitor.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                    visitor.status === 'entered' ? 'bg-green-500/10  text-green-500  border-green-500/20' :
                                                   'bg-gray-800/50   text-gray-500   border-gray-700'}`}>
                    {visitor.status === 'pending' ? 'Próximo' : visitor.status === 'entered' ? 'En Sitio' : 'Finalizado'}
                  </div>
                </div>
              </div>

              <div className="space-y-0.5 mb-6">
                <h3 className="text-lg font-black text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight italic">{visitor.visitorName}</h3>
                <div className="flex items-center gap-2 text-gray-500 font-bold text-[10px] uppercase tracking-widest">
                  <Building2 size={12} /><span>{profile?.condoName || 'Condominio'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-white/5 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Fecha Validez</p>
                  <p className="text-sm font-bold text-gray-200">{visitor.date}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Patente LPR</p>
                  <p className="text-sm font-bold text-blue-400">{visitor.licensePlate || 'PEATONAL'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-white/5">
                <div className="flex items-center gap-1">
                  {(profile?.role === 'super_admin' || visitor.userId === user?.uid) && (
                    <>
                      <button onClick={e => { e.stopPropagation(); handleOpenEdit(visitor); }} className="p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"><Edit2 size={18} /></button>
                      <button onClick={e => { e.stopPropagation(); setDeletingVisitor(visitor); }} className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"><Trash2 size={18} /></button>
                    </>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); setSelectedVisitor(visitor); }}
                  className="flex items-center gap-2 text-[10px] font-black text-white px-4 py-2 bg-white/5 rounded-xl hover:bg-white/10 transition-all uppercase tracking-widest">
                  Ver QR <Share2 size={14} className="text-blue-500" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (dahuaStatus !== 'syncing') setShowAddModal(false); }}
              className="absolute inset-0 bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
              className="relative w-full max-w-2xl bg-gray-900 border border-white/5 rounded-2xl sm:rounded-[3rem] p-5 sm:p-10 shadow-[0_0_100px_rgba(0,0,0,0.5)] max-h-[90vh] overflow-y-auto no-scrollbar">

              <div className="flex items-center justify-between mb-6 sm:mb-10">
                <div className="space-y-1">
                  <h3 className="text-xl sm:text-3xl font-black text-white italic uppercase tracking-tight">{editingVisitor ? 'Gestionar Pase' : 'Programar Visita'}</h3>
                  <p className="text-gray-500 font-medium text-xs sm:text-sm">Completa los datos para generar el acceso automático.</p>
                </div>
                <button onClick={() => { if (dahuaStatus !== 'syncing') setShowAddModal(false); }}
                  className="w-10 h-10 sm:w-12 sm:h-12 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-full flex items-center justify-center transition-all shrink-0">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveVisitor} className="space-y-5 sm:space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">

                  {/* Condo selector — super_admin only */}
                  {(profile?.role === 'super_admin' || profile?.condoScope === 'all') && (
                    <div className="col-span-1 md:col-span-2 space-y-3">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Condominio Destino</label>
                      <div className="relative">
                        <Building2 className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                        <select required value={newVisitor.condoId} onChange={e => setNewVisitor({ ...newVisitor, condoId: e.target.value })}
                          className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none appearance-none">
                          <option value="">Seleccionar...</option>
                          {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      {newVisitor.condoId && (
                        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold w-fit ${
                          dahuaChannelIds.length > 0 ? 'bg-green-900/30 text-green-400 border border-green-800/50' : 'bg-yellow-900/30 text-yellow-400 border border-yellow-800/50'}`}>
                          {dahuaChannelIds.length > 0
                            ? <><Wifi size={12} /> {dahuaChannelIds.length} canal{dahuaChannelIds.length !== 1 ? 'es' : ''} ACS configurado{dahuaChannelIds.length !== 1 ? 's' : ''}</>
                            : <><WifiOff size={12} /> Sin canales ACS — el pase no se sincronizará con el DSS</>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Visitor name */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nombre Invitado</label>
                    <div className="relative">
                      <User className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input required type="text" value={newVisitor.visitorName} onChange={e => setNewVisitor({ ...newVisitor, visitorName: e.target.value })}
                        className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none"
                        placeholder="Nombre completo" />
                    </div>
                  </div>

                  {/* Plate */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Patente Vehicular (Opcional)</label>
                    <div className="relative">
                      <Car className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input type="text" value={newVisitor.licensePlate} onChange={e => setNewVisitor({ ...newVisitor, licensePlate: e.target.value.toUpperCase() })}
                        className="w-full bg-gray-950 border-2 border-white/5 rounded-[1.5rem] py-4 pl-14 pr-6 text-white text-lg font-bold focus:border-blue-600 outline-none font-mono"
                        placeholder="AAAA-00" />
                    </div>
                  </div>
                </div>

                {/* Time window */}
                <div className="bg-white/5 rounded-2xl sm:rounded-[2.5rem] p-5 sm:p-8 space-y-4 sm:space-y-6">
                  <div className="flex items-center gap-3 mb-2 text-blue-400"><Clock size={18} /><span className="font-black text-[10px] uppercase tracking-widest">Ventana de Validez</span></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                    {[
                      { label: 'Fecha', type: 'date', field: 'date' as const },
                      { label: 'Entrada', type: 'time', field: 'entryTime' as const },
                      { label: 'Salida',  type: 'time', field: 'exitTime'  as const },
                    ].map(({ label, type, field }) => (
                      <div key={field} className="space-y-2">
                        <p className="text-[9px] text-gray-500 font-bold uppercase pl-1">{label}</p>
                        <input required type={type} value={newVisitor[field]}
                          onChange={e => setNewVisitor({ ...newVisitor, [field]: e.target.value })}
                          className="w-full bg-gray-950 border border-white/5 rounded-xl py-3 px-4 text-white font-bold" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dahua sync status */}
                <AnimatePresence>
                  {dahuaStatus !== 'idle' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className={`flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold border ${
                        dahuaStatus === 'syncing' ? 'bg-blue-900/30   border-blue-800/50   text-blue-300'   :
                        dahuaStatus === 'ok'      ? 'bg-green-900/30  border-green-800/50  text-green-300'  :
                                                    'bg-yellow-900/30 border-yellow-800/50 text-yellow-300'}`}>
                      {dahuaStatus === 'syncing' && <><div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />Registrando en Dahua DSS…</>}
                      {dahuaStatus === 'ok'      && <><Wifi    size={16} className="shrink-0" />Sincronizado con DSS — el lector físico ya acepta el QR.</>}
                      {dahuaStatus === 'error'   && <><WifiOff size={16} className="shrink-0" />Pase guardado, pero no se pudo sincronizar con el DSS.</>}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button type="submit" disabled={dahuaStatus === 'syncing'}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-wait text-white font-black py-4 sm:py-5 rounded-[1.5rem] transition-all shadow-2xl shadow-blue-600/30 flex items-center justify-center gap-3 text-base sm:text-xl">
                  <QrCode size={24} />
                  {dahuaStatus === 'syncing' ? 'Procesando…' : editingVisitor ? 'Actualizar Pase' : 'Generar Pase Autorizado'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── QR Detail Modal ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedVisitor(null)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-2xl sm:rounded-[3rem] p-5 sm:p-10 text-gray-950">
              <div className="flex flex-col items-center">
                <div className="w-full flex justify-between items-center mb-5 sm:mb-8">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Pase Digital Activo</span>
                  <button onClick={() => setSelectedVisitor(null)} className="text-gray-300 hover:text-gray-950 transition-colors"><X size={24} /></button>
                </div>

                <div className="p-5 sm:p-8 bg-gray-50 rounded-2xl sm:rounded-[2.5rem] mb-4">
                  <QRCodeSVG value={selectedVisitor.dahuaQrCode || selectedVisitor.qrCodeValue} size={180} includeMargin />
                </div>

                <div className={`mb-6 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${selectedVisitor.dahuaQrCode ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {selectedVisitor.dahuaQrCode ? <><Wifi size={10} /> QR Dahua DSS</> : <><WifiOff size={10} /> QR local</>}
                </div>

                <div className="text-center space-y-2 mb-5 sm:mb-8">
                  <h3 className="text-xl sm:text-3xl font-black uppercase tracking-tight">{selectedVisitor.visitorName}</h3>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Acceso {profile?.condoName || 'Condominio'}</p>
                </div>

                <div className="w-full space-y-3 mb-5 sm:mb-8">
                  <div className="flex justify-between py-3 border-b border-gray-100"><span className="text-xs font-bold text-gray-400 uppercase">Validez</span><span className="text-sm font-black">{selectedVisitor.date}</span></div>
                  <div className="flex justify-between py-3 border-b border-gray-100"><span className="text-xs font-bold text-gray-400 uppercase">Patente LPR</span><span className="text-sm font-black text-blue-600">{selectedVisitor.licensePlate || 'Peatonal'}</span></div>
                  {selectedVisitor.dahuaVisitorId && (
                    <div className="flex justify-between py-3 border-b border-gray-100"><span className="text-xs font-bold text-gray-400 uppercase">ID Dahua</span><span className="text-xs font-black text-green-600">{selectedVisitor.dahuaVisitorId}</span></div>
                  )}
                </div>

                <button className="w-full bg-gray-950 text-white font-black py-5 rounded-[1.5rem] flex items-center justify-center gap-3">
                  <Download size={20} /> Guardar Pase
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm Modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {deletingVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingVisitor(null)} className="absolute inset-0 bg-black/90" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-white/5 rounded-2xl sm:rounded-[2.5rem] p-6 sm:p-10 text-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-red-500/10 rounded-3xl flex items-center justify-center text-red-500 mx-auto mb-5"><Trash2 size={30} /></div>
              <h3 className="text-xl sm:text-2xl font-black text-white italic mb-2">¿Anular Invitación?</h3>
              <p className="text-gray-500 text-sm font-medium mb-6 sm:mb-10">El código QR de <span className="text-white font-bold">{deletingVisitor.visitorName}</span> será desactivado.</p>
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
