import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, where } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Plus, Wifi, WifiOff, Settings, Shield, Trash2, X, Activity, Server, Database, Globe, Lock, CheckCircle2, AlertCircle, Car, Key, Unlock, Smartphone, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Device {
  id: string;
  name: string;
  type: 'lpr' | 'face' | 'nvr' | 'pannel';
  status: 'online' | 'offline' | 'error';
  ipAddress: string;
  port: string;
  externalIp?: string;
  condoId: string;
  condoName: string;
  lastSync: any;
  webhookUrl: string;
  capturedEvents: {
    lpr: boolean;
    face: boolean;
    qr: boolean;
  };
}

const Devices = () => {
  const { profile, user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [condos, setCondos] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    type: 'lpr' as Device['type'],
    ipAddress: '',
    port: '80',
    externalIp: '',
    condoId: '',
    username: '',
    password: '',
    webhookUrl: `https://pv-api-bridge.porteriavirtual.cl/webhook/${Math.random().toString(36).substring(7)}`,
    capturedEvents: {
      lpr: true,
      face: true,
      qr: true
    }
  });

  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);

  useEffect(() => {
    // Fetch condos for selection
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    // Query devices based on condo isolation rules
    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collection(db, 'devices'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds) {
      q = query(collection(db, 'devices'), where('condoId', 'in', profile.condoIds));
    } else {
      q = query(collection(db, 'devices'), where('condoId', '==', profile.condoId || 'default'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDevices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Device[]);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'devices');
    });

    return () => {
      unsubscribe();
      condosUnsubscribe();
    };
  }, [profile, user]);

  const handleOpenAdd = () => {
    setEditingDevice(null);
    setFormData({
      name: '',
      type: 'lpr',
      ipAddress: '',
      port: '80',
      externalIp: '',
      condoId: profile?.condoId || '',
      username: '',
      password: '',
      webhookUrl: `https://pv-api-bridge.porteriavirtual.cl/webhook/${Math.random().toString(36).substring(7)}`,
      capturedEvents: { lpr: true, face: true, qr: true }
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (device: Device) => {
    setEditingDevice(device);
    setFormData({
      name: device.name,
      type: device.type,
      ipAddress: device.ipAddress,
      port: device.port,
      externalIp: device.externalIp || '',
      condoId: device.condoId,
      username: (device as any).username || '',
      password: (device as any).password || '',
      webhookUrl: device.webhookUrl,
      capturedEvents: device.capturedEvents
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.condoId) {
      alert("⚠️ Error: Debes seleccionar un condominio para este dispositivo.");
      return;
    }

    setSaving(true);
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    
    try {
      const dataToSave = {
        ...formData,
        condoName: selectedCondo?.name || 'Condominio',
        status: 'online' as Device['status'],
        lastSync: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      if (editingDevice) {
        await updateDoc(doc(db, 'devices', editingDevice.id), dataToSave);
      } else {
        await addDoc(collection(db, 'devices'), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });
      }
      setShowAddModal(false);
      alert("✅ Dispositivo guardado correctamente.");
    } catch (error: any) {
      console.error("Firestore Save Error:", error);
      alert(`❌ Error al guardar: ${error.message || 'Sin permisos'}`);
      handleFirestoreError(error, editingDevice ? OperationType.UPDATE : OperationType.CREATE, 'devices');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingDevice) return;
    try {
      await deleteDoc(doc(db, 'devices', deletingDevice.id));
      setDeletingDevice(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'devices');
    }
  };

  const toggleStatus = async (device: Device) => {
    const newStatus = device.status === 'online' ? 'offline' : 'online';
    try {
      await updateDoc(doc(db, 'devices', device.id), { status: newStatus });
    } catch (error) {
       console.error(error);
    }
  };

  const [commandInProgress, setCommandInProgress] = useState<string | null>(null);

  const sendRemoteCommand = async (device: Device, command: 'AccessControl.Open' | 'LPR.Open' | 'Snapshot') => {
    setCommandInProgress(device.id + '_' + command);
    try {
      await addDoc(collection(db, 'hardware_commands'), {
        deviceId: device.id,
        deviceName: device.name,
        ip: device.ipAddress,
        port: device.port,
        cmd: command, // Dahua RPC Compatible or internal Snapshot CMD
        params: { channel: 1, quality: 'high' },
        condoId: device.condoId,
        status: 'pending',
        timestamp: Date.now(),
        createdAt: Timestamp.now()
      });
      
      const msg = command === 'Snapshot' 
        ? "📸 Solicitud de captura enviada. La imagen aparecerá en breve."
        : `🚀 Comando ${command === 'AccessControl.Open' ? 'Apertura de Puerta' : 'Apertura de Barrera'} enviado con éxito.`;
      
      alert(msg);
    } catch (error: any) {
      console.error("Hardware Command Error:", error);
      alert(`❌ Error al enviar comando: ${error.message}`);
    } finally {
      setCommandInProgress(null);
    }
  };

  if (loading && !devices.length) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
     <div className="space-y-10">
      {/* Device Health Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-500"><Wifi size={24} /></div>
          <div><p className="text-base font-black text-gray-500 uppercase tracking-widest">En Línea</p><p className="text-3xl font-black text-white">{devices.filter(d => d.status === 'online').length}</p></div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500"><WifiOff size={24} /></div>
          <div><p className="text-base font-black text-gray-500 uppercase tracking-widest">Desconectados</p><p className="text-3xl font-black text-white">{devices.filter(d => d.status === 'offline').length}</p></div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500"><Activity size={24} /></div>
          <div><p className="text-base font-black text-gray-500 uppercase tracking-widest">Eventos/Hoy</p><p className="text-3xl font-black text-white">1,248</p></div>
        </div>
        <button onClick={handleOpenAdd} className="bg-blue-600 hover:bg-blue-500 rounded-3xl p-6 flex items-center justify-center gap-4 transition-all group">
          <Plus size={28} className="text-white group-hover:scale-110 transition-transform" />
          <span className="text-white font-black uppercase tracking-widest text-base">Añadir Hardware</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {devices.map((device) => (
           <motion.div layout key={device.id} className="bg-gray-900 border border-gray-800 rounded-[2.5rem] p-8 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8">
                <button onClick={() => toggleStatus(device)} className={`p-3 rounded-2xl transition-all ${device.status === 'online' ? 'bg-green-500/10 text-green-500' : 'bg-gray-800 text-gray-500'}`} title="Cambiar Estado Manual">
                  {device.status === 'online' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
                </button>
              </div>
              
              <div className="flex items-start gap-6 mb-8">
                 <div className="w-20 h-20 bg-gray-950 rounded-3xl border border-gray-800 flex items-center justify-center text-blue-500 shadow-2xl">
                    {device.type === 'lpr' ? <Car size={40} /> : device.type === 'face' ? <Shield size={40} /> : <Server size={40} />}
                 </div>
                 <div className="space-y-1">
                    <h3 className="text-xl font-black text-white italic">{device.name}</h3>
                    <p className="text-blue-500 font-bold text-base uppercase tracking-[0.2em]">{device.condoName}</p>
                    <div className="flex items-center gap-2 mt-2">
                       <Globe size={12} className="text-gray-600" />
                       <span className="text-base font-mono text-gray-500">{device.ipAddress}:{device.port}</span>
                    </div>
                 </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-8">
                 <div className="bg-gray-950/50 p-4 rounded-2xl border border-gray-800/50">
                    <p className="text-[11px] font-black text-gray-600 uppercase mb-2">LPR Tracking</p>
                    <div className={`w-3 h-3 rounded-full ${device.capturedEvents.lpr ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-gray-800'}`} />
                 </div>
                 <div className="bg-gray-950/50 p-4 rounded-2xl border border-gray-800/50">
                    <p className="text-[11px] font-black text-gray-600 uppercase mb-2">Face Recon</p>
                    <div className={`w-3 h-3 rounded-full ${device.capturedEvents.face ? 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'bg-gray-800'}`} />
                 </div>
                 <div className="bg-gray-950/50 p-4 rounded-2xl border border-gray-800/50">
                    <p className="text-[11px] font-black text-gray-600 uppercase mb-2">QR Gates</p>
                    <div className={`w-3 h-3 rounded-full ${device.capturedEvents.qr ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-800'}`} />
                 </div>
              </div>

              <div className="flex items-center justify-between pt-8 border-t border-gray-800">
                <div className="flex items-center gap-4">
                    {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                      <button 
                        disabled={commandInProgress === device.id + '_Snapshot'}
                        onClick={() => sendRemoteCommand(device, 'Snapshot')}
                        className={`p-3 bg-gray-800 hover:bg-gray-700 text-blue-400 rounded-xl transition-all border border-gray-700 shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center`}
                        title="Capturar Foto"
                      >
                        {commandInProgress === device.id + '_Snapshot' ? <Activity size={20} className="animate-spin" /> : <Camera size={20} />}
                      </button>
                    )}
                    {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && device.type === 'face' && (
                      <button 
                        disabled={commandInProgress === device.id + '_AccessControl.Open'}
                        onClick={() => sendRemoteCommand(device, 'AccessControl.Open')}
                        className={`flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl transition-all font-black uppercase text-[11px] tracking-widest shadow-lg shadow-blue-600/20 active:scale-95 disabled:opacity-50`}
                      >
                        {commandInProgress === device.id + '_AccessControl.Open' ? <Activity size={16} className="animate-spin" /> : <Unlock size={16} />}
                        Abrir Puerta
                      </button>
                    )}
                    {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && device.type === 'lpr' && (
                      <button 
                        disabled={commandInProgress === device.id + '_LPR.Open'}
                        onClick={() => sendRemoteCommand(device, 'LPR.Open')}
                        className={`flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl transition-all font-black uppercase text-[11px] tracking-widest shadow-lg shadow-indigo-600/20 active:scale-95 disabled:opacity-50`}
                      >
                        {commandInProgress === device.id + '_LPR.Open' ? <Activity size={16} className="animate-spin" /> : <Smartphone size={16} />}
                        Abrir Barrera
                      </button>
                    )}
                    {(device.type !== 'face' && device.type !== 'lpr' || (profile?.role !== 'super_admin' && profile?.role !== 'condo_admin')) && (
                      <div className="flex items-center gap-2">
                         <Database size={14} className="text-gray-600" />
                         <span className="text-base font-black text-gray-500 uppercase tracking-widest">Bridge OK</span>
                      </div>
                    )}
                </div>
                <div className="flex gap-2">
                   <button onClick={() => handleOpenEdit(device)} className="p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-all"><Settings size={20} /></button>
                   <button onClick={() => setDeletingDevice(device)} className="p-3 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white rounded-xl transition-all"><Trash2 size={20} /></button>
                </div>
              </div>
           </motion.div>
        ))}
      </div>

      {/* Real-time Event Monitor */}
      <div className="mt-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <Wifi className="text-green-500 animate-pulse" size={24} />
              Monitor de Eventos en Tiempo Real
            </h3>
            <p className="text-gray-400 text-sm mt-1">Detecciones proactivas de patentes y rostros.</p>
          </div>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-[2rem] overflow-hidden backdrop-blur-sm">
          <div className="overflow-x-auto text-center py-20 text-gray-500 italic">
            Esperando detecciones... el flujo está activo.
          </div>
        </div>
      </div>

      {/* Modal - The Original complex form */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
             <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-[3rem] p-10 overflow-y-auto max-h-[90vh] no-scrollbar shadow-[0_0_100px_rgba(59,130,246,0.1)]">
                <div className="flex justify-between items-center mb-10">
                   <div>
                      <h3 className="text-xl font-black text-white italic">{editingDevice ? 'Configurar Hardware' : 'Integrar Nuevo Dispositivo'}</h3>
                      <p className="text-gray-500 text-base mt-1">Sincroniza cámaras LPR, paneles faciales y barreras.</p>
                   </div>
                   <button onClick={() => setShowAddModal(false)} className="w-12 h-12 bg-gray-800 hover:bg-gray-700 text-white rounded-2xl flex items-center justify-center transition-all"><X size={24} /></button>
                </div>

                <form onSubmit={handleSave} className="space-y-8">
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest pl-1">Identificador Dispositivo</label>
                        <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold focus:border-blue-600 outline-none" placeholder="Ej: Cámara Acceso Norte" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-base font-black text-gray-500 uppercase tracking-widest pl-1">Firma de Hardware</label>
                        <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value as Device['type']})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold">
                           <option value="lpr">Dahua LPR (Patentes)</option>
                           <option value="face">Dahua ASI (Facial/QR)</option>
                           <option value="nvr">NVR Server</option>
                        </select>
                      </div>
                   </div>

                   {profile?.role === 'super_admin' && (
                     <div className="space-y-2">
                        <label className="text-base font-black text-gray-400 uppercase tracking-widest pl-1">Asignar a Condominio</label>
                        <select required value={formData.condoId} onChange={(e) => setFormData({...formData, condoId: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-black italic">
                           <option value="">Seleccione recinto...</option>
                           {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                     </div>
                   )}

                   <div className="bg-gray-950/50 p-8 rounded-3xl border border-gray-800 space-y-6">
                      <div className="flex items-center gap-3 mb-2 text-blue-500"><Server size={20} /><span className="font-black text-base uppercase tracking-widest">Network Configuration</span></div>
                      <div className="grid grid-cols-3 gap-6">
                         <div className="col-span-2 space-y-1">
                            <p className="text-[11px] font-black text-gray-600 uppercase italic">Dirección IP (LAN)</p>
                            <input required type="text" value={formData.ipAddress} onChange={(e) => setFormData({...formData, ipAddress: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl py-3 px-4 text-white font-mono text-base focus:border-blue-600 outline-none" placeholder="192.168.1.108" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-[11px] font-black text-gray-600 uppercase italic">Puerto</p>
                            <input required type="text" value={formData.port} onChange={(e) => setFormData({...formData, port: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl py-3 px-4 text-white font-mono text-base focus:border-blue-600 outline-none" placeholder="80" />
                         </div>
                      </div>
                      <div className="space-y-1">
                         <p className="text-[11px] font-black text-gray-600 uppercase italic">DDNS / IP Pública (Acceso Remoto)</p>
                         <input type="text" value={formData.externalIp} onChange={(e) => setFormData({...formData, externalIp: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl py-3 px-4 text-white font-mono text-base focus:border-blue-600 outline-none" placeholder="porteria.ddns.net" />
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-base font-black text-gray-400 uppercase tracking-widest pl-1">Usuario Hardware</label>
                        <input required type="text" value={formData.username} onChange={(e) => setFormData({...formData, username: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold outline-none focus:border-blue-600" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-base font-black text-gray-400 uppercase tracking-widest pl-1">Password</label>
                        <div className="relative">
                           <input required type={showPassword ? 'text' : 'password'} value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold outline-none focus:border-blue-600 pr-12" />
                           <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white"><Lock size={20} /></button>
                        </div>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <p className="text-base font-black text-blue-500 uppercase tracking-[0.2em] mb-4">Sensores e Inteligencia Artificial</p>
                      <div className="flex flex-wrap gap-6">
                        <label className="flex items-center gap-3 cursor-pointer group">
                           <input type="checkbox" checked={formData.capturedEvents.lpr} onChange={(e) => setFormData({...formData, capturedEvents: {...formData.capturedEvents, lpr: e.target.checked}})} className="w-5 h-5 bg-gray-950 border-gray-800 rounded text-blue-600" />
                           <span className="text-base font-bold text-gray-400 group-hover:text-white transition-colors">Lectura de Patentes</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer group">
                           <input type="checkbox" checked={formData.capturedEvents.face} onChange={(e) => setFormData({...formData, capturedEvents: {...formData.capturedEvents, face: e.target.checked}})} className="w-5 h-5 bg-gray-950 border-gray-800 rounded text-blue-600" />
                           <span className="text-base font-bold text-gray-400 group-hover:text-white transition-colors">Acceso Facial</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer group">
                           <input type="checkbox" checked={formData.capturedEvents.qr} onChange={(e) => setFormData({...formData, capturedEvents: {...formData.capturedEvents, qr: e.target.checked}})} className="w-5 h-5 bg-gray-950 border-gray-800 rounded text-blue-600" />
                           <span className="text-base font-bold text-gray-400 group-hover:text-white transition-colors">Lectura de Pases QR</span>
                        </label>
                      </div>
                   </div>

                   <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-3xl transition-all shadow-2xl shadow-blue-600/30 text-lg flex items-center justify-center gap-3">
                      {saving ? <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : (editingDevice ? 'Actualizar Sincronización' : 'Activar Dispositivo en la Red')}
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deletingDevice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingDevice(null)} className="absolute inset-0 bg-black/90" />
             <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 text-center shadow-2xl">
                <Trash2 className="text-red-500 mx-auto mb-6" size={56} />
                <h3 className="text-xl font-black text-white italic mb-2">¿Eliminar Hardware?</h3>
                <p className="text-gray-500 text-base font-medium mb-10">La desconexión de <span className="text-white font-bold">{deletingDevice.name}</span> interrumpirá el flujo de eventos LPR/Facial.</p>
                <div className="flex gap-4">
                   <button onClick={() => setDeletingDevice(null)} className="flex-1 bg-gray-800 text-white py-4 rounded-2xl font-black transition-all">Cancelar</button>
                   <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-red-600/20">Anular</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Devices;
