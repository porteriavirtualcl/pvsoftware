import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Users, Shield, Wrench, Building2, Crown, Search,
  Edit2, ChevronDown, UserCog, Check, Trash2, UserPlus, Eye, EyeOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';
import { PageHeader, Button, Card, Field, Input, Modal, Badge, EmptyState, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  condoName?: string;
  condoId?: string;
  status?: string;
  canGenerateQR?: boolean;
  canManageVisitors?: boolean;
  canManageParcels?: boolean;
  canViewReservations?: boolean;
  condoScope?: string;
}

const ROLE_PERMISSIONS: Record<string, { key: string; label: string }[]> = {
  resident:   [{ key: 'canGenerateQR',        label: 'Generar Pases QR' }],
  usuario:    [{ key: 'canGenerateQR',         label: 'Generar Pases QR' }],
  operator:   [
    { key: 'canManageVisitors',   label: 'Gestionar Visitantes' },
    { key: 'canManageParcels',    label: 'Encomiendas' },
    { key: 'canViewReservations', label: 'Ver Reservas' },
  ],
  technician: [{ key: 'condoScopeAll', label: 'Acceso Global (todos los condominios)' }],
  condo_admin: [{ key: 'canGenerateQR', label: 'Crear Pases de Visita' }],
  super_admin: [],
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  condo_admin: 'Admin Condominio',
  operator:    'Operador',
  technician:  'Técnico',
  resident:    'Residente',
  usuario:     'Usuario',
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  super_admin: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300',
  condo_admin: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300',
  operator:    'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  technician:  'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  resident:    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  usuario:     'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  super_admin: <Crown size={11} />,
  condo_admin: <Building2 size={11} />,
  operator:    <Shield size={11} />,
  technician:  <Wrench size={11} />,
  resident:    <Users size={11} />,
  usuario:     <Users size={11} />,
};

const ROLE_ORDER = ['super_admin', 'condo_admin', 'operator', 'technician', 'resident', 'usuario'];

const TABS = [
  { key: 'all',         label: 'Todos',           icon: <Users size={13} /> },
  { key: 'super_admin', label: 'Super Admin',      icon: <Crown size={13} /> },
  { key: 'condo_admin', label: 'Administradores',  icon: <Building2 size={13} /> },
  { key: 'operator',    label: 'Operadores',       icon: <Shield size={13} /> },
  { key: 'technician',  label: 'Técnicos',         icon: <Wrench size={13} /> },
  { key: 'resident',    label: 'Residentes',       icon: <Users size={13} /> },
];

const avatarGradient = (role: string) => {
  const map: Record<string, string> = {
    super_admin: 'from-purple-600 to-indigo-600',
    condo_admin: 'from-indigo-600 to-blue-600',
    operator:    'from-blue-600 to-cyan-600',
    technician:  'from-amber-500 to-orange-500',
    resident:    'from-emerald-500 to-green-600',
  };
  return map[role] || 'from-slate-500 to-slate-600';
};

const selectClass =
  'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';

const UserRoles = () => {
  const { profile } = useAuth();
  const [users, setUsers]       = useState<UserProfile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newRole, setNewRole]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', role: 'operator', condoId: '', condoName: '' });
  const [condos, setCondos]     = useState<{ id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'condos'), snap => {
      setCondos(snap.docs.map(d => ({ id: d.id, name: d.data().name as string })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'users'),
      snap => {
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })) as UserProfile[]);
        setLoading(false);
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'users');
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    const condo = condos.find(c => c.id === createForm.condoId);
    try {
      const res = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          email: createForm.email,
          password: createForm.password,
          role: createForm.role,
          condoId: createForm.condoId,
          condoName: condo?.name || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error || 'Error al crear usuario'); return; }
      setShowCreateForm(false);
      setCreateForm({ name: '', email: '', password: '', role: 'operator', condoId: '', condoName: '' });
    } catch {
      setCreateError('Error de conexión con el servidor');
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePermission = async (userId: string, key: string, currentVal: boolean) => {
    const toggleKey = `${userId}:${key}`;
    setToggling(toggleKey);
    try {
      const update: Record<string, unknown> = {};
      if (key === 'condoScopeAll') {
        update.condoScope = !currentVal ? 'all' : 'single';
      } else {
        update[key] = !currentVal;
      }
      await updateDoc(doc(db, 'users', userId), update);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'users');
    } finally {
      setToggling(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'users', deletingUser.id));
      setDeletingUser(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'users');
    } finally {
      setDeleting(false);
    }
  };

  const handleEditRole = async () => {
    if (!editingUser || !newRole || newRole === editingUser.role) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', editingUser.id), { role: newRole });
      setEditingUser(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'users');
    } finally {
      setSaving(false);
    }
  };

  const filtered = users
    .filter(u => {
      const matchTab = activeTab === 'all' || u.role === activeTab;
      const s = searchTerm.toLowerCase();
      const matchSearch = !s || u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s);
      return matchTab && matchSearch;
    })
    .sort((a, b) => {
      const ri = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
      return ri !== 0 ? ri : (a.name || '').localeCompare(b.name || '');
    });

  const countFor = (key: string) =>
    key === 'all' ? users.length : users.filter(u => u.role === key).length;

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Spinner size={36} />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Administración"
        title="Usuarios / Roles"
        description={`${users.length} usuario${users.length !== 1 ? 's' : ''} registrado${users.length !== 1 ? 's' : ''} en el sistema.`}
        icon={UserCog}
        actions={
          profile?.role === 'super_admin' && (
            <Button icon={UserPlus} onClick={() => { setShowCreateForm(true); setCreateError(''); }}>
              Nuevo usuario
            </Button>
          )
        }
      />

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar por nombre o email…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Role filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors duration-150 cursor-pointer',
              activeTab === t.key
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-blue-400/50 hover:text-blue-600 dark:hover:text-blue-300',
            )}
          >
            {t.icon}
            {t.label}
            <span className={cn(
              'px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
              activeTab === t.key
                ? 'bg-white/20 text-white'
                : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400',
            )}>
              {countFor(t.key)}
            </span>
          </button>
        ))}
      </div>

      {/* User grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-full">
              <EmptyState
                icon={Users}
                title="Sin usuarios en este filtro"
                description="Prueba ajustando la búsqueda o seleccionando otro rol."
              />
            </motion.div>
          ) : filtered.map(u => (
            <motion.div
              layout key={u.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.18 }}
            >
              <Card hoverable className="h-full">
                {/* User info row */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      'w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-semibold text-base shrink-0 shadow-sm',
                      avatarGradient(u.role),
                    )}>
                      {u.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate text-sm">{u.name || 'Sin nombre'}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{u.email}</p>
                    </div>
                  </div>

                  {profile?.role === 'super_admin' && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setEditingUser(u); setNewRole(u.role); }}
                        aria-label="Editar rol"
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                      >
                        <Edit2 size={14} />
                      </button>
                      {u.id !== profile?.uid && (
                        <button
                          onClick={() => setDeletingUser(u)}
                          aria-label="Eliminar usuario"
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Role + condo */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold',
                    ROLE_BADGE_CLASS[u.role] || ROLE_BADGE_CLASS.usuario,
                  )}>
                    {ROLE_ICONS[u.role]}
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                  {u.condoName && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1 truncate max-w-[130px]">
                      <Building2 size={11} className="shrink-0" />
                      {u.condoName}
                    </span>
                  )}
                </div>

                {/* Permission toggles — super_admin only */}
                {profile?.role === 'super_admin' && (ROLE_PERMISSIONS[u.role] || []).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5 space-y-1.5">
                    {(ROLE_PERMISSIONS[u.role] || []).map(perm => {
                      const val = perm.key === 'condoScopeAll'
                        ? u.condoScope === 'all'
                        : !!(u as Record<string, unknown>)[perm.key];
                      const isToggling = toggling === `${u.id}:${perm.key}`;
                      return (
                        <button
                          key={perm.key}
                          onClick={() => handleTogglePermission(u.id, perm.key, val)}
                          disabled={isToggling}
                          className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left disabled:opacity-50 cursor-pointer"
                        >
                          <span className="text-xs text-slate-600 dark:text-slate-300">{perm.label}</span>
                          <div className={cn(
                            'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                            val ? 'bg-blue-600 border-blue-600' : 'bg-transparent border-slate-300 dark:border-white/20',
                          )}>
                            {val && <Check size={11} strokeWidth={3} className="text-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Delete confirm modal */}
      <Modal
        open={!!deletingUser}
        onClose={() => setDeletingUser(null)}
        title="¿Eliminar usuario?"
        icon={Trash2}
        size="sm"
      >
        {deletingUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
              <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-semibold shrink-0', avatarGradient(deletingUser.role))}>
                {deletingUser.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{deletingUser.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{deletingUser.email}</p>
              </div>
            </div>
            <p className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              Esta acción no se puede deshacer.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" fullWidth onClick={() => setDeletingUser(null)}>
                Cancelar
              </Button>
              <Button variant="danger" fullWidth loading={deleting} onClick={handleDeleteUser}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit role modal */}
      <Modal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        title="Cambiar rol"
        icon={Edit2}
        size="sm"
      >
        {editingUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
              <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-semibold shrink-0', avatarGradient(editingUser.role))}>
                {editingUser.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{editingUser.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{editingUser.email}</p>
              </div>
            </div>

            <Field label="Nuevo rol" required>
              <div className="relative">
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  className={selectClass}
                >
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              {newRole !== editingUser.role && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1.5">
                  Cambiará de <span className="font-semibold">{ROLE_LABELS[editingUser.role]}</span> → <span className="font-semibold">{ROLE_LABELS[newRole]}</span>
                </p>
              )}
            </Field>

            <Button
              fullWidth
              loading={saving}
              disabled={saving || newRole === editingUser.role}
              onClick={handleEditRole}
            >
              Confirmar cambio de rol
            </Button>
          </div>
        )}
      </Modal>

      {/* Create user modal */}
      <Modal
        open={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        title="Nuevo usuario"
        icon={UserPlus}
        size="sm"
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          <Field label="Nombre" required>
            <Input
              required
              value={createForm.name}
              onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Nombre completo"
            />
          </Field>

          <Field label="Email" required>
            <Input
              required
              type="email"
              value={createForm.email}
              onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
              placeholder="correo@ejemplo.cl"
            />
          </Field>

          <Field label="Contraseña" hint="Mínimo 6 caracteres" required>
            <div className="relative">
              <Input
                required
                type={showPassword ? 'text' : 'password'}
                value={createForm.password}
                onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          <Field label="Rol" required>
            <div className="relative">
              <select
                value={createForm.role}
                onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
                className={selectClass}
              >
                <option value="operator">Operador</option>
                <option value="condo_admin">Admin Condominio</option>
                <option value="technician">Técnico</option>
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          <Field label="Condominio">
            <div className="relative">
              <select
                value={createForm.condoId}
                onChange={e => setCreateForm(f => ({ ...f, condoId: e.target.value }))}
                className={selectClass}
              >
                <option value="">Sin condominio asignado</option>
                {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          {createError && (
            <p className="text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              {createError}
            </p>
          )}

          <Button type="submit" fullWidth loading={creating} icon={UserPlus}>
            {creating ? 'Creando…' : 'Crear usuario'}
          </Button>
        </form>
      </Modal>
    </div>
  );
};

export default UserRoles;
