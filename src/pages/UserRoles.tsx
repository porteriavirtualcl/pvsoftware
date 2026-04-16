import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Users, Shield, Wrench, Building2, Crown, Search,
  Edit2, X, ChevronDown, UserCog
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  condoName?: string;
  condoId?: string;
  status?: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  condo_admin: 'Admin Condominio',
  operator: 'Operador',
  technician: 'Técnico',
  resident: 'Residente',
  usuario: 'Usuario',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20',
  condo_admin: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
  operator: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
  technician: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  resident: 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20',
  usuario: 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-white/10',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  super_admin: <Crown size={14} />,
  condo_admin: <Building2 size={14} />,
  operator: <Shield size={14} />,
  technician: <Wrench size={14} />,
  resident: <Users size={14} />,
  usuario: <Users size={14} />,
};

const ROLE_ORDER = ['super_admin', 'condo_admin', 'operator', 'technician', 'resident', 'usuario'];

const TABS = [
  { key: 'all',        label: 'Todos',          icon: <Users size={14} /> },
  { key: 'super_admin', label: 'Super Admin',   icon: <Crown size={14} /> },
  { key: 'condo_admin', label: 'Administradores', icon: <Building2 size={14} /> },
  { key: 'operator',   label: 'Operadores',     icon: <Shield size={14} /> },
  { key: 'technician', label: 'Técnicos',       icon: <Wrench size={14} /> },
  { key: 'resident',   label: 'Residentes',     icon: <Users size={14} /> },
];

const UserRoles = () => {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newRole, setNewRole] = useState('');
  const [saving, setSaving] = useState(false);

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

  const avatarColor = (role: string) => {
    const map: Record<string, string> = {
      super_admin: 'from-purple-600 to-indigo-600',
      condo_admin: 'from-indigo-600 to-blue-600',
      operator: 'from-blue-600 to-cyan-600',
      technician: 'from-amber-500 to-orange-500',
      resident: 'from-green-500 to-emerald-600',
    };
    return map[role] || 'from-slate-500 to-slate-600';
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
    </div>
  );

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 p-10 rounded-[3rem] shadow-sm dark:shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 text-blue-500/10"><UserCog size={100} /></div>
        <div className="flex items-center gap-6 relative">
          <div className="w-16 h-16 bg-blue-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-blue-600/30">
            <UserCog size={32} />
          </div>
          <div>
            <h2 className="text-4xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight">Gestión de Roles</h2>
            <p className="text-slate-500 dark:text-gray-500 font-medium">{users.length} usuarios registrados en el sistema.</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar por nombre o email..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl py-3 pl-12 pr-4 text-slate-900 dark:text-white text-sm focus:border-blue-600 outline-none"
        />
      </div>

      {/* Role tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
              activeTab === t.key
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 hover:border-blue-500/50'
            }`}
          >
            {t.icon}
            {t.label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black ${activeTab === t.key ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-500'}`}>
              {countFor(t.key)}
            </span>
          </button>
        ))}
      </div>

      {/* User grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-full text-center py-16">
              <Users size={40} className="mx-auto mb-3 text-slate-300 dark:text-gray-700" />
              <p className="font-black uppercase italic text-slate-400 dark:text-gray-600">Sin usuarios en este filtro</p>
            </motion.div>
          ) : filtered.map(u => (
            <motion.div
              layout key={u.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 hover:border-blue-500/30 transition-all shadow-sm dark:shadow-none"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 bg-gradient-to-br ${avatarColor(u.role)} rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-lg shrink-0`}>
                    {u.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-900 dark:text-white truncate">{u.name || 'Sin nombre'}</h3>
                    <p className="text-xs text-slate-400 dark:text-gray-500 truncate">{u.email}</p>
                  </div>
                </div>
                {profile?.role === 'super_admin' && (
                  <button
                    onClick={() => { setEditingUser(u); setNewRole(u.role); }}
                    className="p-2 rounded-xl bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400 transition-all shrink-0"
                  >
                    <Edit2 size={14} />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between mt-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest ${ROLE_COLORS[u.role] || ROLE_COLORS.usuario}`}>
                  {ROLE_ICONS[u.role]}
                  {ROLE_LABELS[u.role] || u.role}
                </span>
                {u.condoName && (
                  <span className="text-xs text-slate-400 dark:text-gray-500 font-medium flex items-center gap-1 truncate max-w-[120px]">
                    <Building2 size={11} className="shrink-0" />
                    {u.condoName}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Edit role modal */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setEditingUser(null)}
              className="absolute inset-0 bg-black/40 dark:bg-black/95 backdrop-blur-md"
            />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              className="relative w-full max-w-sm bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-[3rem] p-10 shadow-2xl"
            >
              <button
                onClick={() => setEditingUser(null)}
                className="absolute top-6 right-6 p-2 rounded-xl bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-4 mb-8">
                <div className={`w-14 h-14 bg-gradient-to-br ${avatarColor(editingUser.role)} rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg`}>
                  {editingUser.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white italic uppercase tracking-tight">Cambiar Rol</h3>
                  <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{editingUser.name} · {editingUser.email}</p>
                </div>
              </div>

              <div className="space-y-2 mb-8">
                <label className="text-xs font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">Rol Actual → Nuevo Rol</label>
                <div className="relative">
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-bold appearance-none"
                  >
                    {Object.entries(ROLE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                {newRole !== editingUser.role && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium ml-1 mt-2">
                    Cambiará de <span className="font-black">{ROLE_LABELS[editingUser.role]}</span> → <span className="font-black">{ROLE_LABELS[newRole]}</span>
                  </p>
                )}
              </div>

              <button
                onClick={handleEditRole}
                disabled={saving || newRole === editingUser.role}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 dark:disabled:bg-gray-800 disabled:text-slate-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-blue-600/30"
              >
                {saving ? 'Guardando...' : 'Confirmar Cambio de Rol'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UserRoles;
