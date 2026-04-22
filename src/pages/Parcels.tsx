import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, collectionGroup, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, Timestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Archive, Plus, Clock, CheckCircle2, Building2, History, X, User,
  Package, ChevronDown, Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, sendNotification } from '../lib/utils';
import { api } from '../lib/apiBase';
import { Button, Card, PageHeader, Field, Input, Modal, Badge, EmptyState, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

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
  courier?: string;
}

function formatTime(ts: any) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resident View — simple card list, only their parcels
// ─────────────────────────────────────────────────────────────────────────────
function ResidentView({ parcels, loading }: { parcels: Parcel[]; loading: boolean }) {
  const pending = parcels.filter(p => p.status === 'pending');
  const pickedUp = parcels.filter(p => p.status === 'picked_up');

  if (loading && !parcels.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <PageHeader
        icon={Package}
        title="Mis Encomiendas"
        description="Paquetes y envíos recibidos en portería para tu unidad."
      />

      {/* Pending alert banner */}
      <AnimatePresence>
        {pending.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20"
          >
            <Archive size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Tienes{' '}
              <strong>{pending.length} encomienda{pending.length > 1 ? 's' : ''}</strong>{' '}
              esperando en portería. Coordina el retiro con conserjería.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {parcels.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Sin encomiendas"
          description="Aún no tienes paquetes registrados en portería para tu unidad."
        />
      ) : (
        <div className="space-y-3">
          {/* Pending parcels */}
          {pending.map(parcel => (
            <Card key={parcel.id} padding="md" className="border-l-4 border-l-amber-400 dark:border-l-amber-500">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Archive size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {parcel.courier ? `Paquete de ${parcel.courier}` : 'Encomienda en portería'}
                    </p>
                    <Badge variant="warn">Pendiente</Badge>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Clock size={12} className="shrink-0" />
                    Llegó el {formatTime(parcel.arrivedAt)}
                  </p>
                  {parcel.condoName && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5 mt-0.5">
                      <Building2 size={11} className="shrink-0" />
                      {parcel.condoName}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}

          {/* History */}
          {pickedUp.length > 0 && (
            <>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 pt-2 pl-1">Historial</p>
              {pickedUp.map(parcel => (
                <Card key={parcel.id} padding="md" className="opacity-60">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="font-semibold text-slate-700 dark:text-slate-300">
                          {parcel.courier ? `Paquete de ${parcel.courier}` : 'Encomienda retirada'}
                        </p>
                        <Badge variant="success">Retirada</Badge>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="shrink-0" />
                        Retirada el {formatTime(parcel.pickedUpAt)}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
const Parcels = () => {
  const { profile, user } = useAuth();
  const isResident = profile?.role === 'resident';
  const isSuperAdmin = profile?.role === 'super_admin' || profile?.condoScope === 'all';
  const isMultiCondo = !isSuperAdmin && profile?.condoScope === 'multiple' && (profile?.condoIds?.length ?? 0) > 0;
  const canDelete = profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'administrador';
  const showCondoSelector = isSuperAdmin || isMultiCondo;

  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [residents, setResidents] = useState<any[]>([]);
  const [condos, setCondos] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Staff-only state
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'picked_up'>('pending');
  const [filterCondo, setFilterCondo] = useState<string>('');   // '' = all condos (super_admin)
  const [historyDate, setHistoryDate] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ residentName: '', residentUserId: '', unit: '', condoId: '', courier: '' });
  const [pickingUp, setPickingUp] = useState<string | null>(null);
  const [deletingParcel, setDeletingParcel] = useState<Parcel | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Condos visible in the form dropdown:
  // - super_admin: all condos
  // - multi-condo operator: only their assigned condos
  const formCondos = isSuperAdmin
    ? condos
    : isMultiCondo
      ? condos.filter(c => (profile?.condoIds ?? []).includes(c.id))
      : [];

  // ── Load condos ────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'condos'), snap => {
      const list = snap.docs.map(d => ({
        id: d.id,
        name: d.data().name as string,
        unitNames: d.data().unitNames as string[] | undefined
      }));
      setCondos(list);
      // Always default to a specific condo for staff, exception: super_admin starts with Todos
      if (!isResident && !filterCondo && !isSuperAdmin) {
        setFilterCondo(profile?.condoId || profile?.condoIds?.[0] || list[0]?.id || '');
      }
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.condoId, isSuperAdmin]);

  // ── Load parcels (resident) ────────────────────────────────────────────────
  useEffect(() => {
    if (!isResident || !profile?.condoId || !user) return;
    const q = query(
      collection(db, `condos/${profile.condoId}/parcels`),
      where('residentUserId', '==', user.uid),
    );
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Parcel[];
      list.sort((a, b) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
      setParcels(list);
      setLoading(false);
    });
    return () => unsub();
  }, [isResident, profile?.condoId, user]);

  // ── Load parcels (staff) ───────────────────────────────────────────────────
  useEffect(() => {
    if (isResident || !profile || !user) return;
    const activeCondoId = filterCondo || (!isSuperAdmin ? profile.condoId : '');
    
    // Fallback: If we don't have a condoId ('Todos'), we must query all condos individually
    // because collectionGroup('parcels') is currently blocked by firestore.rules that we can't deploy.
    if (activeCondoId) {
      const q = collection(db, `condos/${activeCondoId}/parcels`);
      const unsub = onSnapshot(q, (snap: any) => {
        const list = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as Parcel[];
        list.sort((a, b) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
        setParcels(list);
        setLoading(false);
      }, (err: any) => {
        handleFirestoreError(err, OperationType.LIST, 'parcels');
        setLoading(false);
      });
      return () => unsub();
    } else {
      // 'Todos' option - create a listener for each condo
      if (condos.length === 0) {
        setParcels([]);
        setLoading(false);
        return;
      }
      const unsubs: (() => void)[] = [];
      const allParcels: Record<string, Parcel[]> = {};

      condos.forEach(condo => {
        const q = collection(db, `condos/${condo.id}/parcels`);
        const u = onSnapshot(q, snap => {
          allParcels[condo.id] = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Parcel[];
          
          // Re-flatten and sort
          const combined = Object.values(allParcels).flat();
          combined.sort((a, b) => (b.arrivedAt?.seconds ?? 0) - (a.arrivedAt?.seconds ?? 0));
          setParcels(combined);
          setLoading(false);
        }, err => {
          console.warn(`Failed reading parcels for ${condo.id}`, err);
        });
        unsubs.push(u);
      });

      return () => unsubs.forEach(u => u());
    }
  }, [isResident, filterCondo, profile, user, isSuperAdmin, condos]);

  // ── Load residents for form ────────────────────────────────────────────────
  useEffect(() => {
    if (isResident) return;
    const condoId = form.condoId || filterCondo || profile?.condoId;
    if (!condoId) return;
    const q = query(collection(db, 'users'), where('role', '==', 'resident'), where('condoId', '==', condoId));
    const unsub = onSnapshot(q, snap => {
      setResidents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [isResident, form.condoId, filterCondo, profile?.condoId]);

  const handleOpenForm = () => {
    const defaultCondoId = filterCondo || profile?.condoId || profile?.condoIds?.[0] || '';
    setForm({ residentName: '', residentUserId: '', unit: '', condoId: defaultCondoId, courier: '' });
    setShowForm(true);
  };

  const handleResidentSelect = (residentId: string) => {
    if (!residentId) { setForm(f => ({ ...f, residentName: '', residentUserId: '', unit: '' })); return; }
    const r = residents.find(r => r.id === residentId);
    if (r) setForm(f => ({ ...f, residentName: r.name || '', residentUserId: r.id, unit: r.unit || '' }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    setSaving(true);
    const condoId = form.condoId || filterCondo || profile.condoId || '';
    const condo = condos.find(c => c.id === condoId);
    try {
      await addDoc(collection(db, `condos/${condoId}/parcels`), {
        condoId,
        condoName: condo?.name || profile.condoName || '',
        residentName: form.residentName,
        residentUserId: form.residentUserId || '',
        unit: form.unit,
        status: 'pending',
        arrivedAt: Timestamp.now(),
        pickedUpAt: null,
        createdBy: user.uid,
        createdByName: profile.name || user.email || 'Operador',
        courier: form.courier,
      });

      if (form.residentUserId) {
        await sendNotification(
          form.residentUserId,
          'Encomienda Recibida',
          `Tienes una encomienda esperando en portería. Unidad ${form.unit}. Coordina su retiro.`,
          'info',
          '/parcels'
        );
      }

      // Door open by condo
      const condoName = (condo?.name || '').toLowerCase();
      let doorChannel = '';
      if (condoName.includes('valenzuela')) doorChannel = '1000649$7$0$1';
      else if (condoName.includes('cantaro') || condoName.includes('cántaro')) doorChannel = '1000736$7$0$0';
      if (doorChannel) {
        fetch(api('/api/door/open'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: doorChannel }),
        }).catch(() => {});
      }

      setShowForm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'parcels');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteParcel = async () => {
    if (!deletingParcel) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, `condos/${deletingParcel.condoId}/parcels`, deletingParcel.id));
      setDeletingParcel(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'parcels');
    } finally {
      setDeleting(false);
    }
  };

  const handlePickup = async (parcel: Parcel) => {
    setPickingUp(parcel.id);
    try {
      await updateDoc(doc(db, `condos/${parcel.condoId}/parcels`, parcel.id), {
        status: 'picked_up',
        pickedUpAt: Timestamp.now(),
        pickedUpBy: user?.uid || '',
        pickedUpByName: profile?.name || user?.email || 'Operador',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'parcels');
    } finally {
      setPickingUp(null);
    }
  };

  // ── Resident: delegate to simple view ─────────────────────────────────────
  if (isResident) {
    return <ResidentView parcels={parcels} loading={loading} />;
  }

  // ── Staff view ─────────────────────────────────────────────────────────────
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
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Archive}
        title="Encomiendas"
        description={
          pendingCount > 0
            ? `${pendingCount} encomienda${pendingCount > 1 ? 's' : ''} pendiente${pendingCount > 1 ? 's' : ''} de retiro.`
            : 'Registro y gestión de paquetes en portería.'
        }
        actions={
          <Button icon={Plus} onClick={handleOpenForm}>
            Nueva Encomienda
          </Button>
        }
      />

      {/* Condo filter pills */}
      {showCondoSelector && formCondos.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Condominio:</span>
          <div className="flex gap-2 flex-wrap">
            {/* "Todos" only available for super_admin */}
            {isSuperAdmin && (
              <button
                onClick={() => setFilterCondo('')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  filterCondo === ''
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                )}
              >
                Todos
              </button>
            )}
            {formCondos.map(c => (
              <button
                key={c.id}
                onClick={() => setFilterCondo(c.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  filterCondo === c.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(['pending', 'all', 'picked_up'] as const).map(s => {
          const count = s === 'all' ? parcels.length : parcels.filter(p => p.status === s).length;
          const labels = { pending: 'Pendientes', all: 'Todas', picked_up: 'Retiradas' };
          const activeColor = {
            pending: 'bg-amber-500 text-white',
            all: 'bg-blue-600 text-white',
            picked_up: 'bg-emerald-600 text-white',
          }[s];
          return (
            <button
              key={s}
              onClick={() => { setFilterStatus(s); if (s !== 'picked_up') setHistoryDate(''); }}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                filterStatus === s
                  ? activeColor
                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
              )}
            >
              {labels[s]} ({count})
            </button>
          );
        })}

        {/* Date filter for Retiradas */}
        {filterStatus === 'picked_up' && (
          <div className="flex items-center gap-2 ml-1">
            <History size={13} className="text-slate-400" />
            <Input
              type="date"
              value={historyDate}
              onChange={e => setHistoryDate(e.target.value)}
              className="w-auto py-1.5 px-3 text-xs"
            />
            {historyDate && (
              <button
                onClick={() => setHistoryDate('')}
                aria-label="Limpiar fecha"
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Sin encomiendas"
          description={filterStatus !== 'all' ? 'No hay encomiendas en este estado.' : 'No hay encomiendas registradas.'}
          action={
            <Button icon={Plus} size="sm" onClick={handleOpenForm}>
              Registrar encomienda
            </Button>
          }
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Residente</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Unidad</th>
                  {(isSuperAdmin || !filterCondo) && (
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Condominio</th>
                  )}
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Servicio</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Llegada</th>
                  {filterStatus !== 'pending' && (
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Retiro</th>
                  )}
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Estado</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                <AnimatePresence mode="popLayout">
                  {filtered.map(parcel => (
                    <motion.tr
                      key={parcel.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Residente */}
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-slate-900 dark:text-white">{parcel.residentName}</span>
                      </td>

                      {/* Unidad */}
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-slate-600 dark:text-slate-300">
                          {parcel.unit}
                        </span>
                      </td>

                      {/* Condominio */}
                      {(isSuperAdmin || !filterCondo) && (
                        <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400">
                          {parcel.condoName}
                        </td>
                      )}

                      {/* Servicio de Entrega */}
                      <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 font-medium">
                        {parcel.courier || '—'}
                      </td>

                      {/* Llegada */}
                      <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatTime(parcel.arrivedAt)}
                      </td>

                      {/* Retiro */}
                      {filterStatus !== 'pending' && (
                        <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formatTime(parcel.pickedUpAt)}
                        </td>
                      )}

                      {/* Estado */}
                      <td className="px-5 py-3.5">
                        {parcel.status === 'pending'
                          ? <Badge variant="warn">Pendiente</Badge>
                          : <Badge variant="success">Retirada</Badge>
                        }
                      </td>

                      {/* Acción */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {parcel.status === 'pending' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={CheckCircle2}
                              loading={pickingUp === parcel.id}
                              onClick={() => handlePickup(parcel)}
                            >
                              Marcar retirada
                            </Button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => setDeletingParcel(parcel)}
                              title="Eliminar registro"
                              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
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

      {/* New parcel modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Registrar Encomienda"
        icon={Archive}
        size="sm"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {/* Condo selector — super_admin and multi-condo operators */}
          {showCondoSelector && (
            <Field label="Condominio" htmlFor="parcel-condo" required>
              <div className="relative">
                <select
                  id="parcel-condo"
                  required
                  value={form.condoId}
                  onChange={e => {
                    setForm(f => ({ ...f, condoId: e.target.value, residentName: '', residentUserId: '', unit: '' }));
                  }}
                  className={cn(
                    'block w-full bg-white dark:bg-slate-950/50',
                    'border border-slate-200 dark:border-white/10 rounded-xl',
                    'px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100',
                    'outline-none transition focus:border-blue-600 dark:focus:border-blue-500',
                    'focus:ring-2 focus:ring-blue-500/20 cursor-pointer appearance-none',
                  )}
                >
                  <option value="">— Seleccionar condominio —</option>
                  {formCondos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </Field>
          )}

          {/* Unit dropdown */}
          <Field label="Unidad / Departamento" htmlFor="parcel-unit" required>
            <div className="relative">
              <select
                id="parcel-unit"
                required
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value, residentUserId: '', residentName: '' }))}
                className={cn(
                  'block w-full bg-white dark:bg-slate-950/50',
                  'border border-slate-200 dark:border-white/10 rounded-xl',
                  'px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100',
                  'outline-none transition focus:border-blue-600 dark:focus:border-blue-500',
                  'focus:ring-2 focus:ring-blue-500/20 cursor-pointer appearance-none',
                )}
              >
                <option value="">— Seleccionar unidad —</option>
                {Array.from(new Set([
                  ...(condos.find(c => c.id === (form.condoId || filterCondo || profile?.condoId))?.unitNames || []),
                  ...residents.map(r => r.unit).filter(Boolean)
                ])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          {/* Resident dropdown */}
          <Field label="Residente destinatario (Opcional)" htmlFor="parcel-resident">
            <div className="relative">
              <select
                id="parcel-resident"
                value={form.residentUserId}
                disabled={!form.unit || residents.filter(r => r.unit === form.unit).length === 0}
                onChange={e => handleResidentSelect(e.target.value)}
                className={cn(
                  'block w-full bg-white dark:bg-slate-950/50',
                  'border border-slate-200 dark:border-white/10 rounded-xl',
                  'px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100',
                  'outline-none transition focus:border-blue-600 dark:focus:border-blue-500',
                  'focus:ring-2 focus:ring-blue-500/20 cursor-pointer appearance-none',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <option value="">— Seleccionar residente —</option>
                {residents
                  .filter(r => r.unit === form.unit)
                  .map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
              </select>
              <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          {/* Fallback Name if no resident selected */}
          {!form.residentUserId && (
            <Field label="Nombre del residente" htmlFor="parcel-name" required>
              <Input
                id="parcel-name"
                required
                type="text"
                value={form.residentName}
                onChange={e => setForm(f => ({ ...f, residentName: e.target.value }))}
                placeholder="Nombre completo"
              />
            </Field>
          )}

          {/* Courier Selector */}
          <Field label="Servicio de Encomienda" htmlFor="parcel-courier" required>
            <div className="relative">
              <select
                id="parcel-courier"
                required
                value={form.courier}
                onChange={e => setForm(f => ({ ...f, courier: e.target.value }))}
                className={cn(
                  'block w-full bg-white dark:bg-slate-950/50',
                  'border border-slate-200 dark:border-white/10 rounded-xl',
                  'px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100',
                  'outline-none transition focus:border-blue-600 dark:focus:border-blue-500',
                  'focus:ring-2 focus:ring-blue-500/20 cursor-pointer appearance-none',
                )}
              >
                <option value="">— Seleccionar servicio —</option>
                {['Blue Express', 'Correos de Chile', 'DHL', 'Falabella', 'Mercado Libre', 'Uber'].sort().map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          {/* Notification hint */}
          {form.residentUserId && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
              <User size={14} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Se notificará automáticamente a{' '}
                <strong className="text-blue-600 dark:text-blue-400">{form.residentName}</strong>{' '}
                sobre su encomienda.
              </p>
            </div>
          )}

          {/* Auto arrival time */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400">
            <Clock size={14} className="text-amber-500 shrink-0" />
            <span>Llegada: <strong className="text-slate-900 dark:text-white">{new Date().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong></span>
          </div>

          <Button
            type="submit"
            loading={saving}
            disabled={!form.residentName || !form.unit}
            fullWidth
            size="lg"
            className="mt-1"
          >
            Registrar Encomienda
          </Button>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!deletingParcel}
        onClose={() => { if (!deleting) setDeletingParcel(null); }}
        size="sm"
      >
        <div className="text-center space-y-4 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Trash2 size={24} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Eliminar encomienda?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Se eliminará el registro de{' '}
              <span className="font-semibold text-slate-900 dark:text-white">{deletingParcel?.residentName}</span>
              {deletingParcel?.unit ? ` — Unidad ${deletingParcel.unit}` : ''}. Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeletingParcel(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="danger" icon={Trash2} onClick={handleDeleteParcel} loading={deleting}>Eliminar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Parcels;
