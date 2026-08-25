import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users, Plus, Phone, Mail, ShieldCheck, Edit2, Trash2,
  UserPlus, Wrench, Building2, Globe, Shield, Eye, EyeOff,
} from 'lucide-react';
import { db } from '../firebase';
import {
  collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc,
  Timestamp, where,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';
import { isOnlineNow, estadoPresencia, ETIQUETA_PRESENCIA, type EstadoPresencia } from '../hooks/usePresence';
import { api, authedFetch } from '../lib/apiBase';
import {
  PageHeader, Card, Button, Field, Input, Modal, Badge, EmptyState, Spinner,
} from '../components/ui';

// ─── types ────────────────────────────────────────────────────────────────────

interface Operator {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'inactive';
  shift: string;
  activeAlerts: number;
  email?: string;
  phone?: string;
  condoId: string;
  condoIds?: string[];
  condoName?: string;
  condoScope: 'single' | 'multiple' | 'all';
  isOnline?: boolean;
  lastSeen?: { toMillis(): number } | null;
}

const COLOR_PRESENCIA: Record<EstadoPresencia, string> = {
  en_turno: 'bg-emerald-400',
  sin_confirmar: 'bg-amber-400',
  offline: 'bg-red-400',
};
const TEXTO_PRESENCIA: Record<EstadoPresencia, string> = {
  en_turno: 'text-emerald-600 dark:text-emerald-400',
  sin_confirmar: 'text-amber-600 dark:text-amber-400',
  offline: 'text-red-500 dark:text-red-400',
};

type Presencia = { isOnline?: boolean; lastSeen?: { toMillis(): number } | null; shiftId?: string };

/** `turno` = false para técnicos: no trabajan por turnos, solo interesa si están conectados. */
function PresenceDot({ user, turno = true }: { user: Presencia; turno?: boolean }) {
  const estado: EstadoPresencia = turno
    ? estadoPresencia(user)
    : (isOnlineNow(user) ? 'en_turno' : 'offline');
  return (
    <span
      title={turno ? ETIQUETA_PRESENCIA[estado] : (estado === 'en_turno' ? 'En línea' : 'Desconectado')}
      className={`w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white dark:ring-slate-900 ${COLOR_PRESENCIA[estado]}`}
    />
  );
}

/** Estado del operador con su turno: en turno / sesión sin confirmar / desconectado. */
function EstadoTurno({ user }: { user: Presencia }) {
  const estado = estadoPresencia(user);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${TEXTO_PRESENCIA[estado]}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${COLOR_PRESENCIA[estado]}`} />
      {ETIQUETA_PRESENCIA[estado]}
    </span>
  );
}

interface Condo { id: string; name: string; }

const selectClass =
  'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';

// ─── component ────────────────────────────────────────────────────────────────

const Operators = () => {
  const { profile } = useAuth();
  const [operators, setOperators]     = useState<Operator[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [condos, setCondos]           = useState<Condo[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [savingTech, setSavingTech]   = useState(false);
  const [activeTab, setActiveTab]     = useState<'operators' | 'technicians'>('operators');

  const [showAddModal, setShowAddModal]         = useState(false);
  const [editingOperator, setEditingOperator]   = useState<Operator | null>(null);
  const [deletingOperator, setDeletingOperator] = useState<Operator | null>(null);
  const [showTechModal, setShowTechModal]       = useState(false);
  const [editingTech, setEditingTech]           = useState<any | null>(null);
  const [deletingTech, setDeletingTech]         = useState<any | null>(null);

  const [formData, setFormData] = useState({
    name: '', role: 'Operador Principal',
    status: 'active' as Operator['status'],
    shift: 'Día', email: '', phone: '', password: '',
    activeAlerts: 0, assignment: [] as string[],
  });
  const [showPassword, setShowPassword] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [techForm, setTechForm] = useState({
    name: '', email: '', phone: '', specialty: '',
    status: 'active' as 'active' | 'inactive',
    assignment: [] as string[],
  });

  const canManage = profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'administrador';

  // ── data ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), (snap) => {
      setCondos(snap.docs.map(d => ({ id: d.id, name: d.data().name || 'Sin nombre' })));
    });

    if (!profile) return () => condosUnsub();

    let opUnsub: () => void;
    if (profile.role === 'super_admin') {
      opUnsub = onSnapshot(
        query(collection(db, 'users'), where('role', '==', 'operator')),
        (snap) => { setOperators(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Operator[]); setLoading(false); },
        (err) => { handleFirestoreError(err, OperationType.LIST, 'users'); setLoading(false); }
      );
    } else if (profile.condoId) {
      opUnsub = onSnapshot(
        query(collection(db, 'users'), where('role', '==', 'operator'), where('condoId', '==', profile.condoId)),
        (snap) => { setOperators(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Operator[]); setLoading(false); },
        (err) => { handleFirestoreError(err, OperationType.LIST, 'users'); setLoading(false); }
      );
    } else {
      setLoading(false);
      return () => condosUnsub();
    }

    return () => { condosUnsub(); opUnsub?.(); };
  }, [profile?.condoId, profile?.role]);

  useEffect(() => {
    if (!profile) return;
    return onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'technician')),
      (snap) => {
        let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (profile.role !== 'super_admin' && profile.condoId) {
          data = data.filter((t: any) =>
            t.assignment?.includes('all') ||
            t.assignment?.includes(profile.condoId) ||
            t.condoId === profile.condoId
          );
        }
        setTechnicians(data);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );
  }, [profile?.role, profile?.condoId]);

  // ── handlers ────────────────────────────────────────────────────────────────

  const handleOpenAdd = () => {
    setEditingOperator(null);
    setSaveError('');
    setFormData({
      name: '', role: 'Operador Principal', status: 'active',
      shift: 'Día', email: '', phone: '', password: '', activeAlerts: 0,
      assignment: profile?.condoId ? [profile.condoId] : [],
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (op: Operator) => {
    setEditingOperator(op);
    setSaveError('');
    setFormData({
      name: op.name, role: op.role, status: op.status, shift: op.shift,
      email: op.email || '', phone: op.phone || '', password: '',
      activeAlerts: op.activeAlerts,
      assignment: op.condoScope === 'all' ? ['all'] : (op.condoIds || [op.condoId]),
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSaveError('');

    const isAll = formData.assignment.includes('all');
    const selectedCondoIds = isAll ? condos.map(c => c.id) : formData.assignment;
    const primaryCondoId = isAll
      ? (profile.condoId || selectedCondoIds[0] || 'global')
      : (formData.assignment[0] || profile.condoId || 'global');
    const finalCondoId   = isAll ? (profile.condoId || 'all') : primaryCondoId;
    const finalCondoName = isAll
      ? 'Todos'
      : condos.filter(c => formData.assignment.includes(c.id)).map(c => c.name).join(', ') || profile.condoName || 'Condominio';

    const usersData = {
      name: formData.name, role: 'operator', jobTitle: formData.role,
      shift: formData.shift, email: formData.email, phone: formData.phone,
      activeAlerts: formData.activeAlerts, status: formData.status,
      condoId: finalCondoId, condoIds: selectedCondoIds,
      condoName: finalCondoName,
      condoScope: isAll ? 'all' : (formData.assignment.length > 1 ? 'multiple' : 'single'),
      updatedAt: Timestamp.now(),
    };

    try {
      if (editingOperator) {
        const cleanData = Object.fromEntries(
          Object.entries(usersData).filter(([_, v]) => v !== undefined)
        );
        await updateDoc(doc(db, 'users', editingOperator.id), cleanData);
        if (formData.password && editingOperator.uid) {
          const pwRes = await authedFetch('/api/users/update-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: editingOperator.uid, password: formData.password }),
          });
          if (!pwRes.ok) {
            const pwData = await pwRes.json();
            setSaveError(pwData.error || 'Error al actualizar contraseña');
            setSaving(false);
            return;
          }
        }
      } else {
        const res = await authedFetch('/api/users/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            email: formData.email,
            password: formData.password,
            role: 'operator',
            condoId: finalCondoId,
            condoName: finalCondoName,
            jobTitle: formData.role,
            shift: formData.shift,
            phone: formData.phone,
            status: formData.status,
            condoIds: selectedCondoIds.filter(Boolean),
            condoScope: isAll ? 'all' : (formData.assignment.length > 1 ? 'multiple' : 'single'),
          }),
        });
        const data = await res.json();
        if (!res.ok) { 
          setSaveError(data.error || 'Error al crear operador'); 
          setSaving(false); 
          return; 
        }
      }
      setShowAddModal(false); 
      setEditingOperator(null);
    } catch (err: any) {
      console.error('Error saving operator:', err);
      setSaveError(err.message || 'Error al guardar los cambios. Por favor revisa los datos.');
      // No lanzamos el error de nuevo para que no se pierda el estado de la UI
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingOperator) return;
    try {
      await deleteDoc(doc(db, 'users', deletingOperator.id));
      setDeletingOperator(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'users');
    }
  };

  const handleSaveTech = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingTech(true);
    try {
      const isAll = techForm.assignment.includes('all');
      const techData = {
        ...techForm, role: 'technician',
        condoScope: isAll ? 'all' : (techForm.assignment.length > 1 ? 'multiple' : 'single'),
        condoId:    isAll ? '' : (techForm.assignment[0] || ''),
        condoIds:   isAll ? condos.map(c => c.id) : techForm.assignment,
        updatedAt:  Timestamp.now(),
      };
      if (editingTech) {
        await updateDoc(doc(db, 'users', editingTech.id), techData);
      } else {
        await addDoc(collection(db, 'users'), { ...techData, uid: '', createdAt: Timestamp.now() });
      }
      setShowTechModal(false); setEditingTech(null);
      setTechForm({ name: '', email: '', phone: '', specialty: '', status: 'active', assignment: [] });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'users');
    } finally {
      setSavingTech(false);
    }
  };

  const handleDeleteTech = async () => {
    if (!deletingTech) return;
    try {
      await deleteDoc(doc(db, 'users', deletingTech.id));
      setDeletingTech(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'users');
    }
  };

  const openAddTech = () => {
    setEditingTech(null);
    setTechForm({
      name: '', email: '', phone: '', specialty: '', status: 'active',
      assignment: profile?.condoScope === 'all' ? [] : (profile?.condoId ? [profile.condoId] : []),
    });
    setShowTechModal(true);
  };

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <PageHeader
        eyebrow="Personal"
        title="Operadores"
        description="Gestiona el personal encargado de la vigilancia y control de accesos."
        icon={Shield}
        actions={
          <>
            {activeTab === 'technicians' && canManage && (
              <Button variant="secondary" icon={UserPlus} onClick={openAddTech}>
                Nuevo Técnico
              </Button>
            )}
            {activeTab === 'operators' && canManage && (
              <Button icon={Plus} onClick={handleOpenAdd}>
                Nuevo Operador
              </Button>
            )}
          </>
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('operators')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer',
            activeTab === 'operators'
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
              : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-blue-500/50'
          )}
        >
          <ShieldCheck size={15} />
          Operadores
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded-md font-bold',
            activeTab === 'operators' ? 'bg-white/20' : 'bg-slate-100 dark:bg-white/10'
          )}>
            {operators.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('technicians')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer',
            activeTab === 'technicians'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
              : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-indigo-500/50'
          )}
        >
          <Wrench size={15} />
          Técnicos
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded-md font-bold',
            activeTab === 'technicians' ? 'bg-white/20' : 'bg-slate-100 dark:bg-white/10'
          )}>
            {technicians.length}
          </span>
        </button>
      </div>

      {/* ── Operators grid ─────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTab === 'operators' && (
          <motion.div key="operators" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {operators.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="Sin operadores registrados"
                description="Agrega el primer operador de portería."
                action={canManage && <Button icon={Plus} onClick={handleOpenAdd}>Nuevo Operador</Button>}
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Operador</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Turno</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Alcance</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Teléfono</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Email</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Estado</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      <AnimatePresence mode="popLayout">
                        {operators.map(op => (
                          <motion.tr
                            key={op.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                          >
                            {/* Nombre + cargo */}
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="relative w-8 h-8 shrink-0">
                                  <div className="w-8 h-8 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                    <ShieldCheck size={15} strokeWidth={2} />
                                  </div>
                                  <span className="absolute -bottom-0.5 -right-0.5">
                                    <PresenceDot user={op} />
                                  </span>
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-900 dark:text-slate-100">{op.name}</p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">{(op as any).jobTitle || op.role}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">{op.shift || '—'}</td>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">
                              {op.condoScope === 'all' ? 'Global' : op.condoScope === 'multiple' ? 'Multi' : 'Local'}
                            </td>
                            <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 text-xs">{op.phone || '—'}</td>
                            <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 text-xs">{op.email || '—'}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex flex-col gap-1.5">
                                <EstadoTurno user={op} />
                                <Badge variant={op.status === 'active' ? 'success' : 'muted'}>
                                  {op.status === 'active' ? 'Activo' : 'Inactivo'}
                                </Badge>
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center justify-end gap-1.5">
                                {op.email && (
                                  <a href={`mailto:${op.email}`} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors" title="Enviar email">
                                    <Mail size={14} />
                                  </a>
                                )}
                                {canManage && (
                                  <>
                                    <button onClick={() => handleOpenEdit(op)} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer" title="Editar">
                                      <Edit2 size={14} />
                                    </button>
                                    <button onClick={() => setDeletingOperator(op)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer" title="Eliminar">
                                      <Trash2 size={14} />
                                    </button>
                                  </>
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
          </motion.div>
        )}

        {/* ── Technicians grid ─────────────────────────────────────────────── */}
        {activeTab === 'technicians' && (
          <motion.div key="technicians" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {technicians.length === 0 ? (
              <EmptyState
                icon={Wrench}
                title="Sin técnicos asignados"
                description="Agrega el primer técnico de mantenimiento."
                action={canManage && <Button icon={UserPlus} onClick={openAddTech}>Nuevo Técnico</Button>}
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Técnico</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Asignaciones</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Teléfono</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Email</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Estado</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      <AnimatePresence mode="popLayout">
                        {technicians.map(tech => (
                          <motion.tr
                            key={tech.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                          >
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="relative w-8 h-8 shrink-0">
                                  <div className="w-8 h-8 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                                    <Wrench size={15} strokeWidth={2} />
                                  </div>
                                  <span className="absolute -bottom-0.5 -right-0.5">
                                    <PresenceDot user={tech} turno={false} />
                                  </span>
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-900 dark:text-slate-100">{tech.name}</p>
                                  <p className="text-xs text-indigo-600 dark:text-indigo-400">{tech.specialty || '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex flex-wrap gap-1">
                                {tech.assignment?.includes('all') ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                                    <Globe size={10} /> Global
                                  </span>
                                ) : (
                                  tech.assignment?.map((id: string) => (
                                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400">
                                      <Building2 size={10} />
                                      {condos.find(c => c.id === id)?.name || 'Condominio'}
                                    </span>
                                  ))
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 text-xs">{tech.phone || '—'}</td>
                            <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 text-xs">{tech.email || '—'}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex flex-col gap-1.5">
                                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isOnlineNow(tech) ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${isOnlineNow(tech) ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                  {isOnlineNow(tech) ? 'En línea' : 'Desconectado'}
                                </span>
                                <Badge variant={tech.status === 'active' ? 'success' : 'muted'}>
                                  {tech.status === 'active' ? 'Activo' : 'Inactivo'}
                                </Badge>
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              {canManage && (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => {
                                      setEditingTech(tech);
                                      setTechForm({ name: tech.name || '', email: tech.email || '', phone: tech.phone || '', specialty: tech.specialty || '', status: tech.status || 'active', assignment: tech.assignment || [] });
                                      setShowTechModal(true);
                                    }}
                                    className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer"
                                    title="Editar"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                  <button
                                    onClick={() => setDeletingTech(tech)}
                                    className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                                    title="Eliminar"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add / Edit Operator Modal ───────────────────────────────────────── */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); setEditingOperator(null); }}
        title={editingOperator ? 'Editar Operador' : 'Nuevo Operador'}
        icon={ShieldCheck}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Nombre Completo" required htmlFor="op-name">
            <Input id="op-name" required value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: Marta Gómez" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Rol" htmlFor="op-role">
              <select id="op-role" value={formData.role}
                onChange={e => setFormData({ ...formData, role: e.target.value })}
                className={selectClass}>
                <option value="Operador Principal">Operador Principal</option>
                <option value="Operador Nocturno">Operador Nocturno</option>
                <option value="Operador de Apoyo">Operador de Apoyo</option>
              </select>
            </Field>
            <Field label="Turno" htmlFor="op-shift">
              <select id="op-shift" value={formData.shift}
                onChange={e => setFormData({ ...formData, shift: e.target.value })}
                className={selectClass}>
                <option value="Día">Día</option>
                <option value="Noche">Noche</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Teléfono" htmlFor="op-phone">
              <Input id="op-phone" type="tel" value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+56 9 …" />
            </Field>
            <Field label="Estado" htmlFor="op-status">
              <select id="op-status" value={formData.status}
                onChange={e => setFormData({ ...formData, status: e.target.value as Operator['status'] })}
                className={selectClass}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </Field>
          </div>

          <Field label="Email" htmlFor="op-email">
            <Input id="op-email" type="email" value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              placeholder="operador@ejemplo.com" />
          </Field>

          <Field
            label={editingOperator ? 'Nueva contraseña (opcional)' : 'Contraseña'}
            hint="Mínimo 6 caracteres"
            required={!editingOperator}
            htmlFor="op-pass"
          >
            <div className="relative">
              <Input id="op-pass" required={!editingOperator}
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                placeholder={editingOperator ? 'Dejar vacío para no cambiar' : '••••••••'}
                className="pr-10" />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

          <Field label="Condominios asignados">
            <div className="space-y-2 max-h-40 overflow-y-auto bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl p-3">
              <label className="flex items-center gap-2.5 cursor-pointer py-1">
                <input type="checkbox" checked={formData.assignment.includes('all')}
                  onChange={e => setFormData({ ...formData, assignment: e.target.checked ? ['all'] : [] })}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 accent-blue-600" />
                <Globe size={13} className="text-blue-500" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Todos los condominios</span>
              </label>
              <div className="h-px bg-slate-100 dark:bg-white/5" />
              {condos.map(c => (
                <label key={c.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input type="checkbox" disabled={formData.assignment.includes('all')}
                    checked={formData.assignment.includes(c.id)}
                    onChange={e => {
                      let next = [...formData.assignment].filter(x => x !== 'all');
                      setFormData({ ...formData, assignment: e.target.checked ? [...next, c.id] : next.filter(x => x !== c.id) });
                    }}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 accent-blue-600 disabled:opacity-40" />
                  <Building2 size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className={cn('text-sm text-slate-700 dark:text-slate-300', formData.assignment.includes('all') && 'opacity-40')}>
                    {c.name}
                  </span>
                </label>
              ))}
            </div>
          </Field>

          {saveError && (
            <p className="text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={() => { setShowAddModal(false); setEditingOperator(null); }}>Cancelar</Button>
            <Button type="submit" loading={saving}>{editingOperator ? 'Guardar Cambios' : 'Crear Operador'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Operator Modal ───────────────────────────────────────────── */}
      <Modal open={!!deletingOperator} onClose={() => setDeletingOperator(null)} size="sm">
        <div className="text-center space-y-4 pt-2">
          <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto">
            <Trash2 size={22} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Eliminar operador?</h2>
            <p className="subtle mt-1">
              Se eliminará a <span className="font-semibold text-slate-900 dark:text-white">"{deletingOperator?.name}"</span> permanentemente.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setDeletingOperator(null)}>Cancelar</Button>
            <Button variant="danger" fullWidth onClick={handleDelete}>Eliminar</Button>
          </div>
        </div>
      </Modal>

      {/* ── Add / Edit Technician Modal ─────────────────────────────────────── */}
      <Modal
        open={showTechModal}
        onClose={() => { setShowTechModal(false); setEditingTech(null); }}
        title={editingTech ? 'Editar Técnico' : 'Nuevo Técnico'}
        description="Será notificado ante incidentes en sus condominios asignados."
        icon={Wrench}
        size="md"
      >
        <form onSubmit={handleSaveTech} className="space-y-4">
          <Field label="Nombre completo" required htmlFor="tech-name">
            <Input id="tech-name" required value={techForm.name}
              onChange={e => setTechForm({ ...techForm, name: e.target.value })}
              placeholder="Juan Pérez" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Especialidad" required htmlFor="tech-spec">
              <Input id="tech-spec" required value={techForm.specialty}
                onChange={e => setTechForm({ ...techForm, specialty: e.target.value })}
                placeholder="Redes / CCTV" />
            </Field>
            <Field label="Estado" htmlFor="tech-status">
              <select id="tech-status" value={techForm.status}
                onChange={e => setTechForm({ ...techForm, status: e.target.value as 'active' | 'inactive' })}
                className={selectClass}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Teléfono" htmlFor="tech-phone">
              <Input id="tech-phone" type="tel" value={techForm.phone}
                onChange={e => setTechForm({ ...techForm, phone: e.target.value })}
                placeholder="+56 9 …" />
            </Field>
            <Field label="Email" required htmlFor="tech-email">
              <Input id="tech-email" type="email" required value={techForm.email}
                onChange={e => setTechForm({ ...techForm, email: e.target.value })}
                placeholder="tecnico@ejemplo.com" />
            </Field>
          </div>

          <Field label="Condominios asignados">
            <div className="space-y-2 max-h-40 overflow-y-auto bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl p-3">
              <label className="flex items-center gap-2.5 cursor-pointer py-1">
                <input type="checkbox" checked={techForm.assignment.includes('all')}
                  onChange={e => setTechForm({ ...techForm, assignment: e.target.checked ? ['all'] : [] })}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 accent-indigo-600" />
                <Globe size={13} className="text-indigo-500" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Todos los condominios</span>
              </label>
              <div className="h-px bg-slate-100 dark:bg-white/5" />
              {condos.map(c => (
                <label key={c.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input type="checkbox" disabled={techForm.assignment.includes('all')}
                    checked={techForm.assignment.includes(c.id)}
                    onChange={e => {
                      const next = e.target.checked
                        ? [...techForm.assignment.filter(x => x !== 'all'), c.id]
                        : techForm.assignment.filter(x => x !== c.id);
                      setTechForm({ ...techForm, assignment: next });
                    }}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 accent-indigo-600 disabled:opacity-40" />
                  <Building2 size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className={cn('text-sm text-slate-700 dark:text-slate-300', techForm.assignment.includes('all') && 'opacity-40')}>
                    {c.name}
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={() => { setShowTechModal(false); setEditingTech(null); }}>Cancelar</Button>
            <Button type="submit" loading={savingTech}>{editingTech ? 'Guardar Cambios' : 'Crear Técnico'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Technician Modal ─────────────────────────────────────────── */}
      <Modal open={!!deletingTech} onClose={() => setDeletingTech(null)} size="sm">
        <div className="text-center space-y-4 pt-2">
          <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto">
            <Trash2 size={22} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Eliminar técnico?</h2>
            <p className="subtle mt-1">
              Se eliminará a <span className="font-semibold text-slate-900 dark:text-white">"{deletingTech?.name}"</span> permanentemente.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setDeletingTech(null)}>Cancelar</Button>
            <Button variant="danger" fullWidth onClick={handleDeleteTech}>Eliminar</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
};

export default Operators;
