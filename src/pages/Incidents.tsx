import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc,
  Timestamp, orderBy, collectionGroup, getDocs, deleteDoc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  AlertTriangle, Plus, Search, Clock, CheckCircle2, AlertCircle,
  ShieldAlert, Building2, Wrench, FileText, CheckCircle, UserPlus,
  Globe, ImagePlus, X, Edit2, Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType, sendNotification, printIncidentReport } from '../lib/utils';
import { authedFetch } from '../lib/apiBase';
import { Button, Card, PageHeader, Field, Input, Modal, Badge, EmptyState, Spinner, StatCard } from '../components/ui';
import { cn } from '../lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

interface Incident {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  category: 'security' | 'maintenance' | 'facility' | 'data_breach' | 'other';
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
  openingImageUrl?: string;
  closingImageUrl?: string;
}

function resizeImageToDataUrl(file: File, maxWidth = 900, quality = 0.65): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Error al cargar imagen')); };
    img.src = url;
  });
}

interface Equipment {
  id: string;
  name: string;
  condoId: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };
const STATUS_LABEL: Record<string, string> = { open: 'Abierto', in_progress: 'En proceso', resolved: 'Resuelto', closed: 'Cerrado' };

function PriorityBadge({ priority }: { priority: Incident['priority'] }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
    high:     'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300',
    medium:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
    low:      'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300',
  };
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold', styles[priority])}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

function StatusBadge({ status }: { status: Incident['status'] }) {
  const map: Record<string, { variant: any; label: string }> = {
    open:        { variant: 'warn',    label: 'Abierto' },
    in_progress: { variant: 'brand',   label: 'En proceso' },
    resolved:    { variant: 'success', label: 'Resuelto' },
    closed:      { variant: 'muted',   label: 'Cerrado' },
  };
  const { variant, label } = map[status] ?? { variant: 'muted', label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

const selectClass = cn(
  'block w-full bg-white dark:bg-slate-950/50',
  'border border-slate-200 dark:border-white/10 rounded-xl',
  'px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100',
  'outline-none transition focus:border-blue-600 dark:focus:border-blue-500',
  'focus:ring-2 focus:ring-blue-500/20 cursor-pointer',
);

async function getTechniciansForCondo(condoId: string): Promise<{ id: string; name: string }[]> {
  const q = query(collection(db, 'users'), where('role', '==', 'technician'));
  const snap = await getDocs(q);
  return snap.docs
    .filter(d => {
      const data = d.data();
      return data.condoScope === 'all' || data.condoId === condoId || (Array.isArray(data.condoIds) && data.condoIds.includes(condoId));
    })
    .map(d => ({ id: d.id, name: d.data().name || '' }));
}

async function getOperatorsForCondo(condoId: string): Promise<{ id: string; name: string }[]> {
  const q = query(collection(db, 'users'), where('role', '==', 'operator'));
  const snap = await getDocs(q);
  return snap.docs
    .filter(d => {
      const data = d.data();
      return data.condoScope === 'all' || data.condoId === condoId || (Array.isArray(data.condoIds) && data.condoIds.includes(condoId));
    })
    .map(d => ({ id: d.id, name: d.data().name || '' }));
}

// ─── component ────────────────────────────────────────────────────────────────

const Incidents = () => {
  const { profile, user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading]     = useState(true);
  const [condos, setCondos]       = useState<{ id: string; name: string }[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  // ── Create modal ──────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [createError, setCreateError]   = useState('');
  const [formData, setFormData] = useState({
    title: '', description: '', priority: 'medium' as Incident['priority'],
    category: 'other' as Incident['category'], location: '',
    condoId: '', equipmentId: '', customEquipment: '',
  });

  // ── Images ────────────────────────────────────────────────────────────────
  const [openingImage, setOpeningImage] = useState('');
  const [closingImage, setClosingImage] = useState('');

  // ── Close modal ────────────────────────────────────────────────────────────
  const [closingIncident, setClosingIncident] = useState<Incident | null>(null);
  const [closingObs, setClosingObs]           = useState('');
  const [closing, setClosing]                 = useState(false);

  // ── New technician modal ──────────────────────────────────────────────────
  const [showTechModal, setShowTechModal] = useState(false);
  const [savingTech, setSavingTech]       = useState(false);
  const [techForm, setTechForm] = useState({
    name: '', email: '', phone: '', specialty: '',
    status: 'active' as 'active' | 'inactive', assignment: [] as string[],
  });

  // ── Edit modal (super_admin) ──────────────────────────────────────────────
  const [editingIncident, setEditingIncident] = useState<Incident | null>(null);
  const [editForm, setEditForm] = useState({
    title: '', description: '', priority: 'medium' as Incident['priority'],
    status: 'open' as Incident['status'], category: 'other' as Incident['category'],
    location: '', condoId: '', equipmentId: '', customEquipment: '',
    closingObservations: '',
  });
  const [editOpeningImage, setEditOpeningImage] = useState('');
  const [editClosingImage, setEditClosingImage] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm]     = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCondo, setFilterCondo]   = useState('');

  const isSuperAdmin = profile?.role === 'super_admin' || profile?.condoScope === 'all';

  const [deletingIncident, setDeletingIncident] = useState<Incident | null>(null);

  const handleDeleteIncident = async () => {
    if (!deletingIncident) return;
    try {
      await deleteDoc(doc(db, `condos/${deletingIncident.condoId}/incidents/${deletingIncident.id}`));
      setDeletingIncident(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE);
    }
  };

  // ── Firestore listeners ───────────────────────────────────────────────────
  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), snap => {
      setCondos(snap.docs.map(d => ({ id: d.id, name: d.data().name as string })));
    });
    if (!profile || !user) return () => condosUnsub();

    const equipQ = isSuperAdmin
      ? query(collectionGroup(db, 'equipment'))
      : query(collection(db, `condos/${profile.condoId || 'x'}/equipment`));
    const equipUnsub = onSnapshot(equipQ, snap => {
      setEquipment(snap.docs.map(d => ({
        id: d.id,
        name: d.data().name as string,
        condoId: (d.ref.parent.parent?.id || d.data().condoId || '') as string,
      })));
    });

    const isGlobal = profile.role === 'super_admin' || profile.condoScope === 'all' || profile.role === 'technician';
    let q: any;
    if (isGlobal) {
      q = query(collectionGroup(db, 'incidents'));
    } else if (profile.role === 'resident' || profile.role === 'usuario') {
      // Sus propios reportes, dentro de su propio condominio (subcolección: cae en la
      // regla condos/{condoId}/incidents con hasCondoAccess, sin el problema de
      // campo-fantasma de un collectionGroup sin filtro por condoId).
      q = query(collection(db, `condos/${profile.condoId || 'default'}/incidents`), where('reportedBy', '==', user.uid));
    } else {
      q = query(collection(db, `condos/${profile.condoId || 'default'}/incidents`), orderBy('createdAt', 'desc'));
    }

    const unsub = onSnapshot(q, (snap: any) => {
      let list = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as Incident[];
      if (profile.role === 'technician' && profile.condoScope !== 'all') {
        const assigned = profile.condoIds || (profile.condoId ? [profile.condoId] : []);
        list = list.filter(i => assigned.includes(i.condoId));
      }
      if (isGlobal || profile.role === 'resident' || profile.role === 'usuario') {
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      }
      setIncidents(list);
      setLoading(false);
    }, (err: any) => {
      setLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'incidents');
    });

    return () => { unsub(); condosUnsub(); equipUnsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, user]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredEquipment = formData.condoId
    ? equipment.filter(e => e.condoId === formData.condoId)
    : equipment;

  const filtered = incidents.filter(i => {
    const term = searchTerm.toLowerCase();
    const matchText   = !term || i.title.toLowerCase().includes(term) || i.description.toLowerCase().includes(term) || i.condoName?.toLowerCase().includes(term);
    const matchStatus = filterStatus === 'all' || i.status === filterStatus;
    const matchCondo  = !filterCondo || i.condoId === filterCondo;
    return matchText && matchStatus && matchCondo;
  });

  // ── Permissions ───────────────────────────────────────────────────────────
  const canAccessIncidents = profile?.role !== 'condo_admin' || profile?.canManageIncidents !== false;
  const canClose      = profile?.role === 'technician' || profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'administrador' || profile?.role === 'operator';
  const canAttend     = profile?.role !== 'resident' && profile?.role !== 'usuario';
  const canCreate     = profile?.role !== 'resident' && profile?.role !== 'usuario';
  const canManageTech = profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'administrador' || profile?.role === 'operator';

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openAddModal = () => {
    setFormData({
      title: '', description: '', priority: 'medium', category: 'other',
      location: '', condoId: profile?.condoId || condos[0]?.id || '',
      equipmentId: '', customEquipment: '',
    });
    setCreateError('');
    setOpeningImage('');
    setShowAddModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    setSaving(true);
    setCreateError('');
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    const selectedEquip = equipment.find(eq => eq.id === formData.equipmentId);
    const condoIdToUse  = formData.condoId || profile.condoId || '';
    if (!condoIdToUse) {
      setCreateError('Selecciona un condominio antes de continuar.');
      setSaving(false);
      return;
    }
    const equipName = selectedEquip?.name || formData.customEquipment || formData.title;
    try {
      const docRef = await addDoc(collection(db, `condos/${condoIdToUse}/incidents`), {
        title:           formData.title,
        description:     formData.description,
        priority:        formData.priority,
        category:        formData.category,
        location:        formData.location,
        condoId:         condoIdToUse,
        condoName:       selectedCondo?.name || profile.condoName || 'Condominio',
        reportedBy:      user.uid,
        reportedByName:  profile.name,
        equipmentId:     formData.equipmentId || '',
        equipmentName:   equipName,
        status:          'open',
        openingImageUrl: openingImage || '',
        createdAt:       Timestamp.now(),
        updatedAt:       Timestamp.now(),
      });

      const techs = await getTechniciansForCondo(condoIdToUse);
      await Promise.all(techs.map(t =>
        sendNotification(t.id, `Nuevo incidente: ${formData.title}`, `${selectedCondo?.name || condoIdToUse} — ${equipName}`, 'incident', '/incidents')
      ));

      // Brecha de datos personales (Ley 21.719): riesgo alto → notificar por correo al
      // responsable (representante legal), además de la notificación en la app.
      if (formData.category === 'data_breach') {
        authedFetch('/api/incidents/breach-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: formData.title, description: formData.description,
            condoName: selectedCondo?.name || condoIdToUse, priority: formData.priority,
            reportedByName: profile.name, incidentId: docRef.id,
          }),
        }).catch(() => {});
      }

      printIncidentReport({
        type: 'initial', incidentId: docRef.id,
        condoName: selectedCondo?.name || condoIdToUse, equipmentName: equipName,
        description: formData.description, priority: formData.priority,
        reportedByName: profile.name, createdAt: new Date(),
        openingImageUrl: openingImage || undefined,
      });

      setShowAddModal(false);
    } catch (err: any) {
      const msg = err?.code === 'permission-denied'
        ? 'Sin permisos para guardar. Contacta al administrador.'
        : err?.message || 'Error al guardar el incidente.';
      setCreateError(msg);
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
        status: 'closed', closingObservations: closingObs,
        closedBy: user.uid, closedByName: profile.name, closedAt: now, updatedAt: now,
        closingImageUrl: closingImage || '',
      });
      const operators = await getOperatorsForCondo(closingIncident.condoId);
      await Promise.all(operators.map(op =>
        sendNotification(op.id, `Incidente cerrado: ${closingIncident.title}`, `Resuelto en ${closingIncident.condoName}. ${closingObs}`, 'incident', '/incidents')
      ));
      printIncidentReport({
        type: 'closure', incidentId: closingIncident.id, condoName: closingIncident.condoName,
        equipmentName: closingIncident.equipmentName || closingIncident.title,
        description: closingIncident.description, priority: closingIncident.priority,
        reportedByName: closingIncident.reportedByName,
        createdAt: closingIncident.createdAt?.toDate?.() || new Date(),
        closingObservations: closingObs, closedByName: profile.name, closedAt: new Date(),
        openingImageUrl: closingIncident.openingImageUrl || undefined,
        closingImageUrl: closingImage || undefined,
      });
      setClosingIncident(null);
      setClosingObs('');
      setClosingImage('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `condos/${closingIncident.condoId}/incidents`);
    } finally {
      setClosing(false);
    }
  };



  const handleOpenEdit = (inc: Incident) => {
    setEditingIncident(inc);
    setEditForm({
      title: inc.title,
      description: inc.description,
      priority: inc.priority,
      status: inc.status,
      category: inc.category,
      location: inc.location || '',
      condoId: inc.condoId,
      equipmentId: inc.equipmentId || '',
      customEquipment: inc.equipmentName || '',
      closingObservations: inc.closingObservations || '',
    });
    setEditOpeningImage(inc.openingImageUrl || '');
    setEditClosingImage(inc.closingImageUrl || '');
  };

  const handleUpdateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIncident || !profile || !user) return;
    setSavingEdit(true);
    const selectedCondo = condos.find(c => c.id === editForm.condoId);
    const selectedEquip = equipment.find(eq => eq.id === editForm.equipmentId);
    const equipName = selectedEquip?.name || editForm.customEquipment || editForm.title;
    try {
      const updates: Record<string, any> = {
        title:           editForm.title,
        description:     editForm.description,
        priority:        editForm.priority,
        status:          editForm.status,
        category:        editForm.category,
        location:        editForm.location,
        condoId:         editForm.condoId,
        condoName:       selectedCondo?.name || editingIncident.condoName,
        equipmentId:     editForm.equipmentId || '',
        equipmentName:   equipName,
        openingImageUrl: editOpeningImage || '',
        updatedAt:       Timestamp.now(),
      };
      if (editForm.status === 'closed') {
        updates.closingObservations = editForm.closingObservations;
        updates.closingImageUrl = editClosingImage || '';
        if (!editingIncident.closedBy) {
          updates.closedBy = user.uid;
          updates.closedByName = profile.name;
          updates.closedAt = Timestamp.now();
        }
      }
      await updateDoc(doc(db, `condos/${editingIncident.condoId}/incidents`, editingIncident.id), updates);
      setEditingIncident(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `condos/${editingIncident.condoId}/incidents`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveTech = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingTech(true);
    try {
      const isAll = techForm.assignment.includes('all');
      await addDoc(collection(db, 'users'), {
        ...techForm, role: 'technician',
        condoScope: isAll ? 'all' : (techForm.assignment.length > 1 ? 'multiple' : 'single'),
        condoId:  isAll ? '' : (techForm.assignment[0] || ''),
        condoIds: isAll ? condos.map(c => c.id) : techForm.assignment,
        uid: '', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
      setShowTechModal(false);
      setTechForm({ name: '', email: '', phone: '', specialty: '', status: 'active', assignment: [] });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'users');
    } finally {
      setSavingTech(false);
    }
  };

  if (loading && !incidents.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );
  }

  if (!canAccessIncidents) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">Sin acceso</p>
          <p className="text-sm mt-1">Tu cuenta no tiene habilitado el módulo de incidencias.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <PageHeader
        icon={AlertTriangle}
        title="Incidentes"
        description="Protocolo de incidencias, fallas y seguridad."
        actions={
          <>
            {canManageTech && (
              <Button
                variant="secondary"
                icon={UserPlus}
                onClick={() => { setTechForm({ name: '', email: '', phone: '', specialty: '', status: 'active', assignment: [] }); setShowTechModal(true); }}
              >
                Nuevo Técnico
              </Button>
            )}
            {canCreate && (
              <Button icon={Plus} onClick={openAddModal}>
                Reportar Incidencia
              </Button>
            )}
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Abiertos"   value={incidents.filter(i => i.status === 'open').length}        icon={AlertCircle}  accent="warn" />
        <StatCard label="En proceso" value={incidents.filter(i => i.status === 'in_progress').length} icon={Clock}        accent="brand" />
        <StatCard label="Cerrados"   value={incidents.filter(i => i.status === 'closed').length}      icon={CheckCircle2} accent="success" />
        <StatCard label="Total"      value={incidents.length}                                          icon={AlertTriangle} accent="indigo" />
      </div>

      {/* Condo filter pills — super_admin */}
      {isSuperAdmin && condos.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Condominio:</span>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilterCondo('')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                !filterCondo ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
              )}
            >
              Todos
            </button>
            {condos.map(c => (
              <button
                key={c.id}
                onClick={() => setFilterCondo(c.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  filterCondo === c.id ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search + status filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar incidente…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'open', 'in_progress', 'resolved', 'closed'] as const).map(s => {
            const labels = { all: 'Todos', open: 'Abierto', in_progress: 'En proceso', resolved: 'Resuelto', closed: 'Cerrado' };
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  filterStatus === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                )}
              >
                {labels[s]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Incident table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="Sin incidencias"
          description="No hay incidentes que coincidan con los filtros."
          action={canCreate && <Button icon={Plus} size="sm" onClick={openAddModal}>Reportar Incidencia</Button>}
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Prioridad</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Estado</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Título</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Condominio</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Equipamiento</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Fecha</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                <AnimatePresence mode="popLayout">
                  {filtered.map(inc => (
                    <motion.tr
                      key={inc.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-5 py-3.5"><PriorityBadge priority={inc.priority} /></td>
                      <td className="px-5 py-3.5"><StatusBadge status={inc.status} /></td>
                      {/* Título + descripción */}
                      <td className="px-5 py-3.5 max-w-xs">
                        <p className="font-semibold text-slate-900 dark:text-white leading-snug">{inc.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{inc.description}</p>
                        {inc.status === 'closed' && inc.closingObservations && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 truncate mt-0.5 font-medium">↳ {inc.closingObservations}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{inc.condoName}</td>
                      <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400">{inc.equipmentName || '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">
                        {inc.createdAt?.toDate ? format(inc.createdAt.toDate(), 'dd/MM/yy HH:mm') : ''}
                      </td>
                      {/* Acciones */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {isSuperAdmin && (
                            <button
                              onClick={() => handleOpenEdit(inc)}
                              title="Editar incidente"
                              className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button
                              onClick={() => setDeletingIncident(inc)}
                              title="Eliminar incidente"
                              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {inc.status === 'closed' && (
                            <button
                              onClick={() => printIncidentReport({
                                type: 'closure', incidentId: inc.id, condoName: inc.condoName,
                                equipmentName: inc.equipmentName || inc.title, description: inc.description,
                                priority: inc.priority, reportedByName: inc.reportedByName,
                                createdAt: inc.createdAt?.toDate?.() || new Date(),
                                closingObservations: inc.closingObservations, closedByName: inc.closedByName,
                                closedAt: inc.closedAt?.toDate?.() || new Date(),
                                openingImageUrl: inc.openingImageUrl || undefined,
                                closingImageUrl: inc.closingImageUrl || undefined,
                              })}
                              title="Informe de cierre PDF"
                              className="p-2 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer"
                            >
                              <FileText size={14} />
                            </button>
                          )}
                          {canAttend && inc.status === 'open' && (
                            <Button size="sm" variant="secondary" onClick={() => handleAttend(inc)}>Atender</Button>
                          )}
                          {canClose && (inc.status === 'open' || inc.status === 'in_progress') && (
                            <Button size="sm" icon={CheckCircle} onClick={() => { setClosingIncident(inc); setClosingObs(''); }}>Cerrar</Button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Create modal ──────────────────────────────────────────────────────── */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Reportar Incidencia"
        description="Notificará al técnico asignado y generará PDF."
        icon={ShieldAlert}
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Título" htmlFor="inc-title" required>
            <Input
              id="inc-title"
              required
              type="text"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ej: Portón norte bloqueado"
            />
          </Field>

          {isSuperAdmin && (
            <Field label="Condominio" htmlFor="inc-condo" required>
              <div className="relative">
                <Building2 size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  id="inc-condo"
                  value={formData.condoId}
                  onChange={e => setFormData({ ...formData, condoId: e.target.value, equipmentId: '' })}
                  className={cn(selectClass, 'pl-9')}
                >
                  <option value="">— seleccionar —</option>
                  {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </Field>
          )}

          <Field label="Equipo con problema" htmlFor="inc-equip">
            {filteredEquipment.length > 0 ? (
              <div className="relative">
                <Wrench size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  id="inc-equip"
                  value={formData.equipmentId}
                  onChange={e => setFormData({ ...formData, equipmentId: e.target.value, customEquipment: '' })}
                  className={cn(selectClass, 'pl-9')}
                >
                  <option value="">— seleccionar equipo —</option>
                  {filteredEquipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
                </select>
              </div>
            ) : (
              <Input
                id="inc-equip"
                type="text"
                value={formData.customEquipment}
                onChange={e => setFormData({ ...formData, customEquipment: e.target.value })}
                placeholder="Ej: Portón norte, Cámara 3, Ascensor B…"
              />
            )}
          </Field>

          <Field label="Categoría" htmlFor="inc-cat">
            <select
              id="inc-cat"
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value as Incident['category'] })}
              className={selectClass}
            >
              <option value="other">Otro</option>
              <option value="security">Seguridad</option>
              <option value="maintenance">Mantención</option>
              <option value="facility">Instalación</option>
              <option value="data_breach">Brecha de datos personales (Ley 21.719)</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Prioridad" htmlFor="inc-priority">
              <select
                id="inc-priority"
                value={formData.priority}
                onChange={e => setFormData({ ...formData, priority: e.target.value as Incident['priority'] })}
                className={selectClass}
              >
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </Field>
            <Field label="Ubicación" htmlFor="inc-loc">
              <Input
                id="inc-loc"
                type="text"
                value={formData.location}
                onChange={e => setFormData({ ...formData, location: e.target.value })}
                placeholder="Torre B, Estac. P1"
              />
            </Field>
          </div>

          <Field label="Descripción del problema" htmlFor="inc-desc" required>
            <textarea
              id="inc-desc"
              required
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className={cn(selectClass, 'resize-none')}
              placeholder="Describir el problema con detalle técnico…"
            />
          </Field>

          <Field label="Imagen de evidencia (opcional)">
            <label className="flex items-center gap-2.5 cursor-pointer px-3.5 py-2.5 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
              <ImagePlus size={15} className="text-slate-400 shrink-0" />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {openingImage ? 'Cambiar imagen' : 'Seleccionar imagen…'}
              </span>
              <input
                type="file" accept="image/*" className="hidden"
                onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file) setOpeningImage(await resizeImageToDataUrl(file));
                }}
              />
            </label>
            {openingImage && (
              <div className="relative mt-2">
                <img src={openingImage} className="w-full max-h-40 object-cover rounded-xl border border-slate-200 dark:border-white/10" />
                <button type="button" onClick={() => setOpeningImage('')}
                  className="absolute top-1.5 right-1.5 p-1 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors cursor-pointer">
                  <X size={12} />
                </button>
              </div>
            )}
          </Field>

          {createError && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <AlertCircle size={14} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs font-medium text-red-700 dark:text-red-400">{createError}</p>
            </div>
          )}

          <Button type="submit" loading={saving} icon={FileText} fullWidth size="lg">
            Emitir Reporte + PDF
          </Button>
        </form>
      </Modal>

      {/* ── Close incident modal ──────────────────────────────────────────────── */}
      <Modal
        open={!!closingIncident}
        onClose={() => setClosingIncident(null)}
        title="Cerrar Incidente"
        description="Notificará a los operadores y generará PDF de cierre."
        icon={CheckCircle2}
        size="sm"
      >
        {closingIncident && (
          <form onSubmit={handleCloseSubmit} className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{closingIncident.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {closingIncident.condoName} · {closingIncident.equipmentName || '—'}
              </p>
            </div>

            <Field label="Observaciones de cierre" htmlFor="close-obs" required>
              <textarea
                id="close-obs"
                required
                value={closingObs}
                onChange={e => setClosingObs(e.target.value)}
                rows={4}
                className={cn(selectClass, 'resize-none')}
                placeholder="Describir la solución aplicada y el estado final del equipo…"
              />
            </Field>

            <Field label="Imagen de evidencia de cierre (opcional)">
              <label className="flex items-center gap-2.5 cursor-pointer px-3.5 py-2.5 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
                <ImagePlus size={15} className="text-slate-400 shrink-0" />
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {closingImage ? 'Cambiar imagen' : 'Seleccionar imagen…'}
                </span>
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0];
                    if (file) setClosingImage(await resizeImageToDataUrl(file));
                  }}
                />
              </label>
              {closingImage && (
                <div className="relative mt-2">
                  <img src={closingImage} className="w-full max-h-40 object-cover rounded-xl border border-slate-200 dark:border-white/10" />
                  <button type="button" onClick={() => setClosingImage('')}
                    className="absolute top-1.5 right-1.5 p-1 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors cursor-pointer">
                    <X size={12} />
                  </button>
                </div>
              )}
            </Field>

            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => { setClosingIncident(null); setClosingImage(''); }} type="button">
                Cancelar
              </Button>
              <Button loading={closing} icon={CheckCircle} fullWidth type="submit">
                Cerrar + PDF
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete confirmation modal ─────────────────────────────────────────── */}
      <Modal
        open={!!deletingIncident}
        onClose={() => setDeletingIncident(null)}
        title="Eliminar incidente"
        description={`¿Eliminar "${deletingIncident?.title}"? Esta acción no se puede deshacer.`}
        icon={Trash2}
        size="sm"
      >
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setDeletingIncident(null)}>
            Cancelar
          </Button>
          <Button variant="danger" fullWidth icon={Trash2} onClick={handleDeleteIncident}>
            Eliminar
          </Button>
        </div>
      </Modal>

      {/* ── New technician modal ──────────────────────────────────────────────── */}
      <Modal
        open={showTechModal}
        onClose={() => setShowTechModal(false)}
        title="Nuevo Técnico"
        description="Será notificado ante incidentes en sus condominios asignados."
        icon={UserPlus}
        size="md"
      >
        <form onSubmit={handleSaveTech} className="space-y-4">
          <Field label="Nombre completo" htmlFor="tech-name" required>
            <Input
              id="tech-name"
              required
              type="text"
              value={techForm.name}
              onChange={e => setTechForm({ ...techForm, name: e.target.value })}
              placeholder="Juan Pérez"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Especialidad" htmlFor="tech-spec" required>
              <Input
                id="tech-spec"
                required
                type="text"
                value={techForm.specialty}
                onChange={e => setTechForm({ ...techForm, specialty: e.target.value })}
                placeholder="Redes / CCTV"
              />
            </Field>
            <Field label="Teléfono" htmlFor="tech-phone">
              <Input
                id="tech-phone"
                type="tel"
                value={techForm.phone}
                onChange={e => setTechForm({ ...techForm, phone: e.target.value })}
                placeholder="+56 9…"
              />
            </Field>
          </div>

          <Field label="Email" htmlFor="tech-email" required>
            <Input
              id="tech-email"
              required
              type="email"
              value={techForm.email}
              onChange={e => setTechForm({ ...techForm, email: e.target.value })}
              placeholder="tecnico@ejemplo.com"
            />
          </Field>

          <Field label="Condominios asignados">
            <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
              <div className="p-3 space-y-2 max-h-44 overflow-y-auto">
                <label className="flex items-center gap-3 cursor-pointer group py-1">
                  <input
                    type="checkbox"
                    checked={techForm.assignment.includes('all')}
                    onChange={e => setTechForm({ ...techForm, assignment: e.target.checked ? ['all'] : [] })}
                    className="w-4 h-4 rounded border-slate-300 dark:border-white/20 text-blue-600 cursor-pointer"
                  />
                  <Globe size={13} className="text-blue-500 shrink-0" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                    Todos los condominios
                  </span>
                </label>
                <div className="h-px bg-slate-100 dark:bg-white/5" />
                {condos.map(c => (
                  <label key={c.id} className="flex items-center gap-3 cursor-pointer group py-1">
                    <input
                      type="checkbox"
                      disabled={techForm.assignment.includes('all')}
                      checked={techForm.assignment.includes(c.id)}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...techForm.assignment.filter(x => x !== 'all'), c.id]
                          : techForm.assignment.filter(x => x !== c.id);
                        setTechForm({ ...techForm, assignment: next });
                      }}
                      className="w-4 h-4 rounded border-slate-300 dark:border-white/20 text-blue-600 cursor-pointer disabled:opacity-40"
                    />
                    <Building2 size={13} className="text-slate-400 shrink-0" />
                    <span className={cn(
                      'text-sm font-medium transition-colors',
                      techForm.assignment.includes('all')
                        ? 'text-slate-400 dark:text-slate-600'
                        : 'text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white',
                    )}>
                      {c.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </Field>

          <Button type="submit" loading={savingTech} icon={UserPlus} fullWidth size="lg">
            Crear Técnico
          </Button>
        </form>
      </Modal>

      {/* ── Edit Incident Modal (super_admin) ──────────────────────────────────── */}
      <Modal
        open={!!editingIncident}
        onClose={() => setEditingIncident(null)}
        title="Editar Incidente"
        description="Modificación de datos del informe de incidencia."
        icon={Edit2}
        size="lg"
      >
        {editingIncident && (
          <form onSubmit={handleUpdateIncident} className="space-y-4">
            <Field label="Título" htmlFor="edit-title" required>
              <input
                id="edit-title"
                required
                type="text"
                value={editForm.title}
                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                className={selectClass}
                placeholder="Ej: Portón norte bloqueado"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Condominio" htmlFor="edit-condo" required>
                <div className="relative">
                  <Building2 size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select
                    id="edit-condo"
                    value={editForm.condoId}
                    onChange={e => setEditForm({ ...editForm, condoId: e.target.value, equipmentId: '' })}
                    className={cn(selectClass, 'pl-9')}
                  >
                    <option value="">— seleccionar —</option>
                    {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </Field>

              <Field label="Equipo" htmlFor="edit-equip">
                {equipment.filter(e => !editForm.condoId || e.condoId === editForm.condoId).length > 0 ? (
                  <div className="relative">
                    <Wrench size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <select
                      id="edit-equip"
                      value={editForm.equipmentId}
                      onChange={e => setEditForm({ ...editForm, equipmentId: e.target.value, customEquipment: '' })}
                      className={cn(selectClass, 'pl-9')}
                    >
                      <option value="">— seleccionar —</option>
                      {equipment.filter(e => !editForm.condoId || e.condoId === editForm.condoId).map(eq => (
                        <option key={eq.id} value={eq.id}>{eq.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input
                    id="edit-equip"
                    type="text"
                    value={editForm.customEquipment}
                    onChange={e => setEditForm({ ...editForm, customEquipment: e.target.value })}
                    className={selectClass}
                    placeholder="Ej: Portón norte, Cámara 3…"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Field label="Prioridad" htmlFor="edit-priority">
                <select
                  id="edit-priority"
                  value={editForm.priority}
                  onChange={e => setEditForm({ ...editForm, priority: e.target.value as Incident['priority'] })}
                  className={selectClass}
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </Field>
              <Field label="Estado" htmlFor="edit-status">
                <select
                  id="edit-status"
                  value={editForm.status}
                  onChange={e => setEditForm({ ...editForm, status: e.target.value as Incident['status'] })}
                  className={selectClass}
                >
                  <option value="open">Abierto</option>
                  <option value="in_progress">En proceso</option>
                  <option value="resolved">Resuelto</option>
                  <option value="closed">Cerrado</option>
                </select>
              </Field>
              <Field label="Ubicación" htmlFor="edit-loc">
                <input
                  id="edit-loc"
                  type="text"
                  value={editForm.location}
                  onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                  className={selectClass}
                  placeholder="Torre B, Estac. P1"
                />
              </Field>
            </div>

            <Field label="Descripción" htmlFor="edit-desc" required>
              <textarea
                id="edit-desc"
                required
                value={editForm.description}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                className={cn(selectClass, 'resize-none')}
              />
            </Field>

            {editForm.status === 'closed' && (
              <Field label="Observaciones de cierre" htmlFor="edit-obs">
                <textarea
                  id="edit-obs"
                  value={editForm.closingObservations}
                  onChange={e => setEditForm({ ...editForm, closingObservations: e.target.value })}
                  rows={3}
                  className={cn(selectClass, 'resize-none')}
                  placeholder="Solución aplicada y estado final del equipo…"
                />
              </Field>
            )}

            {/* Images */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Imagen de apertura">
                <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl hover:border-blue-400 transition-colors">
                  <ImagePlus size={14} className="text-slate-400 shrink-0" />
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {editOpeningImage ? 'Cambiar imagen' : 'Seleccionar…'}
                  </span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) setEditOpeningImage(await resizeImageToDataUrl(file));
                    }}
                  />
                </label>
                {editOpeningImage && (
                  <div className="relative mt-1.5">
                    <img src={editOpeningImage} className="w-full max-h-28 object-cover rounded-lg border border-slate-200 dark:border-white/10" />
                    <button type="button" onClick={() => setEditOpeningImage('')}
                      className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white hover:bg-black/70 cursor-pointer">
                      <X size={11} />
                    </button>
                  </div>
                )}
              </Field>

              <Field label="Imagen de cierre">
                <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl hover:border-blue-400 transition-colors">
                  <ImagePlus size={14} className="text-slate-400 shrink-0" />
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {editClosingImage ? 'Cambiar imagen' : 'Seleccionar…'}
                  </span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) setEditClosingImage(await resizeImageToDataUrl(file));
                    }}
                  />
                </label>
                {editClosingImage && (
                  <div className="relative mt-1.5">
                    <img src={editClosingImage} className="w-full max-h-28 object-cover rounded-lg border border-slate-200 dark:border-white/10" />
                    <button type="button" onClick={() => setEditClosingImage('')}
                      className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white hover:bg-black/70 cursor-pointer">
                      <X size={11} />
                    </button>
                  </div>
                )}
              </Field>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditingIncident(null)}>Cancelar</Button>
              <Button type="submit" loading={savingEdit} icon={Edit2}>Guardar Cambios</Button>
            </div>
          </form>
        )}
      </Modal>

    </div>
  );
};

export default Incidents;
