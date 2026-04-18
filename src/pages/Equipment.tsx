import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, collectionGroup, where } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Plus, Search, MapPin, Edit2, Trash2, Package, Wrench, CalendarClock, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';
import { PageHeader, Button, Card, Field, Input, Modal, Badge, EmptyState, Spinner } from '../components/ui';

interface Equipment {
  id: string;
  name: string;
  type: string;
  status: 'Operativo' | 'Mantenimiento' | 'Falla';
  location: string;
  lastMaintenance: string;
  nextMaintenance: string;
  condoId: string;
  condoName: string;
}

const selectClass =
  'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';

function statusBadge(status: Equipment['status']): React.ReactNode {
  const map: Partial<Record<string, { variant: 'success' | 'warn' | 'danger'; label: string }>> = {
    Operativo:    { variant: 'success', label: 'Operativo' },
    Mantenimiento:{ variant: 'warn',    label: 'Mantenimiento' },
    Falla:        { variant: 'danger',  label: 'Falla' },
  };
  const entry = map[status] ?? { variant: 'muted' as const, label: status };
  return <Badge variant={entry.variant as 'success' | 'warn' | 'danger'}>{entry.label}</Badge>;
}

const Equipment = () => {
  const { profile, user } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [condos, setCondos] = useState<{ id: string; name: string }[]>([]);
  const [filterCondo, setFilterCondo] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    type: '',
    status: 'Operativo' as Equipment['status'],
    location: '',
    lastMaintenance: new Date().toISOString().split('T')[0],
    nextMaintenance: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    condoId: '',
  });

  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
  const [deletingEquipment, setDeletingEquipment] = useState<Equipment | null>(null);

  useEffect(() => {
    const condosUnsubscribe = onSnapshot(collection(db, 'condos'), (snapshot) => {
      setCondos(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });

    if (!profile || !user) return () => condosUnsubscribe();

    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collectionGroup(db, 'equipment'));
    } else if (profile.condoScope === 'multiple' && profile.condoIds) {
      q = query(collectionGroup(db, 'equipment'), where('condoId', 'in', profile.condoIds));
    } else {
      q = query(collection(db, `condos/${profile.condoId || 'default'}/equipment`));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEquipment(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Equipment[]);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'equipment');
    });

    return () => { unsubscribe(); condosUnsubscribe(); };
  }, [profile, user]);

  const handleOpenAdd = () => {
    setEditingEquipment(null);
    setFormData({
      name: '', type: '', status: 'Operativo', location: '',
      lastMaintenance: new Date().toISOString().split('T')[0],
      nextMaintenance: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condoId: profile?.condoId || '',
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (item: Equipment) => {
    setEditingEquipment(item);
    setFormData({
      name: item.name, type: item.type, status: item.status,
      location: item.location, lastMaintenance: item.lastMaintenance,
      nextMaintenance: item.nextMaintenance, condoId: item.condoId,
    });
    setShowAddModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    const condoIdToUse = formData.condoId || 'default';
    const path = `condos/${condoIdToUse}/equipment`;
    try {
      const dataToSave = { ...formData, condoName: selectedCondo?.name || profile?.condoName || 'Condominio', updatedAt: Timestamp.now() };
      if (editingEquipment) {
        await updateDoc(doc(db, path, editingEquipment.id), dataToSave);
      } else {
        await addDoc(collection(db, path), { ...dataToSave, createdAt: Timestamp.now() });
      }
      setShowAddModal(false);
    } catch (error) {
      handleFirestoreError(error, editingEquipment ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!deletingEquipment) return;
    const path = `condos/${deletingEquipment.condoId}/equipment`;
    try {
      await deleteDoc(doc(db, path, deletingEquipment.id));
      setDeletingEquipment(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const filteredItems = equipment.filter(item =>
    (!filterCondo || item.condoId === filterCondo) && (
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.type.toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  if (loading && !equipment.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );
  }

  const isSuperScope = profile?.role === 'super_admin' || profile?.condoScope === 'all';

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Inventario"
        title="Equipamiento"
        description="Control preventivo de activos e infraestructura del condominio."
        icon={Wrench}
        actions={
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={16} />
              <Input
                type="text"
                placeholder="Buscar equipo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-52"
              />
            </div>
            <Button icon={Plus} onClick={handleOpenAdd}>Nuevo Equipo</Button>
          </div>
        }
      />

      {/* Condo filter pills */}
      {isSuperScope && condos.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">Condominio:</span>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilterCondo('')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer',
                !filterCondo
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                  : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-500/50'
              )}
            >
              Todos
            </button>
            {condos.map(c => (
              <button
                key={c.id}
                onClick={() => setFilterCondo(c.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer',
                  filterCondo === c.id
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-500/50'
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Equipment grid */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Sin equipos registrados"
          description={searchTerm ? 'No hay resultados para tu búsqueda.' : 'Agrega el primer equipo o activo del condominio.'}
          action={!searchTerm ? <Button icon={Plus} onClick={handleOpenAdd}>Nuevo Equipo</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => (
            <motion.div layout key={item.id}>
              <Card variant="glass" hoverable className="h-full flex flex-col gap-0 p-0 overflow-hidden cursor-pointer">
                {/* Card header */}
                <div className="flex items-start justify-between p-5 pb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Wrench size={18} strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate">{item.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.type}</p>
                    </div>
                  </div>
                  {statusBadge(item.status)}
                </div>

                {/* Location + condo */}
                <div className="px-5 pb-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                    <MapPin size={13} className="text-blue-500 shrink-0" />
                    <span className="truncate">{item.location}</span>
                  </div>
                  {isSuperScope && (
                    <p className="text-xs font-medium text-slate-400 dark:text-slate-500 truncate pl-0.5">{item.condoName}</p>
                  )}
                </div>

                {/* Maintenance dates */}
                <div className="mt-auto border-t border-slate-200 dark:border-white/5 grid grid-cols-2 divide-x divide-slate-200 dark:divide-white/5">
                  <div className="p-4 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-medium">
                      <Calendar size={11} /> Último
                    </div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{item.lastMaintenance}</p>
                  </div>
                  <div className="p-4 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-medium">
                      <CalendarClock size={11} /> Siguiente
                    </div>
                    <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">{item.nextMaintenance}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-1 px-4 py-2.5 border-t border-slate-200 dark:border-white/5">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(item)} aria-label="Editar">
                    <Edit2 size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeletingEquipment(item)} aria-label="Eliminar" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={editingEquipment ? 'Editar Equipo' : 'Nuevo Activo'}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Nombre del Equipo" required htmlFor="eq-name">
            <Input
              id="eq-name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: Bomba de agua principal"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tipo / Modelo" required htmlFor="eq-type">
              <Input
                id="eq-type"
                required
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                placeholder="Ej: Bomba centrífuga"
              />
            </Field>
            <Field label="Estado" htmlFor="eq-status">
              <select
                id="eq-status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as Equipment['status'] })}
                className={selectClass}
              >
                <option value="Operativo">Operativo</option>
                <option value="Mantenimiento">Mantenimiento</option>
                <option value="Falla">Falla</option>
              </select>
            </Field>
          </div>
          <Field label="Ubicación Física" required htmlFor="eq-location">
            <Input
              id="eq-location"
              required
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="Ej: Sala de máquinas B1"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Último Mantenimiento" htmlFor="eq-last">
              <Input
                id="eq-last"
                type="date"
                value={formData.lastMaintenance}
                onChange={(e) => setFormData({ ...formData, lastMaintenance: e.target.value })}
              />
            </Field>
            <Field label="Próximo Mantenimiento" htmlFor="eq-next">
              <Input
                id="eq-next"
                type="date"
                value={formData.nextMaintenance}
                onChange={(e) => setFormData({ ...formData, nextMaintenance: e.target.value })}
              />
            </Field>
          </div>
          {profile?.role === 'super_admin' && (
            <Field label="Condominio" htmlFor="eq-condo">
              <select
                id="eq-condo"
                value={formData.condoId}
                onChange={(e) => setFormData({ ...formData, condoId: e.target.value })}
                className={selectClass}
              >
                <option value="">Seleccionar...</option>
                {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowAddModal(false)}>Cancelar</Button>
            <Button type="submit">Guardar Cambios</Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation Modal */}
      <Modal
        open={!!deletingEquipment}
        onClose={() => setDeletingEquipment(null)}
        title="Eliminar equipo"
        size="sm"
      >
        <div className="space-y-4">
          <div className="text-center py-2 space-y-3">
            <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto">
              <Trash2 size={22} />
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Se eliminará <span className="font-semibold text-slate-900 dark:text-slate-100">"{deletingEquipment?.name}"</span> permanentemente. Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setDeletingEquipment(null)}>Cancelar</Button>
            <Button variant="danger" fullWidth onClick={handleDelete}>Eliminar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Equipment;
