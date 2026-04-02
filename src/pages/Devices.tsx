import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Plus, Camera, ScanFace, Wifi, MoreVertical, CheckCircle2, AlertCircle, Edit2, Trash2, X, Globe, Lock, User, Server, Building2 } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp, collectionGroup, where } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface Condo {
  id: string;
  name: string;
}

interface Device {
  id: string;
  name: string;
  deviceType: 'LPR' | 'Face_Access' | 'Controller' | 'Other';
  model: string;
  status: 'online' | 'offline' | 'error';
  ipAddress: string;
  port: string;
  username: string;
  password?: string;
  condoId: string;
  condoName?: string;
  lastSync?: any;
}

const Devices = () => {
  const { profile } = useAuth();
  const [condos, setCondos] = useState<Condo[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    deviceType: 'LPR' as Device['deviceType'],
    model: '',
    status: 'offline' as Device['status'],
    ipAddress: '',
    port: '80',
    username: 'admin',
    password: '',
    condoId: ''
  });

  useEffect(() => {
    // Fetch condos for selection
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })) as Condo[]);
    });

    if (!profile?.role) return () => condosUnsubscribe();

    let q;
    let path = 'devices';

    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'devices'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds && profile.condoIds.length > 0) {
      q = query(collectionGroup(db, 'devices'), where('condoId', 'in', profile.condoIds));
    } else if (profile.condoId) {
      path = `condos/${profile.condoId}/devices`;
      q = query(collection(db, path));
    } else {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Device[];
      setDevices(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => {
      condosUnsubscribe();
      unsubscribe();
    };
  }, [profile?.condoId]);

  const handleOpenAdd = () => {
    setFormData({
      name: '',
      deviceType: 'LPR',
      model: 'Dahua ITC413-PW4D',
      status: 'offline',
      ipAddress: '',
      port: '80',
      username: 'admin',
      password: '',
      condoId: profile?.condoId || ''
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (item: Device) => {
    setEditingDevice(item);
    setFormData({
      name: item.name,
      deviceType: item.deviceType,
      model: item.model,
      status: item.status,
      ipAddress: item.ipAddress,
      port: item.port,
      username: item.username,
      password: item.password || '',
      condoId: item.condoId
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.condoId) return;

    setSaving(true);
    const path = `condos/${formData.condoId}/devices`;
    const selectedCondo = condos.find(c => c.id === formData.condoId);

    try {
      const saveData = {
        ...formData,
        condoName: selectedCondo?.name || 'Condominio',
        updatedAt: Timestamp.now()
      };

      if (editingDevice) {
        const docRef = doc(db, path, editingDevice.id);
        await updateDoc(docRef, saveData);
      } else {
        await addDoc(collection(db, path), {
          ...saveData,
          createdAt: Timestamp.now()
        });
      }
      alert(editingDevice ? 'Dispositivo actualizado' : 'Dispositivo configurado');
      setShowAddModal(false);
      setEditingDevice(null);
    } catch (error: any) {
      handleFirestoreError(error, editingDevice ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingDevice) return;
    const path = `condos/${deletingDevice.condoId}/devices`;
    try {
      await deleteDoc(doc(db, path, deletingDevice.id));
      setDeletingDevice(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <Cpu className="text-blue-500" size={32} />
            Dispositivos e Integraciones
          </h2>
          <p className="text-gray-400 mt-1">Configuración técnica y conectividad de cámaras LPR y controles faciales.</p>
        </div>
        {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Configurar Dispositivo
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {devices.map((device, i) => (
            <motion.div
              key={device.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="bg-gray-900 border border-gray-800 rounded-3xl p-6 group hover:border-gray-700 transition-all"
            >
              <div className="flex items-start justify-between mb-6">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                  device.deviceType === 'LPR' ? 'bg-purple-900/20 text-purple-400' :
                  device.deviceType === 'Face_Access' ? 'bg-blue-900/20 text-blue-400' :
                  'bg-gray-800 text-gray-400'
                }`}>
                  {device.deviceType === 'LPR' ? <Camera size={28} /> : 
                   device.deviceType === 'Face_Access' ? <ScanFace size={28} /> : 
                   <Server size={28} />}
                </div>
                <div className="flex gap-2">
                  <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                    device.status === 'online' ? 'bg-green-900/20 text-green-500' :
                    device.status === 'offline' ? 'bg-gray-800 text-gray-500' :
                    'bg-red-900/20 text-red-500'
                  }`}>
                    {device.status}
                  </span>
                  {(profile?.role === 'super_admin' || profile?.role === 'condo_admin') && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleOpenEdit(device)} className="p-1.5 text-gray-500 hover:text-blue-400"><Edit2 size={16} /></button>
                      <button onClick={() => setDeletingDevice(device)} className="p-1.5 text-gray-500 hover:text-red-400"><Trash2 size={16} /></button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-bold text-white mb-1">{device.name}</h3>
                <p className="text-sm text-gray-400 font-medium">{device.model}</p>
                <div className="flex items-center gap-2 mt-2 text-xs text-blue-400 bg-blue-400/5 px-2 py-1 rounded-lg w-fit">
                  <Building2 size={12} />
                  {device.condoName}
                </div>
              </div>

              <div className="space-y-3 bg-gray-950/50 rounded-2xl p-4 border border-gray-800/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-2">
                    <Globe size={14} /> IP Address
                  </span>
                  <span className="text-gray-100 font-mono text-xs">{device.ipAddress}:{device.port}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-2">
                    <User size={14} /> Username
                  </span>
                  <span className="text-gray-100 text-xs">{device.username}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-2">
                    <Lock size={14} /> Connection
                  </span>
                  <span className="text-green-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
                    <Wifi size={10} /> Segura
                  </span>
                </div>
              </div>

              <div className="mt-6">
                <button className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2">
                  <CheckCircle2 size={14} />
                  Test de Conexión
                </button>
              </div>
            </motion.div>
          ))}
          {devices.length === 0 && (
            <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-800 rounded-3xl">
              <Cpu size={48} className="mx-auto text-gray-700 mb-4" />
              <p className="text-gray-500">No hay dispositivos configurados aún.</p>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingDevice) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingDevice(null); }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-xl bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-white tracking-tight">
                    {editingDevice ? 'Editar Configuración' : 'Configurar Dispositivo Innovador'}
                  </h3>
                  <p className="text-gray-400 text-sm mt-1">Establece los parámetros de red para la integración.</p>
                </div>
                <button onClick={() => { setShowAddModal(false); setEditingDevice(null); }} className="p-2 text-gray-500 hover:text-white transition-colors">
                  <X size={28} />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Condominio</label>
                    <select
                      required
                      value={formData.condoId}
                      onChange={(e) => setFormData({ ...formData, condoId: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="">Seleccionar...</option>
                      {condos.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Tecnología</label>
                    <select
                      value={formData.deviceType}
                      onChange={(e) => setFormData({ ...formData, deviceType: e.target.value as Device['deviceType'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                    >
                      <option value="LPR">LPR (Patentes Dahua)</option>
                      <option value="Face_Access">Control Facial (Dahua ASI)</option>
                      <option value="Controller">Controlador de Acceso</option>
                      <option value="Other">Otro Dispositivo</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Nombre Descriptivo</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      placeholder="Ej: Cámara Péntico Norte"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Modelo del Equipo</label>
                    <input
                      required
                      type="text"
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-3 px-4 text-white focus:border-blue-600 outline-none transition-all"
                      placeholder="Ej: Dahua ITC413-PW4D"
                    />
                  </div>
                </div>

                <div className="p-6 bg-blue-600/5 border border-blue-600/10 rounded-3xl space-y-4">
                  <h4 className="text-xs font-bold text-blue-400 uppercase tracking-[0.2em]">Configuración de Red Local</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2">Dirección IP</label>
                      <input
                        required
                        type="text"
                        value={formData.ipAddress}
                        onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2 px-3 text-white text-xs font-mono focus:border-blue-500 outline-none transition-all"
                        placeholder="192.168.1.100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2">Puerto</label>
                      <input
                        required
                        type="text"
                        value={formData.port}
                        onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2 px-3 text-white text-xs font-mono focus:border-blue-500 outline-none transition-all"
                        placeholder="80"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2">Usuario</label>
                      <input
                        required
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2 px-3 text-white text-xs focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2">Password</label>
                      <div className="relative">
                        <input
                          required
                          type={showPassword ? 'text' : 'password'}
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2 px-3 text-white text-xs focus:border-blue-500 outline-none transition-all pr-10"
                        />
                        <button 
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          <Lock size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {saving ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : (editingDevice ? 'Sincronizar Cambios' : 'Guardar y Activar Dispositivo')}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Modal */}
      <AnimatePresence>
        {deletingDevice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingDevice(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-[2rem] p-8 text-center">
              <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center text-red-500 mx-auto mb-6"><Trash2 size={32} /></div>
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar integración?</h3>
              <p className="text-sm text-gray-400 mb-8">Se perderá la conexión con {deletingDevice.name}. Deberás volver a configurarla.</p>
              <div className="flex gap-4">
                <button onClick={() => setDeletingDevice(null)} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold">Cancelar</button>
                <button onClick={handleDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold">Eliminar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Devices;
