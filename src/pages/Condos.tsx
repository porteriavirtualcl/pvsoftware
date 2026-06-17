import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Building2, Plus, MapPin, Users, Edit2, Trash2, Wifi, WifiOff,
  RefreshCw, CreditCard, X, Home,
} from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, addDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { handleFirestoreError, OperationType } from '../lib/utils';
import DahuaService, { DahuaChannel } from '../services/DahuaService';
import { Button, Card, PageHeader, Field, Input, Modal, Badge, EmptyState, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

interface Condo {
  id: string;
  name: string;
  address: string;
  residentsCount?: number;
  dahuaChannelIds?: string[];
  expensesEnabled?: boolean;
  unitNames?: string[];
}

const Condos = () => {
  const { profile } = useAuth();
  const [condos, setCondos]               = useState<Condo[]>([]);
  const [loading, setLoading]             = useState(true);
  const [showAddModal, setShowAddModal]   = useState(false);
  const [editingCondo, setEditingCondo]   = useState<Condo | null>(null);
  const [deletingCondo, setDeletingCondo] = useState<Condo | null>(null);
  const [formData, setFormData]           = useState({ name: '', address: '' });
  const [saving, setSaving]               = useState(false);
  const [deleting, setDeleting]           = useState(false);

  // Units config
  const [configuringUnitsCondo, setConfiguringUnitsCondo] = useState<Condo | null>(null);
  const [unitCount, setUnitCount] = useState<number>(0);
  const [unitPrefix, setUnitPrefix] = useState<string>('');
  const [unitNames, setUnitNames]   = useState<string[]>([]);
  const [savingUnits, setSavingUnits] = useState(false);

  // Dahua config
  const [dahuaConfigCondo, setDahuaConfigCondo] = useState<Condo | null>(null);
  const [discovered, setDiscovered]             = useState<DahuaChannel[]>([]);
  const [selectedIds, setSelectedIds]           = useState<Set<string>>(new Set());
  const [dahuaLoading, setDahuaLoading]         = useState(false);
  const [dahuaSaving, setDahuaSaving]           = useState(false);
  const [dahuaError, setDahuaError]             = useState<string | null>(null);

  const [residentsByCondo, setResidentsByCondo] = useState<Record<string, number>>({});

  useEffect(() => {
    const qCondos = query(collection(db, 'condos'));
    const unsubCondos = onSnapshot(qCondos, (snap) => {
      setCondos(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Condo[]);
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'condos'));

    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      const counts: Record<string, number> = {};
      snap.forEach(d => {
        const data = d.data();
        if (data.role === 'resident' || data.role === 'usuario') {
          if (data.condoId) counts[data.condoId] = (counts[data.condoId] || 0) + 1;
        }
      });
      setResidentsByCondo(counts);
    });

    return () => {
      unsubCondos();
      unsubUsers();
    };
  }, []);

  const handleOpenAdd = () => { setFormData({ name: '', address: '' }); setShowAddModal(true); };
  const handleOpenEdit = (condo: Condo) => { setEditingCondo(condo); setFormData({ name: condo.name, address: condo.address }); };

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
      setDahuaError((err as Error)?.message ?? 'Error al conectar con el Sistema de Portería Virtual');
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

  const handleToggleExpenses = async (condo: Condo) => {
    try {
      await updateDoc(doc(db, 'condos', condo.id), {
        expensesEnabled: !condo.expensesEnabled,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'condos');
    }
  };

  const handleConfigUnits = (condo: Condo) => {
    setConfiguringUnitsCondo(condo);
    const existing = condo.unitNames || [];
    setUnitCount(existing.length);
    setUnitNames(existing);
    setUnitPrefix('');
  };

  const handlePrefixChange = (newPrefix: string) => {
    const oldPrefix = unitPrefix;
    setUnitPrefix(newPrefix);
    
    setUnitNames(prevNames => prevNames.map(name => {
      let baseName = name;
      if (oldPrefix && name.startsWith(oldPrefix)) {
        baseName = name.slice(oldPrefix.length).trimStart();
      } else if (!oldPrefix && name.toLowerCase().startsWith('unidad')) {
        baseName = name.slice(6).trimStart();
      }
      return newPrefix ? `${newPrefix} ${baseName}` : baseName;
    }));
  };

  const handleUnitCountChange = (count: number) => {
    const validCount = Math.max(0, count);
    setUnitCount(validCount);
    const newNames = [...unitNames];
    if (validCount > newNames.length) {
      for (let i = newNames.length; i < validCount; i++) {
        newNames.push(unitPrefix ? `${unitPrefix} ${i + 1}` : `Unidad ${i + 1}`);
      }
    } else {
      newNames.length = validCount;
    }
    setUnitNames(newNames);
  };

  const handleSaveUnits = async () => {
    if (!configuringUnitsCondo) return;
    setSavingUnits(true);
    try {
      await updateDoc(doc(db, 'condos', configuringUnitsCondo.id), { unitNames, updatedAt: Timestamp.now() });
      setConfiguringUnitsCondo(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'condos');
    } finally {
      setSavingUnits(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title="Condominios"
        description="Administra los complejos residenciales registrados."
        actions={
          profile?.role === 'super_admin' && (
            <Button icon={Plus} onClick={handleOpenAdd}>
              Nuevo Condominio
            </Button>
          )
        }
      />

      {condos.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Sin condominios"
          description="Aún no hay condominios registrados en el sistema."
          action={<Button icon={Plus} onClick={handleOpenAdd}>Nuevo Condominio</Button>}
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Condominio</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Residentes</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Unidades</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Canales ACS</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Gastos</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                <AnimatePresence mode="popLayout">
                  {condos.map(condo => (
                    <motion.tr
                      key={condo.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Nombre + dirección */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                            <Building2 size={15} strokeWidth={2.2} />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{condo.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                              <MapPin size={10} className="shrink-0" />{condo.address}
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* Residentes */}
                      <td className="px-5 py-3.5">
                        <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                          <Users size={13} className="text-slate-400 shrink-0" />
                          {residentsByCondo[condo.id] || 0}
                        </span>
                      </td>
                      {/* Unidades */}
                      <td className="px-5 py-3.5">
                        <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                          <Home size={13} className="text-slate-400 shrink-0" />
                          {condo.unitNames?.length ?? 0}
                        </span>
                      </td>
                      {/* Canales ACS */}
                      <td className="px-5 py-3.5">
                        {(condo.dahuaChannelIds?.length ?? 0) > 0
                          ? <Badge variant="success" icon={Wifi}>{condo.dahuaChannelIds!.length} canal{condo.dahuaChannelIds!.length !== 1 ? 'es' : ''}</Badge>
                          : <Badge variant="muted" icon={WifiOff}>Sin canales</Badge>}
                      </td>
                      {/* Gastos */}
                      <td className="px-5 py-3.5">
                        {condo.expensesEnabled
                          ? <Badge variant="brand" icon={CreditCard}>Activo</Badge>
                          : <span className="text-xs text-slate-400 dark:text-slate-600">—</span>}
                      </td>
                      {/* Acciones */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleConfigUnits(condo)}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer border',
                              (condo.unitNames?.length ?? 0) > 0
                                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20'
                                : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10',
                            )}
                          >Unidades</button>
                          <button
                            onClick={() => handleOpenDahua(condo)}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer border',
                              (condo.dahuaChannelIds?.length ?? 0) > 0
                                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                                : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10',
                            )}
                          >Puertas</button>
                          {profile?.role === 'super_admin' && (
                            <>
                              <button
                                onClick={() => handleToggleExpenses(condo)}
                                title={condo.expensesEnabled ? 'Desactivar Gastos' : 'Activar Gastos'}
                                className={cn(
                                  'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer border',
                                  condo.expensesEnabled
                                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20'
                                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10',
                                )}
                              >Gastos</button>
                              <button onClick={() => handleOpenEdit(condo)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer" title="Editar">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => setDeletingCondo(condo)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer" title="Eliminar">
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

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      <Modal
        open={showAddModal || !!editingCondo}
        onClose={() => { setShowAddModal(false); setEditingCondo(null); }}
        title={editingCondo ? 'Editar Condominio' : 'Nuevo Condominio'}
        icon={Building2}
        size="sm"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Nombre del complejo" htmlFor="condo-name" required>
            <Input
              id="condo-name"
              required
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: Condominio Los Olivos"
            />
          </Field>
          <Field label="Dirección" htmlFor="condo-addr" required>
            <div className="relative">
              <MapPin size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                id="condo-addr"
                required
                type="text"
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                placeholder="Av. Principal 123, Ciudad"
                className="pl-9"
              />
            </div>
          </Field>
          <Button type="submit" loading={saving} fullWidth size="lg" className="mt-1">
            {editingCondo ? 'Actualizar Datos' : 'Registrar Condominio'}
          </Button>
        </form>
      </Modal>

      {/* ── Delete Modal ─────────────────────────────────────────────────────── */}
      <Modal
        open={!!deletingCondo}
        onClose={() => setDeletingCondo(null)}
        title="Eliminar condominio"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingCondo(null)}>Cancelar</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Eliminar</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          ¿Eliminar <strong className="text-slate-900 dark:text-white">«{deletingCondo?.name}»</strong>? Esta acción no se puede deshacer.
        </p>
      </Modal>

      {/* ── Dahua / DSS Modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {dahuaConfigCondo && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => { if (!dahuaSaving) setDahuaConfigCondo(null); }}
              className="absolute inset-0 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 shrink-0">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Wifi size={18} strokeWidth={2.2} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate">Puertas autorizadas — Portería Virtual</h2>
                    <p className="subtle mt-0.5">{dahuaConfigCondo.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => { if (!dahuaSaving) setDahuaConfigCondo(null); }}
                  aria-label="Cerrar"
                  className="p-1.5 -mr-1.5 -mt-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 pb-4 flex-1 overflow-y-auto min-h-0 space-y-4">
                <Button
                  variant="secondary"
                  icon={dahuaLoading ? RefreshCw : RefreshCw}
                  loading={dahuaLoading}
                  fullWidth
                  onClick={handleDiscover}
                >
                  {dahuaLoading ? 'Conectando…' : discovered.length > 0 ? 'Redescubrir puertas' : 'Descubrir puertas disponibles'}
                </Button>

                {dahuaError && (
                  <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-700 dark:text-red-300">
                    {dahuaError}
                  </div>
                )}

                {discovered.length === 0 && selectedIds.size > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Canales guardados</p>
                    {[...selectedIds].map(id => (
                      <div key={id} className="flex items-center justify-between px-3 py-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg">
                        <span className="text-xs text-emerald-700 dark:text-emerald-300 font-mono break-all">{id}</span>
                        <button onClick={() => toggleId(id)} className="ml-2 text-slate-400 hover:text-red-500 shrink-0 cursor-pointer transition-colors"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}

                {discovered.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {discovered.length} canales — marca los de este condominio
                    </p>
                    {discovered.map(ch => (
                      <label
                        key={ch.id}
                        className={cn(
                          'flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors border',
                          selectedIds.has(ch.id)
                            ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20'
                            : 'hover:bg-slate-50 dark:hover:bg-white/[0.02] border-transparent',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-blue-500 shrink-0 cursor-pointer"
                          checked={selectedIds.has(ch.id)}
                          onChange={() => toggleId(ch.id)}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{ch.orgName || '(sin nombre)'}</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono break-all mt-0.5">{ch.id}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-200 dark:border-white/5 shrink-0 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{selectedIds.size} canal{selectedIds.size !== 1 ? 'es' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
                  {selectedIds.size > 0 && (
                    <button onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer">
                      Limpiar
                    </button>
                  )}
                </div>
                <Button loading={dahuaSaving} fullWidth onClick={handleSaveDahua}>
                  Guardar configuración
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Units Modal ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {configuringUnitsCondo && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setConfiguringUnitsCondo(null)}
              className="absolute inset-0 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className="relative w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 shrink-0">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Home size={18} strokeWidth={2.2} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate">Configurar Unidades</h2>
                    <p className="subtle mt-0.5">{configuringUnitsCondo.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setConfiguringUnitsCondo(null)}
                  aria-label="Cerrar"
                  className="p-1.5 -mr-1.5 -mt-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="mb-6 grid grid-cols-2 gap-4 shrink-0 px-6">
                <div>
                  <label className="text-[10px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-[0.2em] ml-1 block mb-2">Cantidad (Total)</label>
                  <input 
                    type="number" 
                    min="0"
                    value={unitCount || ''} 
                    onChange={e => handleUnitCountChange(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-bold focus:border-blue-600 outline-none transition-all" 
                    placeholder="Ej: 5" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-[0.2em] ml-1 block mb-2">Prefijo (Opcional)</label>
                  <input 
                    type="text" 
                    value={unitPrefix} 
                    onChange={e => handlePrefixChange(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-medium focus:border-blue-600 outline-none transition-all" 
                    placeholder="Ej: Depto, Casa" 
                  />
                </div>
              </div>

              <div className="px-6 pb-4 flex-1 overflow-y-auto min-h-0 space-y-4">
                {unitCount > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {unitNames.map((name, idx) => (
                      <React.Fragment key={idx}>
                        <Field label={`Unidad ${idx + 1}`} htmlFor={`unit-${idx}`}>
                          <Input
                            id={`unit-${idx}`}
                            type="text"
                            value={name}
                            onChange={e => {
                              const newNames = [...unitNames];
                              newNames[idx] = e.target.value;
                              setUnitNames(newNames);
                            }}
                          />
                        </Field>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-200 dark:border-white/5 shrink-0">
                <Button loading={savingUnits} fullWidth onClick={handleSaveUnits}>
                  Guardar Unidades
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Condos;
