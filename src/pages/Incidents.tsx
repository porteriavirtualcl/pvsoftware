import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc,
  Timestamp, orderBy, collectionGroup, getDocs,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  AlertTriangle, Plus, Search, Clock, CheckCircle2, AlertCircle,
  X, ShieldAlert, Building2, Wrench, FileText, ChevronDown, CheckCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType, sendNotification, printIncidentReport } from '../lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

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
  equipmentId?: string;
  equipmentName?: string;
  closingObservations?: string;
  closedBy?: string;
  closedByName?: string;
  closedAt?: any;
  createdAt: any;
  updatedAt: any;
}

interface Equipment {
  id: string;
  name: string;
  condoId: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };
const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
};
const STATUS_LABEL: Record<string, string> = { open: 'Abierto', in_progress: 'En proceso', resolved: 'Resuelto', closed: 'Cerrado' };

/** Find all users with role=technician assigned to the given condo */
async function getTechniciansForCondo(condoId: string): Promise<{ id: string; name: string }[]> {
  const q = query(collection(db, 'users'), where('role', '==', 'technician'));
  const snap = await getDocs(q);
  return snap.docs
    .filter(d => {
      const data = d.data();
      return data.condoScope === 'all' ||
        data.condoId === condoId ||
        (Array.isArray(data.condoIds) && data.condoIds.includes(condoId));
    })
    .map(d => ({ id: d.id, name: d.data().name || '' }));
}

/** Find all users with role=operator assigned to the given condo */
async function getOperatorsForCondo(condoId: string): Promise<{ id: string; name: string }[]> {
  const q = query(collection(db, 'users'), where('role', '==', 'operator'));
  const snap = await getDocs(q);
  return snap.docs
    .filter(d => {
      const data = d.data();
      return data.condoScope === 'all' ||
        data.condoId === condoId ||
        (Array.isArray(data.condoIds) && data.condoIds.includes(condoId));
    })
    .map(d => ({ id: d.id, name: d.data().name || '' }));
}

// ─── component ────────────────────────────────────────────────────────────────

const Incidents = () => {
  const { profile, user } = useAuth();
  const [incidents, setIncidents]   = useState<Incident[]>([]);
  const [loading, setLoading]       = useState(true);
  const [condos, setCondos]         = useState<{ id: string; name: string }[]>([]);
  const [equipment, setEquipment]   = useState<Equipment[]>([]);

  // ── Create modal ─────────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [formData, setFormData] = useState({
    title: '', description: '', priority: 'medium' as Incident['priority'],
    category: 'other' as Incident['category'], location: '',
    condoId: '', equipmentId: '',
  });

  // ── Close modal ──────────────────────────────────────────────────────────────
  const [closingIncident, setClosingIncident] = useState<Incident | null>(null);
  const [closingObs, setClosingObs]           = useState('');
  const [closing, setClosing]                 = useState(false);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm]       = useState('');
  const [filterStatus, setFilterStatus]   = useState('all');
  const [filterCondo, setFilterCondo]     = useState('');

  // ─── Firestore listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), snap => {
      setCondos(snap.docs.map(d => ({ id: d.id, name: d.data().name as string })));
    });
    if (!profile || !user) return () => condosUnsub();

    // Equipment (collectionGroup for super_admin, single condo otherwise)
    const equipQ = profile.role === 'super_admin' || profile.condoScope === 'all'
      ? query(collectionGroup(db, 'equipment'))
      : query(collection(db, `condos/${profile.condoId || 'x'}/equipment`));
    const equipUnsub = onSnapshot(equipQ, snap => {
      setEquipment(snap.docs.map(d => ({
        id: d.id,
        name: d.data().name as string,
        condoId: (d.ref.parent.parent?.id || d.data().condoId || '') as string,
      })));
    });

    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'incidents'), orderBy('createdAt', 'desc'));
    } else if (profile.role === 'resident' || profile.role === 'usuario') {
      q = query(collectionGroup(db, 'incidents'), where('reportedBy', '==', user.uid), orderBy('createdAt', 'desc'));
    } else if (profile.role === 'technician') {
      // Technician sees incidents for all their assigned condos
      q = query(collectionGroup(db, 'incidents'), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, `condos/${profile.condoId || 'default'}/incidents`), orderBy('createdAt', 'desc'));
    }

    const unsub = onSnapshot(q, snap => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Incident[];
      // Technician: filter to assigned condos
      if (profile.role === 'technician' && profile.condoScope !== 'all') {
        const assigned = profile.condoIds || (profile.condoId ? [profile.condoId] : []);
        list = list.filter(i => assigned.includes(i.condoId));
      }
      setIncidents(list);
      setLoading(false);
    }, err => {
      setLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'incidents');
    });

    return () => { unsub(); condosUnsub(); equipUnsub(); };
  }, [profile, user]);

  // ─── derived ─────────────────────────────────────────────────────────────────

  const filteredEquipment = formData.condoId
    ? equipment.filter(e => e.condoId === formData.condoId)
    : equipment;

  const filtered = incidents.filter(i => {
    const term = searchTerm.toLowerCase();
    const matchText  = !term || i.title.toLowerCase().includes(term) || i.description.toLowerCase().includes(term) || i.condoName?.toLowerCase().includes(term);
    const matchStatus = filterStatus === 'all' || i.status === filterStatus;
    const matchCondo  = !filterCondo || i.condoId === filterCondo;
    return matchText && matchStatus && matchCondo;
  });

  // ─── handlers ────────────────────────────────────────────────────────────────

  const openAddModal = () => {
    setFormData({
      title: '', description: '', priority: 'medium', category: 'other',
      location: '', condoId: profile?.condoId || condos[0]?.id || '', equipmentId: '',
    });
    setShowAddModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    setSaving(true);
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    const selectedEquip = equipment.find(eq => eq.id === formData.equipmentId);
    const condoIdToUse  = formData.condoId || profile.condoId || 'default';

    try {
      const docRef = await addDoc(collection(db, `condos/${condoIdToUse}/incidents`), {
        title:          formData.title,
        description:    formData.description,
        priority:       formData.priority,
        category:       formData.category,
        location:       formData.location,
        condoId:        condoIdToUse,
        condoName:      selectedCondo?.name || profile.condoName || 'Condominio',
        reportedBy:     user.uid,
        reportedByName: profile.name,
        equipmentId:    formData.equipmentId || '',
        equipmentName:  selectedEquip?.name  || formData.title,
        status:         'open',
        createdAt:      Timestamp.now(),
        updatedAt:      Timestamp.now(),
      });

      // Notify assigned technicians
      const techs = await getTechniciansForCondo(condoIdToUse);
      await Promise.all(techs.map(t =>
        sendNotification(t.id,
          `Nuevo incidente: ${formData.title}`,
          `Condominio ${selectedCondo?.name || condoIdToUse} — ${selectedEquip?.name || 'Equipo sin especificar'}`,
          'incident')
      ));

      // Generate initial PDF
      printIncidentReport({
        type:           'initial',
        incidentId:     docRef.id,
        condoName:      selectedCondo?.name || condoIdToUse,
        equipmentName:  selectedEquip?.name || formData.title,
        description:    formData.description,
        priority:       formData.priority,
        reportedByName: profile.name,
        createdAt:      new Date(),
      });

      setShowAddModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `condos/${condoIdToUse}/incidents`);
    } finally {
      setSaving(false);
    }
  };

  const handleAttend = async (incident: Incident) => {
    await updateDoc(doc(db, `condos/${incident.condoId}/incidents`, incident.id), {
      status: 'in_progress', updatedAt: Timestamp.now(),
    });
  };

  const handleCloseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingIncident || !profile || !user) return;
    setClosing(true);
    try {
      const now = Timestamp.now();
      await updateDoc(doc(db, `condos/${closingIncident.condoId}/incidents`, closingIncident.id), {
        status:               'closed',
        closingObservations:  closingObs,
        closedBy:             user.uid,
        closedByName:         profile.name,
        closedAt:             now,
        updatedAt:            now,
      });

      // Notify all operators
      const operators = await getOperatorsForCondo(closingIncident.condoId);
      await Promise.all(operators.map(op =>
        sendNotification(op.id,
          `Incidente cerrado: ${closingIncident.title}`,
          `Resuelto en ${closingIncident.condoName}. ${closingObs}`,
          'incident')
      ));

      // Generate closure PDF
      printIncidentReport({
        type:                 'closure',
        incidentId:           closingIncident.id,
        condoName:            closingIncident.condoName,
        equipmentName:        closingIncident.equipmentName || closingIncident.title,
        description:          closingIncident.description,
        priority:             closingIncident.priority,
        reportedByName:       closingIncident.reportedByName,
        createdAt:            closingIncident.createdAt?.toDate?.() || new Date(),
        closingObservations:  closingObs,
        closedByName:         profile.name,
        closedAt:             new Date(),
      });

      setClosingIncident(null);
      setClosingObs('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `condos/${closingIncident.condoId}/incidents`);
    } finally {
      setClosing(false);
    }
  };

  // Re-print initial PDF for any existing incident
  const handlePrintInitial = (incident: Incident) => {
    printIncidentReport({
      type:          'initial',
      incidentId:    incident.id,
      condoName:     incident.condoName,
      equipmentName: incident.equipmentName || incident.title,
      description:   incident.description,
      priority:      incident.priority,
      reportedByName: incident.reportedByName,
      createdAt:     incident.createdAt?.toDate?.() || new Date(),
    });
  };

  const canClose   = profile?.role === 'technician' || profile?.role === 'super_admin';
  const canAttend  = profile?.role !== 'resident' && profile?.role !== 'usuario';
  const canCreate  = profile?.role !== 'resident' && profile?.role !== 'usuario';

  if (loading && !incidents.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-900/50 border border-gray-800 p-6 rounded-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-red-600/10 rounded-2xl flex items-center justify-center text-red-500 border border-red-500/20">
            <ShieldAlert size={22} />
          </div>
          <div>
            <h2 className="text-xl font-black text-white italic uppercase tracking-tight">Reporte Crítico</h2>
            <p className="text-gray-500 text-xs font-medium">Protocolo de incidencias, fallas y seguridad.</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={openAddModal}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-black py-2.5 px-5 rounded-xl transition-all shadow-lg shadow-red-600/20 text-sm uppercase tracking-widest">
            <Plus size={16} /> Reportar Incidencia
          </button>
        )}
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Abiertos',    val: incidents.filter(i => i.status === 'open').length,        icon: AlertCircle,  color: 'text-yellow-500' },
          { label: 'En Proceso',  val: incidents.filter(i => i.status === 'in_progress').length, icon: Clock,        color: 'text-blue-500'   },
          { label: 'Cerrados',    val: incidents.filter(i => i.status === 'closed').length,      icon: CheckCircle2, color: 'text-green-500'  },
          { label: 'Total',       val: incidents.length,                                         icon: AlertTriangle,color: 'text-gray-400'   },
        ].map(s => (
          <div key={s.label} className="bg-gray-950 border border-gray-800 rounded-2xl p-5 relative overflow-hidden">
            <s.icon size={40} className={`absolute top-3 right-3 ${s.color} opacity-10`} />
            <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">{s.label}</p>
            <p className="text-2xl font-black text-white mt-1">{s.val}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Buscar incidente…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2.5 pl-9 pr-4 text-white text-sm focus:border-red-600 outline-none" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-950 border border-gray-800 rounded-xl py-2.5 px-3 text-sm text-white focus:border-red-600 outline-none">
          <option value="all">Todos los estados</option>
          <option value="open">Abierto</option>
          <option value="in_progress">En proceso</option>
          <option value="resolved">Resuelto</option>
          <option value="closed">Cerrado</option>
        </select>
        {(profile?.role === 'super_admin' || profile?.condoScope === 'all') && (
          <select value={filterCondo} onChange={e => setFilterCondo(e.target.value)}
            className="bg-gray-950 border border-gray-800 rounded-xl py-2.5 px-3 text-sm text-white focus:border-red-600 outline-none">
            <option value="">Todos los condos</option>
            {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {/* ── Incident cards ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <ShieldAlert size={36} className="text-gray-700" />
          <p className="text-gray-500 text-sm">No hay incidentes que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          <AnimatePresence>
            {filtered.map(inc => (
              <motion.div layout key={inc.id}
                initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-red-500/30 transition-all flex flex-col gap-4">

                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${PRIORITY_COLOR[inc.priority]}`}>
                    {PRIORITY_LABEL[inc.priority]}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 uppercase">
                    {inc.status === 'closed'      ? <CheckCircle  size={12} className="text-green-500" /> :
                     inc.status === 'in_progress' ? <Clock        size={12} className="text-blue-400 animate-pulse" /> :
                                                    <AlertCircle  size={12} className="text-yellow-400" />}
                    {STATUS_LABEL[inc.status]}
                  </span>
                </div>

                {/* Body */}
                <div className="flex-1 space-y-1.5">
                  <h3 className="font-bold text-white text-sm leading-tight">{inc.title}</h3>
                  <p className="text-xs text-gray-400 line-clamp-2">{inc.description}</p>
                </div>

                {/* Meta */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800/50">
                    <p className="text-[9px] font-black text-gray-600 uppercase mb-0.5">Condominio</p>
                    <p className="font-bold text-gray-300 truncate">{inc.condoName}</p>
                  </div>
                  <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800/50">
                    <p className="text-[9px] font-black text-gray-600 uppercase mb-0.5">Equipo</p>
                    <p className="font-bold text-gray-300 truncate">{inc.equipmentName || '—'}</p>
                  </div>
                </div>

                {/* Closing obs (if closed) */}
                {inc.status === 'closed' && inc.closingObservations && (
                  <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-2.5 text-xs">
                    <p className="text-[9px] font-black text-green-500 uppercase mb-1">Observaciones de cierre</p>
                    <p className="text-gray-300 line-clamp-2">{inc.closingObservations}</p>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-800/50 gap-2">
                  <p className="text-[10px] text-gray-600 truncate">
                    {inc.createdAt?.toDate ? format(inc.createdAt.toDate(), 'dd/MM/yy HH:mm') : ''}
                  </p>
                  <div className="flex gap-1.5 shrink-0">
                    {/* PDF inicial */}
                    <button onClick={() => handlePrintInitial(inc)} title="Reporte inicial PDF"
                      className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-lg transition-all">
                      <FileText size={13} />
                    </button>
                    {/* Cierre PDF si ya está cerrado */}
                    {inc.status === 'closed' && (
                      <button onClick={() => printIncidentReport({
                        type: 'closure', incidentId: inc.id, condoName: inc.condoName,
                        equipmentName: inc.equipmentName || inc.title, description: inc.description,
                        priority: inc.priority, reportedByName: inc.reportedByName,
                        createdAt: inc.createdAt?.toDate?.() || new Date(),
                        closingObservations: inc.closingObservations, closedByName: inc.closedByName,
                        closedAt: inc.closedAt?.toDate?.() || new Date(),
                      })} title="Informe de cierre PDF"
                        className="p-1.5 bg-green-600/10 hover:bg-green-600/20 text-green-400 rounded-lg transition-all">
                        <FileText size={13} />
                      </button>
                    )}
                    {/* Atender */}
                    {canAttend && inc.status === 'open' && (
                      <button onClick={() => handleAttend(inc)}
                        className="px-3 py-1 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white font-bold rounded-lg text-[10px] uppercase tracking-wide transition-all">
                        Atender
                      </button>
                    )}
                    {/* Cerrar */}
                    {canClose && (inc.status === 'open' || inc.status === 'in_progress') && (
                      <button onClick={() => { setClosingIncident(inc); setClosingObs(''); }}
                        className="px-3 py-1 bg-green-600/10 hover:bg-green-600 text-green-400 hover:text-white font-bold rounded-lg text-[10px] uppercase tracking-wide transition-all">
                        Cerrar
                      </button>
                    )}
                  </div>
                </div>

              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Create modal ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-xl bg-gray-900 border border-gray-800 rounded-3xl p-8 overflow-y-auto max-h-[90vh] no-scrollbar shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-black text-white italic uppercase">Reportar Incidencia</h3>
                  <p className="text-gray-500 text-xs mt-0.5">Notificará al técnico asignado y generará PDF.</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="w-9 h-9 bg-gray-800 hover:bg-gray-700 rounded-xl flex items-center justify-center text-white transition-all"><X size={16} /></button>
              </div>

              <form onSubmit={handleCreate} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Título</label>
                  <input required type="text" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold focus:border-red-600 outline-none" placeholder="Ej: Portón norte bloqueado" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {(profile?.role === 'super_admin' || profile?.condoScope === 'all') && (
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Condominio</label>
                      <div className="relative">
                        <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <select value={formData.condoId} onChange={e => setFormData({ ...formData, condoId: e.target.value, equipmentId: '' })}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-9 pr-4 text-white font-bold focus:border-red-600 outline-none">
                          <option value="">— seleccionar —</option>
                          {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Equipamiento con problema</label>
                    <div className="relative">
                      <Wrench size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                      <select required value={formData.equipmentId} onChange={e => setFormData({ ...formData, equipmentId: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-9 pr-4 text-white font-bold focus:border-red-600 outline-none">
                        <option value="">— seleccionar equipo —</option>
                        {filteredEquipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Prioridad</label>
                    <select value={formData.priority} onChange={e => setFormData({ ...formData, priority: e.target.value as Incident['priority'] })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold focus:border-red-600 outline-none">
                      <option value="low">Baja</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                      <option value="critical">Crítica</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Ubicación</label>
                    <input type="text" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold focus:border-red-600 outline-none" placeholder="Torre B, Estac. P1" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Descripción del problema</label>
                  <textarea required value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white h-28 resize-none focus:border-red-600 outline-none" placeholder="Describir el problema con detalle técnico…" />
                </div>

                <button type="submit" disabled={saving}
                  className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-red-600/20 flex items-center justify-center gap-2">
                  {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Procesando…</> : <><FileText size={15} />Emitir Reporte + PDF</>}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Close incident modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {closingIncident && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setClosingIncident(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-black text-white italic uppercase">Cerrar Incidente</h3>
                  <p className="text-gray-500 text-xs mt-0.5">Notificará a todos los operadores y generará PDF de cierre.</p>
                </div>
                <button onClick={() => setClosingIncident(null)} className="w-9 h-9 bg-gray-800 hover:bg-gray-700 rounded-xl flex items-center justify-center text-white transition-all"><X size={16} /></button>
              </div>

              <div className="bg-gray-950 rounded-xl p-3 mb-5 border border-gray-800">
                <p className="text-xs font-bold text-white">{closingIncident.title}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{closingIncident.condoName} · {closingIncident.equipmentName || '—'}</p>
              </div>

              <form onSubmit={handleCloseSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Observaciones de cierre *</label>
                  <textarea required value={closingObs} onChange={e => setClosingObs(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white h-32 resize-none focus:border-green-600 outline-none" placeholder="Describir la solución aplicada y el estado final del equipo…" />
                </div>
                <button type="submit" disabled={closing}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-black py-4 rounded-xl transition-all flex items-center justify-center gap-2">
                  {closing ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Procesando…</> : <><CheckCircle size={15} />Cerrar + Generar PDF</>}
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
