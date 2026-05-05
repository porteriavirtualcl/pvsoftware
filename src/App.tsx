import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useRoleAccess, getRoleModules, MOBILE_MAX, type ModuleKey } from './hooks/useRoleAccess';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  MapPin,
  CreditCard,
  LogOut,
  X,
  LayoutDashboard,
  QrCode,
  Building2,
  Wrench,
  AlertTriangle,
  Shield,
  Home,
  CheckCircle2,
  Package,
  KeyRound,
  Eye,
  EyeOff,
  Phone,
  MessageCircle,
  Archive,
  UserCog,
  Menu,
  BookOpen,
  ExternalLink,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { getAuth, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { db } from './firebase';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { api } from './lib/apiBase';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support';
import { useVisitorExitPoller } from './hooks/useVisitorExitPoller';
import { usePresence } from './hooks/usePresence';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Condos from './pages/Condos';
import Equipment from './pages/Equipment';
import Technicians from './pages/Technicians';
import Operators from './pages/Operators';
import Residents from './pages/Residents';
import MyUnit from './pages/MyUnit';
import Incidents from './pages/Incidents';
import Expenses from './pages/Expenses';
import Facilities from './pages/Facilities';
import Visitors from './pages/Visitors';
import Parcels from './pages/Parcels';
import UserRoles from './pages/UserRoles';
import DahuaTest from './pages/DahuaTest';
import PrivacyPolicy from './pages/PrivacyPolicy';
import ResidentManual from './pages/ResidentManual';
import AccessRecords from './pages/AccessRecords';
import WhatsAppNumbers from './pages/WhatsAppNumbers';
import WhatsAppChat from './pages/WhatsAppChat';

// Components
import NotificationCenter from './components/NotificationCenter';
import { Button, Modal, Field, Input, Spinner } from './components/ui';

// --- Protected Route ---
const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) => {
  const { user, profile, loading, isAuthReady } = useAuth();

  if (!isAuthReady || loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8" style={{ background: 'var(--surface-page)' }}>
        <img src="/icon-512.png" alt="Portería Virtual" className="w-28 h-28 object-contain rounded-3xl shadow-lg" />
        <Spinner size={36} />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
};

// --- Sidebar Item ---
const SidebarItem = ({ to, href, icon: Icon, label, active, onClick }: {
  to: string; href?: string; icon: LucideIcon; label: string; active: boolean; onClick?: () => void;
}) => {
  const cls = `
    relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-150 group cursor-pointer
    ${active
      ? 'bg-blue-600/10 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300'
      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-100'}
  `;
  const inner = (
    <>
      <span className={`
        w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-150
        ${active
          ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
          : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-300'}
      `}>
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {href && <ExternalLink size={12} className="shrink-0 opacity-40 group-hover:opacity-70 transition-opacity" aria-hidden />}
      {active && !href && <span className="w-1 h-5 bg-blue-500 rounded-full" aria-hidden />}
    </>
  );
  if (href) return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={cls}>
      {inner}
    </a>
  );
  return (
    <Link to={to} onClick={onClick} aria-current={active ? 'page' : undefined} className={cls}>
      {inner}
    </Link>
  );
};

// --- Bottom Nav Item (Mobile) ---
const BottomNavItem = ({ to, href, icon: Icon, label, active }: {
  to: string; href?: string; icon: LucideIcon; label: string; active: boolean;
}) => {
  const cls = `flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 transition-colors cursor-pointer
    ${active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`;
  const inner = (
    <>
      <span className={`w-10 h-8 rounded-xl flex items-center justify-center transition-colors
        ${active ? 'bg-blue-600/10 dark:bg-blue-500/15' : 'hover:bg-slate-100 dark:hover:bg-white/5'}`}>
        <Icon size={19} strokeWidth={active ? 2.4 : 2} />
      </span>
      <span className="text-[9px] font-semibold leading-tight whitespace-nowrap">{label}</span>
    </>
  );
  if (href) return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
  );
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} className={cls}>{inner}</Link>
  );
};

// --- Global Layout Wrapper ---
const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, profile } = useAuth();
  const { config: roleAccessConfig } = useRoleAccess();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation().pathname;
  const [condoSettings, setCondoSettings] = useState<{ expensesEnabled?: boolean } | null>(null);

  const isResident = profile?.role === 'resident' || profile?.role === 'usuario';
  useVisitorExitPoller(user?.uid, profile?.condoId, isResident);
  usePresence(user?.uid);

  // Per-condo feature flags
  useEffect(() => {
    const condoId = profile?.condoId;
    if (!condoId || profile?.role === 'super_admin' || profile?.condoScope === 'all') {
      setCondoSettings({ expensesEnabled: true });
      return;
    }
    const unsub = onSnapshot(doc(db, 'condos', condoId), (snap) => {
      if (snap.exists()) setCondoSettings(snap.data() as { expensesEnabled?: boolean });
      else setCondoSettings({});
    });
    return () => unsub();
  }, [profile?.condoId, profile?.role, profile?.condoScope]);

  // ── Change password modal ──
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [currentPwd, setCurrentPwd]     = useState('');
  const [newPwd, setNewPwd]             = useState('');
  const [confirmPwd, setConfirmPwd]     = useState('');
  const [showCurrent, setShowCurrent]   = useState(false);
  const [showNew, setShowNew]           = useState(false);
  const [pwdError, setPwdError]         = useState('');
  const [pwdSuccess, setPwdSuccess]     = useState(false);
  const [savingPwd, setSavingPwd]       = useState(false);

  const openPwdModal = () => {
    setPwdError(''); setPwdSuccess(false);
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
    setShowPwdModal(true);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    if (newPwd !== confirmPwd) { setPwdError('Las contraseñas no coinciden.'); return; }
    if (newPwd.length < 6)     { setPwdError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (!user?.email) return;
    setSavingPwd(true);
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('No hay sesión activa.');
      const credential = EmailAuthProvider.credential(user.email, currentPwd);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPwd);
      setPwdSuccess(true);
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      setTimeout(() => { setPwdSuccess(false); setShowPwdModal(false); }, 1800);
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPwdError('Contraseña actual incorrecta.');
      } else {
        setPwdError(err?.message || 'Error al cambiar contraseña.');
      }
    } finally {
      setSavingPwd(false);
    }
  };

  // ── Profile modal ──
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [condoOperator, setCondoOperator] = useState<{ name?: string; phone?: string; email?: string } | null>(null);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');

  const handleOpenProfile = async () => {
    setCondoOperator(null);
    setShowProfileModal(true);
    if (profile?.condoId && (profile?.role === 'resident' || profile?.role === 'usuario')) {
      try {
        const snap = await getDocs(query(
          collection(db, 'users'),
          where('role', '==', 'operator'),
          where('condoId', '==', profile.condoId),
        ));
        if (!snap.empty) setCondoOperator(snap.docs[0].data() as any);
      } catch { /* no operator found */ }
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    window.location.href = '/login';
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeletingAccount(true);
    setDeleteAccountError('');
    try {
      const res = await fetch(api('/api/users/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      const data = await res.json();
      if (!res.ok) { setDeleteAccountError(data.error || 'Error al eliminar la cuenta'); return; }
      localStorage.clear();
      window.location.href = '/login';
    } catch {
      setDeleteAccountError('Error de conexión. Intenta nuevamente.');
    } finally {
      setDeletingAccount(false);
    }
  };

  const menuItems: Array<{
    to: string;
    href?: string;
    key: ModuleKey;
    icon: LucideIcon;
    label: string;
    shortLabel?: string;
    requireExpenses?: boolean;
  }> = [
    { to: '/',          key: 'dashboard',  icon: LayoutDashboard, label: 'Panel Control',   shortLabel: 'Inicio' },
    { to: '/condos',    key: 'condos',     icon: Building2,       label: 'Condominios',     shortLabel: 'Condos' },
    { to: '/equipment', key: 'equipment',  icon: Wrench,          label: 'Equipamiento',    shortLabel: 'Equipos' },
    { to: '/operators', key: 'operators',  icon: Shield,          label: 'Operadores',      shortLabel: 'Operadores' },
    { to: '/residents', key: 'residents',  icon: Users,           label: 'Residentes' },
    { to: '/visitors',  key: 'visitors',   icon: QrCode,          label: 'Pases de Visita', shortLabel: 'Visitas' },
    { to: '/incidents', key: 'incidents',  icon: AlertTriangle,   label: 'Incidentes' },
    { to: '/expenses',  key: 'expenses',   icon: CreditCard,      label: 'Gastos Comunes',  shortLabel: 'Gastos', requireExpenses: true },
    { to: '/facilities',key: 'facilities', icon: Package,         label: 'Instalaciones' },
    { to: '/parcels',   key: 'parcels',    icon: Archive,         label: 'Encomiendas' },
    { to: '/users',     key: 'users',      icon: UserCog,         label: 'Usuarios / Roles',shortLabel: 'Usuarios' },
    { to: '/manual',      key: 'manual',     icon: BookOpen,      label: 'Manual del Residente', shortLabel: 'Manual'   },
    { to: '/access',      key: 'access',     icon: ClipboardList, label: 'Registros Acceso',     shortLabel: 'Accesos'  },
    { to: '/wa-numbers',  key: 'wa-numbers', icon: MessageCircle, label: 'WhatsApp — Números',   shortLabel: 'WA Nums'  },
    { to: '/wa-chat',     key: 'wa-chat',    icon: MessageCircle, label: 'WhatsApp — Chats',     shortLabel: 'WA Chat'  },
  ];

  // All roles use config (Firestore) with hardcoded defaults as fallback.
  const role = profile?.role || '';
  const { desktopModules, mobileModules } = getRoleModules(role, roleAccessConfig);

  const desktopKeys = new Set<string>(desktopModules);
  const mobileKeys = new Set<string>(mobileModules);

  const filteredMenuItems = menuItems.filter(item => {
    if (!desktopKeys.has(item.key)) return false;
    if (item.requireExpenses && !condoSettings?.expensesEnabled) return false;
    return true;
  });

  // Mobile: Dashboard always first. Optional hamburger button takes one slot if enabled.
  // Remaining slots fill with configured modules.
  const showSidebarButton = mobileKeys.has('sidebar');
  const moduleSlots = MOBILE_MAX - (showSidebarButton ? 1 : 0); // total slots for modules (incl. dashboard)
  const dashboardItem = filteredMenuItems.find(m => m.key === 'dashboard');
  const otherMobileItems = filteredMenuItems
    .filter(m => m.key !== 'dashboard' && mobileKeys.has(m.key))
    .slice(0, Math.max(0, moduleSlots - 1));
  const mobileNavItems = [dashboardItem, ...otherMobileItems].filter(Boolean) as typeof filteredMenuItems;

  const roleLabel = profile?.role?.replace('_', ' ') || 'Residente';

  return (
    <div className="flex h-screen text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500/30 overflow-hidden"
         style={{ background: 'var(--surface-page)' }}>
      {/* Subtle ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/5 dark:bg-blue-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/5 dark:bg-indigo-600/10 rounded-full blur-[120px]" />
      </div>

      {/* Mobile sidebar scrim */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/70 backdrop-blur-sm z-[60] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-[110] w-72
        bg-white/90 dark:bg-slate-900/70 border-r border-slate-200 dark:border-white/5
        backdrop-blur-xl transform transition-transform duration-300 ease-out
        ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full p-5 overflow-y-auto custom-sidebar-scroll">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-7 shrink-0">
            <div className="flex-1 min-w-0 bg-white rounded-xl px-4 py-3 ring-1 ring-slate-200 dark:ring-slate-800 flex items-center justify-center">
              <img src="/logo-horizontal.jpg" alt="Portería Virtual" className="h-9 w-auto max-w-full object-contain" />
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden shrink-0 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="Cerrar menú"
            >
              <X size={18} />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-1 mb-6">
            {filteredMenuItems.map((item) => (
              <React.Fragment key={item.key}>
                <SidebarItem
                  to={item.to}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={!item.href && location === item.to}
                  onClick={() => setIsSidebarOpen(false)}
                />
              </React.Fragment>
            ))}
          </nav>

          {/* User card profile trigger */}
          <div className="pt-4 border-t border-slate-200 dark:border-white/5 shrink-0">
            <button
              onClick={handleOpenProfile}
              className="group flex items-center gap-3 p-3 w-full text-left rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.03] dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 transition-colors cursor-pointer shadow-sm hover:shadow-md"
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-semibold shrink-0 group-hover:scale-105 transition-transform">
                {profile?.name?.charAt(0) || 'P'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{profile?.name || 'Usuario'}</p>
                </div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-500 uppercase tracking-wide truncate">{roleLabel}</p>
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-16 lg:h-16 flex items-center justify-between px-4 lg:px-8 bg-white/90 dark:bg-slate-900/70 border-b border-slate-200 dark:border-white/5 backdrop-blur-xl z-40 sticky top-0">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Mobile greeting */}
            <div className="lg:hidden flex flex-col min-w-0">
              <p className="text-base font-bold text-slate-900 dark:text-white leading-tight truncate">
                {(() => { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; })()}, {profile?.name?.split(' ')[0] || 'Usuario'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate leading-tight mt-0.5">
                {({ super_admin: 'Admin. Global', condo_admin: 'Admin. Condo', operator: 'Operador', technician: 'Técnico', resident: 'Residente', usuario: 'Usuario' } as Record<string, string>)[profile?.role || ''] || profile?.role}
                {profile?.condoName ? ` · ${profile.condoName}` : ''}
                {profile?.unit ? ` · ${profile.unit}` : ''}
              </p>
            </div>
            {/* Desktop: condo name */}
            <div className="hidden lg:flex flex-col">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Condominio</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {profile?.condoName || 'Portería Virtual'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <NotificationCenter />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto w-full max-w-full pb-28 lg:pb-10 pt-6 lg:pt-8 px-4 md:px-8 lg:px-12 scroll-smooth no-scrollbar relative">
          {children}
        </div>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/10 flex items-stretch pb-[env(safe-area-inset-bottom)] z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_-8px_30px_rgba(0,0,0,0.5)]">
          {mobileNavItems.map(({ to, href, icon, label, shortLabel, key }) => (
            <React.Fragment key={key}>
              <BottomNavItem to={to} href={href} icon={icon} label={shortLabel || label} active={!href && location === to} />
            </React.Fragment>
          ))}
          {showSidebarButton && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Abrir menú"
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 transition-colors text-slate-500 dark:text-slate-400 cursor-pointer"
            >
              <span className="w-10 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/5">
                <Menu size={19} strokeWidth={2} />
              </span>
              <span className="text-[9px] font-semibold leading-tight whitespace-nowrap">Menú</span>
            </button>
          )}
          <button
            onClick={handleOpenProfile}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 transition-colors text-slate-500 dark:text-slate-400 cursor-pointer"
          >
            <span className="w-10 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/5">
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-semibold text-[13px] flex items-center justify-center shadow-sm shadow-blue-600/30">
                {profile?.name?.charAt(0) || 'P'}
              </span>
            </span>
            <span className="text-[9px] font-semibold leading-tight whitespace-nowrap">Perfil</span>
          </button>
        </nav>
      </main>

      {/* ── Change password modal ── */}
      <Modal
        open={showPwdModal}
        onClose={() => setShowPwdModal(false)}
        title="Cambiar contraseña"
        icon={KeyRound}
        size="sm"
      >
        {pwdSuccess ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <CheckCircle2 size={28} />
            </div>
            <p className="font-semibold text-slate-900 dark:text-white">¡Contraseña actualizada!</p>
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <Field label="Contraseña actual" required>
              <div className="relative">
                <Input
                  type={showCurrent ? 'text' : 'password'}
                  required
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(v => !v)}
                  aria-label={showCurrent ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            <Field label="Nueva contraseña" hint="Mínimo 6 caracteres" required>
              <div className="relative">
                <Input
                  type={showNew ? 'text' : 'password'}
                  required
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="Nueva contraseña"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(v => !v)}
                  aria-label={showNew ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            <Field label="Confirmar contraseña" required>
              <Input
                type="password"
                required
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Repetir nueva contraseña"
                invalid={!!confirmPwd && confirmPwd !== newPwd}
              />
            </Field>

            {pwdError && (
              <p className="text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
                {pwdError}
              </p>
            )}

            <Button type="submit" loading={savingPwd} icon={KeyRound} fullWidth>
              {savingPwd ? 'Guardando…' : 'Actualizar contraseña'}
            </Button>
          </form>
        )}
      </Modal>

      {/* ── Profile modal ── */}
      <Modal
        open={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        size="sm"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pt-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-semibold text-lg flex items-center justify-center shadow-sm shadow-blue-600/30 shrink-0">
            {profile?.name?.charAt(0) || 'P'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 dark:text-white truncate">{profile?.name}</p>
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">{roleLabel}</p>
          </div>
          <button
            onClick={() => setShowProfileModal(false)}
            aria-label="Cerrar perfil"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Condo & Unit */}
        <div className="space-y-2 mb-5">
          {profile?.condoName && (
            <InfoRow icon={Building2} label="Condominio" value={profile.condoName} />
          )}
          {(profile?.buildingId || profile?.unitId) && (
            <InfoRow
              icon={Home}
              label="Unidad"
              value={`${profile.buildingId ? `Torre ${profile.buildingId}` : ''}${profile.buildingId && profile.unitId ? ' — ' : ''}${profile.unitId ? `Depto ${profile.unitId}` : ''}`}
            />
          )}
        </div>

        {/* Assigned operator contact — residents only */}
        {(profile?.role === 'resident' || profile?.role === 'usuario') && (
          <div className="border-t border-slate-200 dark:border-white/10 pt-4 space-y-3">
            <p className="eyebrow">Operador de portería</p>
            {condoOperator ? (
              <>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
                  <div className="w-9 h-9 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Shield size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{condoOperator.name}</p>
                    {condoOperator.email && (
                      <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{condoOperator.email}</p>
                    )}
                  </div>
                </div>

                {condoOperator.phone ? (
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={`tel:${condoOperator.phone}`}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <Phone size={15} /> Llamar
                    </a>
                    <a
                      href={`https://wa.me/${condoOperator.phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <MessageCircle size={15} /> WhatsApp
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-500 text-center italic">Teléfono no registrado</p>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-500 text-center italic py-2">
                Sin operador asignado a este condominio
              </p>
            )}
          </div>
        )}

        {/* Password & logout */}
        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-white/10 space-y-2">
          {isResident && (
            <Link
              to="/manual"
              onClick={() => setShowProfileModal(false)}
              className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-100 text-slate-900 border border-slate-200 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-100 dark:border-white/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <BookOpen size={16} strokeWidth={2.2} />
              <span>Manual del Residente</span>
            </Link>
          )}
          <Button
            variant="secondary"
            icon={KeyRound}
            fullWidth
            onClick={() => { setShowProfileModal(false); setTimeout(openPwdModal, 150); }}
          >
            Cambiar contraseña
          </Button>
          <Button variant="danger" icon={LogOut} fullWidth onClick={handleLogout}>
            Cerrar sesión
          </Button>
          <button
            onClick={() => { setShowProfileModal(false); setTimeout(() => setShowDeleteAccountModal(true), 150); }}
            className="w-full text-xs text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors underline underline-offset-2 py-1 cursor-pointer"
          >
            Eliminar mi cuenta
          </button>
        </div>
      </Modal>

      {/* ── Delete account modal ── */}
      <Modal
        open={showDeleteAccountModal}
        onClose={() => { if (!deletingAccount) { setShowDeleteAccountModal(false); setDeleteAccountError(''); } }}
        size="sm"
      >
        <div className="text-center space-y-4 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Eliminar tu cuenta?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Esta acción es <strong>irreversible</strong>. Se eliminarán tus datos de acceso y tu perfil del sistema.
            </p>
          </div>
          {deleteAccountError && (
            <p className="text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              {deleteAccountError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setShowDeleteAccountModal(false); setDeleteAccountError(''); }} disabled={deletingAccount}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDeleteAccount} loading={deletingAccount}>
              Eliminar cuenta
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

/* Small internal row for the profile modal */
function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
      <Icon size={18} className="text-blue-600 dark:text-blue-400 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{value}</p>
      </div>
    </div>
  );
}

// --- App Component ---
export default function App() {
  // Sync status-bar style with OS dark/light mode on native builds.
  // The EdgeToEdge plugin uses a static backgroundColor; this effect
  // corrects the status-bar appearance at runtime whenever the scheme changes.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const apply = (dark: boolean) => {
      const bg = dark ? '#020617' : '#f8fafc';
      // Style.Dark = light icons (dark background); Style.Light = dark icons (light background).
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
      if (Capacitor.getPlatform() === 'android') {
        // On Android 15+ the StatusBar background is driven by the EdgeToEdge plugin.
        EdgeToEdge.setBackgroundColor({ color: bg }).catch(() => {});
        StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
      }
    };

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/condos" element={<ProtectedRoute allowedRoles={['super_admin']}><Layout><Condos /></Layout></ProtectedRoute>} />
          <Route path="/equipment" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'technician', 'operator']}><Layout><Equipment /></Layout></ProtectedRoute>} />
          <Route path="/technicians" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'operator']}><Layout><Technicians /></Layout></ProtectedRoute>} />
          <Route path="/operators" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'operator']}><Layout><Operators /></Layout></ProtectedRoute>} />
          <Route path="/residents" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'operator', 'technician']}><Layout><Residents /></Layout></ProtectedRoute>} />
          <Route path="/my-unit" element={<ProtectedRoute allowedRoles={['resident']}><Layout><MyUnit /></Layout></ProtectedRoute>} />
          <Route path="/incidents" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'operator', 'technician']}><Layout><Incidents /></Layout></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'resident']}><Layout><Expenses /></Layout></ProtectedRoute>} />
          <Route path="/facilities" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'resident', 'operator']}><Layout><Facilities /></Layout></ProtectedRoute>} />
          <Route path="/visitors" element={<ProtectedRoute allowedRoles={['resident', 'operator', 'super_admin', 'technician', 'condo_admin', 'administrador']}><Layout><Visitors /></Layout></ProtectedRoute>} />
          <Route path="/parcels" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'operator', 'resident']}><Layout><Parcels /></Layout></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute allowedRoles={['super_admin']}><Layout><UserRoles /></Layout></ProtectedRoute>} />
          <Route path="/manual" element={<ProtectedRoute><Layout><ResidentManual /></Layout></ProtectedRoute>} />
          <Route path="/access" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'operator']}><Layout><AccessRecords /></Layout></ProtectedRoute>} />
          <Route path="/wa-numbers" element={<ProtectedRoute allowedRoles={['super_admin']}><Layout><WhatsAppNumbers /></Layout></ProtectedRoute>} />
          <Route path="/wa-chat" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'administrador', 'operator']}><Layout><WhatsAppChat /></Layout></ProtectedRoute>} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/dahua-test" element={<DahuaTest />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
