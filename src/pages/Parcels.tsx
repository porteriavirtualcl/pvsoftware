import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc, Timestamp
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Archive, Plus, X, CheckCircle2, Clock, Building2, User, ChevronDown,
  History, UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, sendNotification } from '../lib/utils';

interface Parcel {
  id: string;
  condoId: string;
  condoName: string;
  residentName: string;
  residentUserId: string;
  unit: string;
  status: 'pending' | 'picked_up';
  arrivedAt: any;
  pickedUpAt: any;
  createdBy: string;
  createdByName: string;
  pickedUpBy?: string;
  pickedUpByName?: string;
}

const Parcels = () => {
  const { profile, user } = useAuth();
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [residents, setResidents] = useState<any[]>([]);
  const [condos, setCondos] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'picked_up'>('pending');
  const [selectedCondoId, setSelectedCondoId] = useState('');
  const [historyDate, setHistoryDate] = useState('');

  const [form, setForm] = useState({
    residentName: '',
    residentUserId: '',
    unit: '',
  });

  const isSuperAdmin = profile?.role === 'super_admin' || profile?.condoScope === 'all';

  // Load condos
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'condos'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, name: d.data().name as string }));
      setCondos(list);
      // Set default condo selection
      if (!selectedCondoId) {
        const defaultId = profile?.condoId || (list[0]?.id ?? '');
        setSelectedCondoId(defaultId);
      }
    });
    return () => unsub();
  }, [profile?.condoId]);

  // Load residents + parcels when selected condo changes
  useEffect(() => {
    if (!selectedCondoId || !profile || !user) return;

    const residentsUnsub = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'resident'), where('condoId', '==', selectedCondoId)),
      snap => setResidents(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    const parcelsUnsub = onSnapshot(
      collection(db, `condos/${selectedCondoId}/parcels`),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Parcel[];
        list.sort((a, b) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
        setParcels(list);
        setLoading(false);
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'parcels');
        setLoading(false);
      }
    );

    return () => { residentsUnsub(); parcelsUnsub(); };
  }, [selectedCondoId, profile, user]);

  const handleOpenForm = () => {
    setForm({ residentName: '', residentUserId: '', unit: '' });
    setShowForm(true);
  };

  const handleResidentSelect = (residentId: string) => {
    if (!residentId) {
      setForm({ residentName: '', residentUserId: '', unit: '' });
      return;
    }
    const r = residents.find(r => r.id === residentId);
    if (r) setForm({ residentName: r.name || '', residentUserId: r.id, unit: r.unit || '' });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    setSaving(true);
    const condo = condos.find(c => c.id === selectedCondoId);
    try {
      await addDoc(collection(db, `condos/${selectedCondoId}/parcels`), {
        condoId: selectedCondoId,
        condoName: condo?.name || profile.condoName || '',
        residentName: form.residentName,
        residentUserId: form.residentUserId || '',
        unit: form.unit,
        status: 'pending',
        arrivedAt: Timestamp.now(),
        pickedUpAt: null,
        createdBy: user.uid,
        createdByName: profile.name || user.email || 'Operador',
      });

      if (form.residentUserId) {
        await sendNotification(
          form.residentUserId,
          'Encomienda Recibida',
          `Tienes una encomienda esperando en portería. Unidad ${form.unit}. Coordina su retiro.`,
          'info'
        );
      }

      setShowForm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'parcels');
    } finally {
      setSaving(false);
    }
  };

  const handlePickup = async (parcel: Parcel) => {
    try {
      await updateDoc(doc(db, `condos/${parcel.condoId}/parcels`, parcel.id), {
        status: 'picked_up',
        pickedUpAt: Timestamp.now(),
        pickedUpBy: user?.uid || '',
        pickedUpByName: profile?.name || user?.email || 'Operador',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'parcels');
    }
  };

  const formatTime = (ts: any) => {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  };

  const filtered = parcels.filter(p => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (filterStatus === 'picked_up' && historyDate) {
      const pickedDate = p.pickedUpAt?.toDate ? p.pickedUpAt.toDate().toISOString().slice(0, 10) : '';
      if (pickedDate !== historyDate) return false;
    }
    return true;
  });
  const pendingCount = parcels.filter(p => p.status === 'pending').length;

  if (loading && !parcels.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 p-10 rounded-[3rem] shadow-sm dark:shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 text-blue-500/10"><Archive size={100} /></div>
        <div className="flex items-center gap-6 relative">
          <div className="w-16 h-16 bg-blue-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-blue-600/30">
            <Archive size={32} />
          </div>
          <div>
            <h2 className="text-4xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight">Encomiendas</h2>
            <p className="text-slate-500 dark:text-gray-500 font-medium">
              {pendingCount > 0
                ? `${pendingCount} encomienda${pendingCount > 1 ? 's' : ''} pendiente${pendingCount > 1 ? 's' : ''} de retiro.`
                : 'Registro y gestión de paquetes en portería.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleOpenForm}
          className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl flex items-center gap-3 text-lg group"
        >
          <Plus size={24} className="group-hover:rotate-90 transition-transform" />
          Nueva Encomienda
        </button>
      </div>

      {/* Condo selector for super_admin */}
      {isSuperAdmin && condos.length > 1 && (
        <div className="flex items-center gap-4">
          <span className="text-sm font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest">Condominio:</span>
          <div className="relative">
            <select
              value={selectedCondoId}
              onChange={e => setSelectedCondoId(e.target.value)}
              className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl py-2.5 pl-4 pr-10 text-slate-900 dark:text-white font-bold text-sm appearance-none"
            >
              {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-3">
        {(['pending', 'all', 'picked_up'] as const).map(s => (
          <button
            key={s}
            onClick={() => { setFilterStatus(s); if (s !== 'picked_up') setHistoryDate(''); }}
            className={`px-5 py-2 rounded-xl font-black uppercase tracking-widest text-sm transition-all ${
              filterStatus === s
                ? s === 'pending' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                  : s === 'picked_up' ? 'bg-green-600 text-white shadow-lg shadow-green-600/20'
                  : 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 hover:border-blue-500/50'
            }`}
          >
            {s === 'all' ? `Todas (${parcels.length})`
              : s === 'pending' ? `Pendientes (${parcels.filter(p => p.status === 'pending').length})`
              : `Retiradas (${parcels.filter(p => p.status === 'picked_up').length})`}
          </button>
        ))}

        {/* Date filter — visible only on Retiradas tab */}
        {filterStatus === 'picked_up' && (
          <div className="flex items-center gap-2 ml-2">
            <History size={15} className="text-slate-400" />
            <input
              type="date"
              value={historyDate}
              onChange={e => setHistoryDate(e.target.value)}
              className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl py-2 px-3 text-slate-700 dark:text-white text-sm font-bold focus:border-green-500 outline-none"
            />
            {historyDate && (
              <button
                onClick={() => setHistoryDate('')}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white font-black uppercase"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Parcel list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full text-center py-20"
            >
              <Archive size={48} className="mx-auto mb-4 text-slate-300 dark:text-gray-700" />
              <p className="font-black uppercase italic text-xl text-slate-400 dark:text-gray-600">
                Sin encomiendas {filterStatus !== 'all' ? 'en este estado' : ''}
              </p>
            </motion.div>
          ) : filtered.map(parcel => (
            <motion.div
              layout
              key={parcel.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`relative bg-white dark:bg-gray-900 border rounded-[2.5rem] p-8 overflow-hidden transition-all shadow-sm dark:shadow-none ${
                parcel.status === 'pending'
                  ? 'border-amber-500/40 dark:border-amber-500/20'
                  : 'border-slate-200 dark:border-gray-800'
              }`}
            >
              {/* Status badge */}
              <div className="absolute top-6 right-6">
                <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
                  parcel.status === 'pending'
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'bg-green-500/10 text-green-500'
                }`}>
                  {parcel.status === 'pending' ? 'Pendiente' : 'Retirada'}
                </span>
              </div>

              {/* Resident info */}
              <div className="flex items-start gap-4 mb-6 pr-24">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                  parcel.status === 'pending'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                    : 'bg-slate-100 dark:bg-gray-800 text-slate-400'
                }`}>
                  <Archive size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase italic tracking-tight leading-tight">
                    {parcel.residentName}
                  </h3>
                  <p className="text-blue-500 font-black text-sm uppercase tracking-widest">Unidad {parcel.unit}</p>
                </div>
              </div>

              {/* Timestamps */}
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400">
                  <Clock size={14} className="text-amber-500 shrink-0" />
                  <span className="font-medium">
                    Llegó: <span className="font-black text-slate-700 dark:text-white">{formatTime(parcel.arrivedAt)}</span>
                  </span>
                </div>
                {parcel.pickedUpAt && (
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400">
                    <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                    <span className="font-medium">
                      Retirada: <span className="font-black text-green-600 dark:text-green-400">{formatTime(parcel.pickedUpAt)}</span>
                    </span>
                  </div>
                )}
                {parcel.pickedUpByName && (
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400">
                    <UserCheck size={14} className="text-green-500 shrink-0" />
                    <span className="font-medium">
                      Confirmado por: <span className="font-black text-slate-700 dark:text-white">{parcel.pickedUpByName}</span>
                    </span>
                  </div>
                )}
                {condos.length > 1 && (
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400">
                    <Building2 size={14} className="shrink-0" />
                    <span className="font-medium">{parcel.condoName}</span>
                  </div>
                )}
              </div>

              {/* Action */}
              {parcel.status === 'pending' && (
                <button
                  onClick={() => handlePickup(parcel)}
                  className="w-full bg-green-600 hover:bg-green-500 text-white font-black py-3 rounded-xl transition-all shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 text-sm uppercase tracking-widest"
                >
                  <CheckCircle2 size={18} />
                  Encomienda Retirada
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* New parcel modal */}
      <AnimatePresence>
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)}
              className="absolute inset-0 bg-black/40 dark:bg-black/95 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-[3rem] p-10 shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar"
            >
              <button
                onClick={() => setShowForm(false)}
                className="absolute top-6 right-6 p-2 rounded-xl bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all"
              >
                <X size={20} />
              </button>
              <h3 className="text-xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight mb-8">
                Registrar Encomienda
              </h3>

              <form onSubmit={handleSave} className="space-y-6">
                {/* Resident dropdown */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Residente Destinatario
                  </label>
                  {residents.length > 0 ? (
                    <div className="relative">
                      <select
                        value={form.residentUserId}
                        onChange={e => handleResidentSelect(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-bold appearance-none"
                      >
                        <option value="">— Seleccionar residente —</option>
                        {residents.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.name} — Unidad {r.unit}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  ) : null}
                </div>

                {/* Manual entry (always visible, pre-filled from selection) */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Nombre del Residente
                  </label>
                  <input
                    required
                    type="text"
                    value={form.residentName}
                    onChange={e => setForm(f => ({ ...f, residentName: e.target.value, residentUserId: '' }))}
                    placeholder="Nombre completo"
                    className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-bold"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Unidad / Departamento
                  </label>
                  <input
                    required
                    type="text"
                    value={form.unit}
                    onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                    placeholder="Ej: 301, A-12"
                    className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-bold"
                  />
                </div>

                {/* Notification hint */}
                {form.residentUserId && (
                  <div className="flex items-start gap-3 p-4 bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 rounded-2xl">
                    <User size={16} className="text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-slate-500 dark:text-gray-400 font-medium">
                      Se enviará una notificación automática a <span className="font-black text-blue-500">{form.residentName}</span> informando sobre su encomienda.
                    </p>
                  </div>
                )}

                {/* Arrival time (readonly) */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Hora de Llegada (Automática)
                  </label>
                  <div className="w-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl py-4 px-6 text-slate-600 dark:text-gray-300 font-bold flex items-center gap-3">
                    <Clock size={16} className="text-amber-500" />
                    {new Date().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving || !form.residentName || !form.unit}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-600/30 text-lg mt-2"
                >
                  {saving ? 'Registrando...' : 'Registrar Encomienda'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Parcels;
