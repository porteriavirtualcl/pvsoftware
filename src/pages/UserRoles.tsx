import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Users, Shield, Wrench, Building2, Crown, Search, Globe,
  Edit2, ChevronDown, UserCog, Check, Trash2, UserPlus, Eye, EyeOff,
  LayoutDashboard, Package, Archive, CreditCard, AlertTriangle, QrCode,
  Smartphone, Monitor, Lock, Sliders, Menu, BookOpen, ClipboardList, MessageCircle, Megaphone, Star, type LucideIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';
import { api, authedFetch } from '../lib/apiBase';
import { PageHeader, Button, Card, Field, Input, Modal, EmptyState, Spinner } from '../components/ui';
import { cn } from '../lib/utils';
import {
  useRoleAccess,
  getRoleModules,
  ALL_MODULE_KEYS,
  CONFIGURABLE_ROLES,
  MOBILE_MAX,
  type ModuleKey,
  type RoleModules,
} from '../hooks/useRoleAccess';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  condoName?: string;
  condoId?: string;
  status?: string;
  unit?: string;
  canGenerateQR?: boolean;
  canManageVisitors?: boolean;
  canManageParcels?: boolean;
  canViewReservations?: boolean;
  canManageIncidents?: boolean;
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
  condo_admin: [
    { key: 'canGenerateQR',       label: 'Crear Pases de Visita' },
    { key: 'canManageIncidents',  label: 'Gestionar Incidencias' },
  ],
  administrador: [
    { key: 'canGenerateQR',       label: 'Crear Pases de Visita' },
  ],
  super_admin: [],
};

const ROLE_LABELS: Record<string, string> = {
  super_admin:   'Super Admin',
  condo_admin:   'Admin Condominio',
  administrador: 'Administrador',
  operator:      'Operador',
  technician:    'Técnico',
  resident:      'Residente',
  usuario:       'Usuario',
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  super_admin:   'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300',
  condo_admin:   'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300',
  administrador: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
  operator:      'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  technician:    'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  resident:      'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  usuario:       'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  super_admin:   <Crown size={11} />,
  condo_admin:   <Building2 size={11} />,
  administrador: <UserCog size={11} />,
  operator:      <Shield size={11} />,
  technician:    <Wrench size={11} />,
  resident:      <Users size={11} />,
  usuario:       <Users size={11} />,
};

const ROLE_ORDER = ['super_admin', 'condo_admin', 'administrador', 'operator', 'technician', 'resident', 'usuario'];

const MODULE_META: Record<ModuleKey, { label: string; icon: LucideIcon }> = {
  dashboard:  { label: 'Panel Control',    icon: LayoutDashboard },
  condos:     { label: 'Condominios',      icon: Building2 },
  equipment:  { label: 'Equipamiento',     icon: Wrench },
  operators:  { label: 'Operadores',       icon: Shield },
  residents:  { label: 'Residentes',       icon: Users },
  visitors:   { label: 'Pases de Visita',  icon: QrCode },
  incidents:  { label: 'Incidentes',       icon: AlertTriangle },
  expenses:   { label: 'Gastos Comunes',   icon: CreditCard },
  facilities: { label: 'Instalaciones',    icon: Package },
  parcels:    { label: 'Encomiendas',      icon: Archive },
  users:      { label: 'Usuarios / Roles',       icon: UserCog },
  manual:            { label: 'Manual del Residente', icon: BookOpen },
  'operator-manual': { label: 'Manual del Operador',  icon: BookOpen },
  access:       { label: 'Registros de Acceso',    icon: ClipboardList },
  'wa-numbers':    { label: 'WhatsApp — Números',     icon: MessageCircle },
  'wa-chat':       { label: 'WhatsApp — Chats',       icon: MessageCircle },
  'atencion-cliente': { label: 'Atención al Cliente', icon: Star          },
  'communications':{ label: 'Comunicaciones',         icon: Megaphone     },
  sidebar:         { label: 'Barra lateral',          icon: Menu },
};

const TABS = [
  { key: 'all',         label: 'Todos',           icon: <Users size={13} /> },
  { key: 'super_admin', label: 'Super Admin',      icon: <Crown size={13} /> },
  { key: 'condo_admin', label: 'Administradores',  icon: <Building2 size={13} /> },
  { key: 'operator',    label: 'Operadores',       icon: <Shield size={13} /> },
  { key: 'technician',  label: 'Técnicos',         icon: <Wrench size={13} /> },
  { key: 'administrador', label: 'Administradores', icon: <UserCog size={13} /> },
  { key: 'resident',     label: 'Residentes',      icon: <Users size={13} /> },
  { key: 'usuario',      label: 'Usuarios',         icon: <Users size={13} /> },
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
  'appearance-none block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl pl-3 pr-9 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';

const UserRoles = () => {
  const { profile } = useAuth();
  const { config: roleAccessConfig, saveRoleConfig } = useRoleAccess();
  const [users, setUsers]       = useState<UserProfile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [view, setView]         = useState<'users' | 'roles'>('users');
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newRole, setNewRole]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  type CreateForm = { name: string; email: string; password: string; role: string; condoIds: string[]; unit: string };
  const [createForm, setCreateForm] = useState<CreateForm>({ name: '', email: '', password: '', role: 'operator', condoIds: [], unit: '' });

  // Condo único seleccionado (para acotar un condo_admin a una unidad).
  const singleCondoId = (!createForm.condoIds.includes('all') && createForm.condoIds.length === 1)
    ? createForm.condoIds[0] : '';

  // Unidades reales del condominio seleccionado (de sus residentes) — para el match exacto en Accesos.
  const unitOptions = useMemo(() => {
    if (!singleCondoId) return [] as string[];
    const set = new Set<string>();
    users.forEach(u => {
      if (u.condoId === singleCondoId && ['resident', 'usuario'].includes(u.role) && u.unit) set.add(String(u.unit));
    });
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [users, singleCondoId]);
  const [condos, setCondos]     = useState<{ id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Role-access editor state
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [draftDesktop, setDraftDesktop] = useState<ModuleKey[]>([]);
  const [draftMobile, setDraftMobile] = useState<ModuleKey[]>([]);
  const [savingRoleCfg, setSavingRoleCfg] = useState(false);

  const openRoleEditor = (role: string) => {
    const current = getRoleModules(role, roleAccessConfig);
    setEditingRole(role);
    setDraftDesktop(current.desktopModules as ModuleKey[]);
    setDraftMobile(current.mobileModules as ModuleKey[]);
  };

  const toggleDesktop = (key: ModuleKey) => {
    if (key === 'dashboard' || key === 'sidebar') return; // always-visible or mobile-only
    setDraftDesktop(prev => {
      const has = prev.includes(key);
      const next = has ? prev.filter(k => k !== key) : [...prev, key];
      // Cascade: if removed from desktop, also remove from mobile
      if (has) setDraftMobile(m => m.filter(k => k !== key));
      return next;
    });
  };

  const toggleMobile = (key: ModuleKey) => {
    if (key === 'dashboard') return; // always visible
    setDraftMobile(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      // Sidebar is mobile-only; other modules must be in desktop to be in mobile.
      if (key !== 'sidebar' && !draftDesktop.includes(key)) return prev;
      // Enforce MOBILE_MAX
      if (prev.length >= MOBILE_MAX) return prev;
      return [...prev, key];
    });
  };

  const handleSaveRoleCfg = async () => {
    if (!editingRole) return;
    setSavingRoleCfg(true);
    try {
      // Ensure dashboard is first and deduped
      const normalize = (arr: ModuleKey[]): ModuleKey[] => {
        const set = new Set<ModuleKey>(arr);
        set.add('dashboard');
        const ordered = ALL_MODULE_KEYS.filter(k => set.has(k));
        return ordered;
      };
      const cfg: RoleModules = {
        desktopModules: normalize(draftDesktop),
        mobileModules:  normalize(draftMobile).slice(0, MOBILE_MAX),
      };
      await saveRoleConfig(editingRole, cfg);
      setEditingRole(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'config/roleAccess');
    } finally {
      setSavingRoleCfg(false);
    }
  };

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
    const isAll = createForm.condoIds.includes('all');
    const selectedIds = isAll ? condos.map((c: { id: string; name: string }) => c.id) : createForm.condoIds;
    const primaryId   = selectedIds[0] || '';
    const condoName   = isAll ? 'Todos' : condos.filter((c: { id: string; name: string }) => selectedIds.includes(c.id)).map((c: { id: string; name: string }) => c.name).join(', ') || '';
    const condoScope  = isAll ? 'all' : (selectedIds.length > 1 ? 'multiple' : 'single');
    // Solo un condo_admin acotado a un único condominio puede quedar restringido a una unidad.
    const unit = (createForm.role === 'condo_admin' && condoScope === 'single') ? (createForm.unit || '') : '';
    try {
      const res = await authedFetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          email: createForm.email,
          password: createForm.password,
          role: createForm.role,
          condoId: primaryId,
          condoName,
          condoIds: selectedIds,
          condoScope,
          unit,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error || 'Error al crear usuario'); return; }
      setShowCreateForm(false);
      setCreateForm({ name: '', email: '', password: '', role: 'operator', condoIds: [], unit: '' });
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

  // Tope de tarjetas renderizadas a la vez. Con cientos de residentes, animar todas
  // (motion layout) congela la página. Se muestran las primeras y el resto se filtra
  // con el buscador o las pestañas de rol.
  const VISIBLE_CAP = 60;
  const visibleUsers = filtered.slice(0, VISIBLE_CAP);

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
        description={
          view === 'users'
            ? `${users.length} usuario${users.length !== 1 ? 's' : ''} registrado${users.length !== 1 ? 's' : ''} en el sistema.`
            : 'Configura qué módulos ve cada rol en la versión web y móvil.'
        }
        icon={UserCog}
        actions={
          profile?.role === 'super_admin' && view === 'users' && (
            <Button icon={UserPlus} onClick={() => { setShowCreateForm(true); setCreateError(''); }}>
              Nuevo usuario
            </Button>
          )
        }
      />

      {/* View segmented control */}
      <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 self-start">
        {([
          { key: 'users', label: 'Usuarios', icon: Users },
          { key: 'roles', label: 'Configuración de roles', icon: Sliders },
        ] as const).map(v => {
          const Icon = v.icon;
          const active = view === v.key;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                active
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
              )}
            >
              <Icon size={13} />
              {v.label}
            </button>
          );
        })}
      </div>

      {view === 'users' ? (
        <>
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
          ) : visibleUsers.map(u => (
            <motion.div
              key={u.id}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
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

      {filtered.length > VISIBLE_CAP && (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500 pt-1">
          Mostrando {VISIBLE_CAP} de {filtered.length}. Usa el buscador o las pestañas de rol para ver el resto.
        </p>
      )}

        </>
      ) : (
        /* ─── Configuración de roles view ─── */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CONFIGURABLE_ROLES.map(r => {
            const mods = getRoleModules(r, roleAccessConfig);
            const overridden = !!(roleAccessConfig && roleAccessConfig[r]);
            return (
              <Card key={r} className="h-full">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      'w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 shadow-sm',
                      avatarGradient(r),
                    )}>
                      {ROLE_ICONS[r]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white text-sm">{ROLE_LABELS[r]}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {overridden ? 'Configuración personalizada' : 'Usando valores por defecto'}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    icon={Edit2}
                    onClick={() => openRoleEditor(r)}
                  >
                    Editar
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      <Monitor size={11} /> Escritorio
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white leading-none">
                      {mods.desktopModules.length}
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500"> módulos</span>
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      <Smartphone size={11} /> Móvil
                    </div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white leading-none">
                      {mods.mobileModules.length}
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">/{MOBILE_MAX}</span>
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Role access editor modal */}
      <Modal
        open={!!editingRole}
        onClose={() => setEditingRole(null)}
        title={editingRole ? `Configurar ${ROLE_LABELS[editingRole] || editingRole}` : ''}
        icon={Sliders}
        size="lg"
      >
        {editingRole && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Marca los módulos visibles en cada versión. El panel de control es siempre visible.
              La visibilidad móvil requiere visibilidad de escritorio.
            </p>

            {/* Mobile counter */}
            <div className={cn(
              'flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold',
              draftMobile.length > MOBILE_MAX
                ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/20'
                : 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20',
            )}>
              <span className="inline-flex items-center gap-1.5">
                <Smartphone size={13} /> Módulos en móvil
              </span>
              <span>{draftMobile.length}/{MOBILE_MAX}</span>
            </div>

            {/* Module list */}
            <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/10 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span>Módulo</span>
                <span className="inline-flex items-center gap-1 w-14 justify-center"><Monitor size={11} /> Web</span>
                <span className="inline-flex items-center gap-1 w-14 justify-center"><Smartphone size={11} /> Móvil</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {ALL_MODULE_KEYS.map(key => {
                  const meta = MODULE_META[key];
                  if (!meta) return null;
                  const Icon = meta.icon;
                  const isDashboard = key === 'dashboard';
                  const isSidebar = key === 'sidebar';
                  const inDesktop = isDashboard || draftDesktop.includes(key);
                  const inMobile  = isDashboard || draftMobile.includes(key);
                  const desktopDisabled = isDashboard || isSidebar;
                  const mobileRequiresDesktop = !isSidebar && !isDashboard && !inDesktop;
                  const mobileAtCap = !inMobile && draftMobile.length >= MOBILE_MAX;
                  const mobileDisabled = isDashboard || mobileRequiresDesktop || mobileAtCap;
                  return (
                    <div key={key} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2.5 items-center">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                          isSidebar
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400',
                        )}>
                          <Icon size={14} strokeWidth={2.2} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{meta.label}</p>
                          {isDashboard && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
                              <Lock size={9} /> Siempre visible
                            </p>
                          )}
                          {isSidebar && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
                              <Smartphone size={9} /> Hamburguesa — solo móvil
                            </p>
                          )}
                        </div>
                      </div>
                      {/* Desktop toggle */}
                      <button
                        onClick={() => toggleDesktop(key)}
                        disabled={desktopDisabled}
                        aria-label={`Módulo ${meta.label} en escritorio`}
                        className={cn(
                          'w-14 h-7 rounded-md border-2 flex items-center justify-center transition-colors mx-auto',
                          inDesktop
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-transparent border-slate-300 dark:border-white/20 text-transparent',
                          isSidebar && 'border-dashed',
                          desktopDisabled
                            ? (isSidebar ? 'opacity-30 cursor-not-allowed' : 'opacity-60 cursor-not-allowed')
                            : 'cursor-pointer hover:border-blue-500',
                        )}
                      >
                        {inDesktop && <Check size={14} strokeWidth={3} />}
                      </button>
                      {/* Mobile toggle */}
                      <button
                        onClick={() => toggleMobile(key)}
                        disabled={mobileDisabled}
                        aria-label={`Módulo ${meta.label} en móvil`}
                        className={cn(
                          'w-14 h-7 rounded-md border-2 flex items-center justify-center transition-colors mx-auto',
                          inMobile
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-transparent border-slate-300 dark:border-white/20 text-transparent',
                          mobileDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-emerald-500',
                        )}
                      >
                        {inMobile && <Check size={14} strokeWidth={3} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button variant="secondary" fullWidth onClick={() => setEditingRole(null)}>
                Cancelar
              </Button>
              <Button
                fullWidth
                loading={savingRoleCfg}
                disabled={savingRoleCfg || draftMobile.length > MOBILE_MAX}
                onClick={handleSaveRoleCfg}
              >
                Guardar cambios
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
                onChange={e => setCreateForm(f => ({ ...f, role: e.target.value, unit: '' }))}
                className={selectClass}
              >
                <option value="super_admin">Super Admin</option>
                <option value="condo_admin">Admin Condominio</option>
                <option value="administrador">Administrador</option>
                <option value="operator">Operador</option>
                <option value="technician">Técnico</option>
                <option value="resident">Residente</option>
                <option value="usuario">Usuario</option>
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          <Field label="Condominios asignados">
            <div className="space-y-2 max-h-44 overflow-y-auto bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl p-3">
              <label className="flex items-center gap-2.5 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={createForm.condoIds.includes('all')}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateForm(prev => ({ ...prev, condoIds: e.target.checked ? ['all'] : [], unit: '' }))}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 accent-blue-600"
                />
                <Globe size={13} className="text-blue-500" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Todos los condominios</span>
              </label>
              <div className="h-px bg-slate-100 dark:bg-white/5" />
              {condos.map((c: { id: string; name: string }) => (
                <label key={c.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    disabled={createForm.condoIds.includes('all')}
                    checked={createForm.condoIds.includes(c.id)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const next = createForm.condoIds.filter((x: string) => x !== 'all');
                      setCreateForm(f => ({ ...f, condoIds: e.target.checked ? [...next, c.id] : next.filter((x: string) => x !== c.id), unit: '' }));
                    }}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 accent-blue-600 disabled:opacity-40"
                  />
                  <Building2 size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className={cn('text-sm text-slate-700 dark:text-slate-300', createForm.condoIds.includes('all') && 'opacity-40')}>
                    {c.name}
                  </span>
                </label>
              ))}
            </div>
          </Field>

          {/* Alcance de accesos para Admin Condominio: todo el condominio o una unidad específica */}
          {createForm.role === 'condo_admin' && singleCondoId && (
            <Field
              label="Alcance de accesos"
              hint={
                createForm.unit
                  ? `En Registros de Acceso solo verá los accesos de la unidad ${createForm.unit}.`
                  : 'Verá los accesos de todo el condominio.'
              }
            >
              <div className="relative">
                <select
                  value={createForm.unit}
                  onChange={e => setCreateForm(f => ({ ...f, unit: e.target.value }))}
                  className={selectClass}
                >
                  <option value="">Todo el condominio</option>
                  {unitOptions.map(u => (
                    <option key={u} value={u}>Unidad {u}</option>
                  ))}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              {unitOptions.length === 0 && (
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                  Este condominio aún no tiene residentes con unidad registrada, por lo que solo puede asignarse el condominio completo.
                </p>
              )}
            </Field>
          )}

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
