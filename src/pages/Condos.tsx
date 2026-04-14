import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Building2, Plus, MapPin, Users, Edit2, Trash2, X, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';
import DahuaService, { DahuaChannel } from '../services/DahuaService';

interface Condo {
  id: string;
  name: string;
  address: string;
  residentsCount?: number;
  dahuaChannelIds?: string[];
}

const Condos = () => {
  const { profile } = useAuth();
  const [condos, setCondos]             = useState<Condo[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCondo, setEditingCondo] = useState<Condo | null>(null);
  const [deletingCondo, setDeletingCondo] = useState<Condo | null>(null);
  const [formData, setFormData]         = useState({ name: '', address: '' });

  // Dahua channel config
  const [dahuaConfigCondo, setDahuaConfigCondo]   = useState<Condo | null>(null);
  const [discovered, setDiscovered]               = useState<DahuaChannel[]>([]);
  const [selectedIds, setSelectedIds]             = useState<Set<string>>(new Set());
  const [dahuaLoading, setDahuaLoading]           = useState(false);
  const [dahuaSaving, setDahuaSaving]             = useState(false);
  const [dahuaError, setDahuaError]               = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'condos'));
    const unsub = onSnapshot(q, (snap) => {
      setCondos(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Condo[]);
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'condos'));
    return () => unsub();
  }, []);

  // ── condo CRUD ──────────────────────────────────────────────────────────────

  const handleOpenAdd = () => { setFormData({ name: '', address: '' }); setShowAddModal(true); };

  const handleOpenEdit = (condo: Condo) => {
    setEditingCondo(condo);
    setFormData({ name: condo.name, address: condo.address });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCondo) {
        await updateDoc(doc(db, 'condos', editingCondo.id), { ...formData, updatedAt: Timestamp.now() });
      } else {
        await addDoc(collection(db, 'condos'), { ...formData, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      }
      setShowAddModal(false); setEditingCondo(null);
    } catch (err) {
      handleFirestoreError(err, editingCondo ? OperationType.UPDATE : OperationType.CREATE, 'condos');
    }
  };

  const handleDelete = async () => {
    if (!deletingCondo) return;
    try {
      await deleteDoc(doc(db, 'condos', deletingCondo.id));
      setDeletingCondo(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'condos');
    }
  };

  // ── Dahua channel config ────────────────────────────────────────────────────

  const handleOpenDahua = (condo: Condo) => {
    setDahuaConfigCondo(condo);
    setDiscovered([]);
    setSelectedIds(new Set(condo.dahuaChannelIds ?? []));
    setDahuaError(null);
  };

  const handleDiscover = async () => {
    setDahuaLoading(true); setDahuaError(null);
    try {
      const chs = await DahuaService.listAccessChannels();
      setDiscovered(chs);
    } catch (err: unknown) {
      setDahuaError((err as Error)?.message ?? 'Error al conectar con el DSS');
    } finally {
      setDahuaLoading(false);
    }
  };

  const toggleId = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSaveDahua = async () => {
    if (!dahuaConfigCondo) return;
    setDahuaSaving(true);
    try {
      await updateDoc(doc(db, 'condos', dahuaConfigCondo.id), {
        dahuaChannelIds: [...selectedIds],
        updatedAt: Timestamp.now(),
      });
      setDahuaConfigCondo(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'condos');
    } finally {
      setDahuaSaving(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight uppercase italic">Condominios</h2>
          <p className="text-gray-500 mt-1 italic font-medium">Administra los complejos residenciales registrados.</p>
        </div>
        {profile?.role === 'super_admin' && (
          <button onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20 uppercase tracking-widest text-sm">
            <Plus size={20} /> Nuevo Condominio
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {condos.map((condo, i) => (
          <motion.div key={condo.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-[2.5rem] p-8 hover:border-blue-500/50 transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-blue-600/10 transition-colors" />

            <div className="flex items-start justify-between mb-8 relative">
              <div className="w-14 h-14 bg-gray-950 rounded-2xl border border-gray-800 flex items-center justify-center text-blue-500 group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 shadow-inner">
                <Building2 size={28} />
              </div>
              {profile?.role === 'super_admin' && (
                <div className="flex gap-2">
                  <button onClick={() => handleOpenEdit(condo)} className="p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-all" title="Editar"><Edit2 size={18} /></button>
                  <button onClick={() => setDeletingCondo(condo)} className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all" title="Eliminar"><Trash2 size={18} /></button>
                </div>
              )}
            </div>

            <div className="space-y-4 relative">
              <h3 className="text-2xl font-black text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight italic">{condo.name}</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-gray-500 font-bold text-sm uppercase tracking-widest">
                  <MapPin size={16} className="text-blue-500" /><span className="truncate">{condo.address}</span>
                </div>
                <div className="flex items-center gap-3 text-gray-500 font-bold text-sm uppercase tracking-widest">
                  <Users size={16} className="text-blue-500" /><span>{condo.residentsCount || 0} Residentes</span>
                </div>
                <div className="flex items-center gap-3 font-bold text-sm uppercase tracking-widest">
                  {(condo.dahuaChannelIds?.length ?? 0) > 0
                    ? <><Wifi size={16} className="text-green-500" /><span className="text-green-500">{condo.dahuaChannelIds!.length} canal{condo.dahuaChannelIds!.length !== 1 ? 'es' : ''} ACS</span></>
                    : <><WifiOff size={16} className="text-gray-600" /><span className="text-gray-600">Sin canales ACS</span></>
                  }
                </div>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-white/5 grid grid-cols-2 gap-4 relative">
              <button className="bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest py-4 rounded-2xl transition-all border border-white/5">Edificios</button>
              <button onClick={() => handleOpenDahua(condo)}
                className={`text-[10px] font-black uppercase tracking-widest py-4 rounded-2xl transition-all border ${
                  (condo.dahuaChannelIds?.length ?? 0) > 0
                    ? 'bg-green-600/20 hover:bg-green-600/40 text-green-400 border-green-600/30'
                    : 'bg-white/5 hover:bg-white/10 text-white border-white/5'
                }`}>
                Canales DSS
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Dahua Modal ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {dahuaConfigCondo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!dahuaSaving) setDahuaConfigCondo(null); }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between mb-6 shrink-0">
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2"><Wifi size={20} className="text-blue-400" /> Canales ACS — Dahua DSS</h3>
                  <p className="text-gray-500 text-xs mt-1">{dahuaConfigCondo.name}</p>
                </div>
                <button onClick={() => { if (!dahuaSaving) setDahuaConfigCondo(null); }} className="text-gray-400 hover:text-white"><X size={24} /></button>
              </div>

              {/* Discover */}
              <button onClick={handleDiscover} disabled={dahuaLoading}
                className="flex items-center justify-center gap-2 w-full bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-300 font-bold py-3 rounded-xl transition-all mb-4 shrink-0 disabled:opacity-50">
                <RefreshCw size={16} className={dahuaLoading ? 'animate-spin' : ''} />
                {dahuaLoading ? 'Conectando…' : discovered.length > 0 ? 'Redescubrir canales' : 'Descubrir canales desde DSS'}
              </button>

              {dahuaError && (
                <div className="mb-4 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm shrink-0">{dahuaError}</div>
              )}

              {/* Saved channels (pre-discovery) */}
              {discovered.length === 0 && selectedIds.size > 0 && (
                <div className="mb-4 shrink-0">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-2">Canales guardados</p>
                  <div className="space-y-1">
                    {[...selectedIds].map(id => (
                      <div key={id} className="flex items-center justify-between px-3 py-2 bg-green-900/20 border border-green-800/40 rounded-lg">
                        <span className="text-xs text-green-300 font-mono break-all">{id}</span>
                        <button onClick={() => toggleId(id)} className="ml-2 text-gray-500 hover:text-red-400 shrink-0"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Discovered list */}
              {discovered.length > 0 && (
                <div className="flex-1 overflow-y-auto min-h-0 mb-4">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-2 sticky top-0 bg-gray-900 py-1">
                    {discovered.length} canales — marcá los de este condominio
                  </p>
                  <div className="space-y-1.5">
                    {discovered.map(ch => (
                      <label key={ch.id} className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors border ${selectedIds.has(ch.id) ? 'bg-blue-900/30 border-blue-600/40' : 'hover:bg-gray-800 border-transparent'}`}>
                        <input type="checkbox" className="mt-0.5 accent-blue-500 shrink-0" checked={selectedIds.has(ch.id)} onChange={() => toggleId(ch.id)} />
                        <div className="min-w-0">
                          <p className="text-sm text-gray-200 font-medium">{ch.orgName || '(sin nombre)'}</p>
                          <p className="text-[10px] text-gray-500 font-mono break-all mt-0.5">{ch.id}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Save */}
              <div className="shrink-0 pt-4 border-t border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-500">{selectedIds.size} canal{selectedIds.size !== 1 ? 'es' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
                  {selectedIds.size > 0 && <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-500 hover:text-red-400">Limpiar</button>}
                </div>
                <button onClick={handleSaveDahua} disabled={dahuaSaving}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-600/20">
                  {dahuaSaving ? 'Guardando…' : 'Guardar configuración de canales'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Add/Edit Modal ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {(showAddModal || editingCondo) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingCondo(null); }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
              className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 shadow-2xl">
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-2xl font-black text-white italic uppercase tracking-tight">{editingCondo ? 'Editar Ficha' : 'Nuevo Condominio'}</h3>
                <button onClick={() => { setShowAddModal(false); setEditingCondo(null); }} className="w-12 h-12 bg-white/5 hover:bg-white/10 text-gray-400 rounded-full flex items-center justify-center transition-all"><X size={24} /></button>
              </div>
              <form onSubmit={handleSave} className="space-y-8">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nombre del Complejo</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 px-6 text-white font-bold focus:border-blue-600 outline-none transition-all"
                    placeholder="Ej: Condominio Los Olivos" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Ubicación / Dirección</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={18} />
                    <input required type="text" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-12 pr-6 text-white font-bold focus:border-blue-600 outline-none transition-all"
                      placeholder="Av. Principal 123, Ciudad" />
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-2xl shadow-blue-600/30 text-lg uppercase tracking-widest mt-4">
                  {editingCondo ? 'Actualizar Datos' : 'Registrar Condominio'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Delete Modal ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {deletingCondo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingCondo(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-[2.5rem] p-10 text-center shadow-2xl">
              <div className="w-20 h-20 bg-red-600/10 rounded-full flex items-center justify-center text-red-500 mx-auto mb-8 shadow-inner"><Trash2 size={36} /></div>
              <h3 className="text-2xl font-black text-white mb-3 italic">¿Eliminar Ficha?</h3>
              <p className="text-gray-500 text-sm font-medium mb-10 leading-relaxed uppercase tracking-wider">Se anulará permanentemente <span className="text-white font-bold italic">"{deletingCondo.name}"</span>.</p>
              <div className="flex gap-4">
                <button onClick={() => setDeletingCondo(null)} className="flex-1 bg-gray-800 text-white py-4 rounded-2xl font-black uppercase tracking-widest">Volver</button>
                <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-red-600/20">Confirmar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Condos;
