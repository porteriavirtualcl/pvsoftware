import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert,
  Users,
  UserPlus,
  MapPin,
  Database,
  CreditCard,
  Calendar,
  LogOut,
  Menu,
  X,
  Bell,
  ChevronRight,
  LayoutDashboard,
  QrCode,
  Building2,
  Wrench,
  AlertTriangle,
  History,
  Shield,
  Smartphone,
  ArrowUpRight,
  Home,
  CheckCircle2,
  Clock,
  Package,
  Activity,
  Zap,
  Lock,
  Search,
  Plus,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import { getAuth, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { db } from './firebase';
import { doc, onSnapshot } from 'firebase/firestore';

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
import DahuaTest from './pages/DahuaTest';

// Components
import NotificationCenter from './components/NotificationCenter';

// --- Protected Route ---
const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) => {
  const { user, profile, loading, isAuthReady, error } = useAuth();

  if (!isAuthReady || loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="relative">
          <div className="w-20 h-20 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <ShieldAlert className="text-blue-500" size={24} />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// --- Sidebar Item ---
const SidebarItem = ({ to, icon: Icon, label, active, onClick }: { to: string, icon: any, label: string, active: boolean, onClick?: () => void }) => (
  <Link
    to={to}
    onClick={onClick}
    className={`
      flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all duration-300 font-bold group
      ${active
        ? 'bg-blue-600/15 text-blue-400 border border-blue-500/25 shadow-[0_0_20px_rgba(37,99,235,0.12)]'
        : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}
    `}
  >
    <div className={`
      w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300
      ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'bg-gray-800/60 text-gray-500 group-hover:bg-gray-700/60 group-hover:text-blue-400'}
    `}>
      <Icon size={17} strokeWidth={2.2} />
    </div>
    <span className="flex-1 text-[15px] font-semibold tracking-wide">{label}</span>
    {active && <div className="w-1 h-5 bg-blue-500 rounded-full" />}
  </Link>
);

// --- Bottom Nav Item (Mobile) ---
const BottomNavItem = ({ to, icon: Icon, label, active }: { to: string, icon: any, label: string, active: boolean }) => (
  <Link to={to} className={`flex flex-col items-center justify-center gap-1.5 px-2 py-1 min-w-[56px] transition-all ${active ? 'text-blue-400' : 'text-gray-500'}`}>
    <div className={`w-12 h-10 rounded-2xl flex items-center justify-center transition-all ${active ? 'bg-blue-600/20 border border-blue-500/30' : 'hover:bg-white/5'}`}>
      <Icon size={22} strokeWidth={active ? 2.5 : 2} />
    </div>
    <span className="text-[10px] font-bold uppercase tracking-wider leading-none">{label}</span>
  </Link>
);

// --- Global Layout Wrapper ---
const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, profile } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation().pathname;
  const [condoSettings, setCondoSettings] = useState<{ expensesEnabled?: boolean } | null>(null);

  // Listen to the user's condo doc to get per-condo feature flags
  useEffect(() => {
    const condoId = profile?.condoId;
    // super_admin / condoScope=all always have full access — no need to fetch
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

  // ── Change password modal ──────────────────────────────────────────────────
  const [showPwdModal, setShowPwdModal]   = useState(false);
  const [currentPwd, setCurrentPwd]       = useState('');
  const [newPwd, setNewPwd]               = useState('');
  const [confirmPwd, setConfirmPwd]       = useState('');
  const [showCurrent, setShowCurrent]     = useState(false);
  const [showNew, setShowNew]             = useState(false);
  const [pwdError, setPwdError]           = useState('');
  const [pwdSuccess, setPwdSuccess]       = useState(false);
  const [savingPwd, setSavingPwd]         = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    if (newPwd !== confirmPwd) { setPwdError('Las contraseñas no coinciden.'); return; }
    if (newPwd.length < 6) { setPwdError('La contraseña debe tener al menos 6 caracteres.'); return; }
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
      setTimeout(() => { setPwdSuccess(false); setShowPwdModal(false); }, 2000);
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

  const handleLogout = () => {
    localStorage.removeItem('auth_user');
    window.location.href = '/login';
  };

  const menuItems = [
    { to: '/', icon: LayoutDashboard, label: 'Panel Control' },
    { to: '/condos',    icon: Building2,    label: 'Condominios',    roles: ['super_admin'] },
    { to: '/equipment', icon: Wrench,       label: 'Equipamiento',   roles: ['super_admin', 'condo_admin', 'technician'] },
    { to: '/operators', icon: Shield,       label: 'Seguridad / Op.', roles: ['super_admin', 'condo_admin'] },
    { to: '/residents', icon: Users,        label: 'Residentes',     roles: ['super_admin', 'condo_admin', 'operator'] },
    { to: '/visitors',  icon: QrCode,       label: 'Pases de Visita', roles: ['super_admin', 'condo_admin', 'operator', 'resident', 'technician'] },
    { to: '/incidents', icon: AlertTriangle, label: 'Incidentes',    roles: ['super_admin', 'condo_admin', 'operator', 'technician'] },
    { to: '/expenses',  icon: CreditCard,   label: 'Gastos Comunes', roles: ['super_admin', 'condo_admin', 'resident'], requireExpenses: true },
    { to: '/facilities', icon: Package,     label: 'Instalaciones',  roles: ['super_admin', 'condo_admin', 'operator', 'resident'] },
  ];

  const filteredMenuItems = menuItems.filter(item => {
    if (item.roles && !(profile && item.roles.includes(profile.role))) return false;
    if (item.requireExpenses && !condoSettings?.expensesEnabled) return false;
    return true;
  });

  // Mobile bottom nav: Dashboard is always first, then up to 4 role-specific items
  const mobileNavItems = [
    filteredMenuItems[0], // Panel Control (always)
    ...filteredMenuItems.slice(1, 5),
  ].filter(Boolean);

  return (
    <div className="flex h-screen bg-black text-white font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px] animate-pulse delay-1000" />
      </div>

      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-[110] w-72 bg-gray-900/50 border-r border-white/5 transform transition-transform duration-500 ease-in-out backdrop-blur-xl
        ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full p-6 overflow-y-auto custom-sidebar-scroll">
          <div className="flex items-center justify-between mb-8 px-2 shrink-0">
            <div className="bg-white rounded-xl px-4 py-2 shadow-lg shadow-black/30">
              <img src="/logo-horizontal.jpg" alt="Portería Virtual" className="h-7 w-auto object-contain" />
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 space-y-2 mb-10">
            {filteredMenuItems.map((item) => (
              <SidebarItem
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                active={location === item.to}
                onClick={() => setIsSidebarOpen(false)}
              />
            ))}
          </nav>

          <div className="pt-6 border-t border-white/5 space-y-3 shrink-0">
            <div className="bg-white/5 rounded-3xl p-5 border border-white/5 group hover:bg-white/10 transition-all">
              <div className="flex items-center gap-3 mb-1">
                 <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce shrink-0" />
                 <p className="text-base font-black text-white truncate uppercase tracking-tight">{profile?.name || 'Usuario'}</p>
              </div>
              <p className="text-base text-gray-500 font-bold uppercase tracking-widest pl-5 truncate">{profile?.role?.replace('_', ' ') || 'Residente'}</p>
            </div>
            <button
              onClick={() => { setPwdError(''); setPwdSuccess(false); setCurrentPwd(''); setNewPwd(''); setConfirmPwd(''); setShowPwdModal(true); }}
              className="flex items-center gap-3 w-full px-6 py-3.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-2xl transition-all font-bold text-sm tracking-widest uppercase border border-white/5"
            >
              <KeyRound size={16} />
              <span>Cambiar Contraseña</span>
            </button>
            <button
               onClick={() => { localStorage.clear(); window.location.href='/login'; }}
               className="flex items-center gap-3 w-full px-6 py-4 bg-red-600/5 text-red-500/70 hover:bg-red-600 hover:text-white rounded-2xl transition-all font-black text-base tracking-[0.2em] uppercase group shadow-lg shadow-red-900/5 border border-red-500/10"
            >
              <LogOut size={18} className="group-hover:-translate-x-1 transition-transform" />
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-18 min-h-[4.5rem] flex items-center justify-between px-6 lg:px-10 bg-gray-900/50 border-b border-white/5 backdrop-blur-xl z-40 sticky top-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2.5 text-gray-400 hover:text-white bg-white/5 rounded-2xl transition-colors shadow-inner"
            >
              <Menu size={24} />
            </button>
            <div className="hidden sm:flex flex-col">
              <p className="text-base font-black text-gray-500 uppercase tracking-widest">Estado Sistema</p>
              <p className="text-base font-bold text-blue-500 flex items-center gap-1.5 uppercase italic">
                {profile?.condoName || 'Global Security System'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 sm:gap-6">
            <NotificationCenter />
            
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-500/20">
              {profile?.name?.charAt(0) || 'P'}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto w-full max-w-full pb-32 lg:pb-12 pt-6 lg:pt-10 px-4 md:px-8 lg:px-12 scroll-smooth no-scrollbar relative">
          {children}
        </div>

        {/* Mobile Navbar */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-20 bg-gray-900/90 backdrop-blur-3xl border-t border-white/10 flex items-center justify-around px-4 pb-[env(safe-area-inset-bottom)] z-[100] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
          {mobileNavItems.map(({ to, icon, label }) => (
            <React.Fragment key={to}>
              <BottomNavItem to={to} icon={icon} label={label} active={location === to} />
            </React.Fragment>
          ))}
        </nav>
      </main>

      {/* ── Change password modal ────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPwdModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowPwdModal(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-400">
                    <KeyRound size={18} />
                  </div>
                  <h3 className="text-lg font-black text-white">Cambiar Contraseña</h3>
                </div>
                <button onClick={() => setShowPwdModal(false)} className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>

              {pwdSuccess ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="w-14 h-14 bg-green-500/10 rounded-full flex items-center justify-center text-green-400">
                    <CheckCircle2 size={28} />
                  </div>
                  <p className="text-white font-bold">¡Contraseña actualizada!</p>
                </div>
              ) : (
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Contraseña actual</label>
                    <div className="relative">
                      <input type={showCurrent ? 'text' : 'password'} required value={currentPwd}
                        onChange={e => setCurrentPwd(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-4 pr-10 text-white focus:border-blue-600 outline-none"
                        placeholder="••••••••" />
                      <button type="button" onClick={() => setShowCurrent(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                        {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Nueva contraseña</label>
                    <div className="relative">
                      <input type={showNew ? 'text' : 'password'} required value={newPwd}
                        onChange={e => setNewPwd(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-4 pr-10 text-white focus:border-blue-600 outline-none"
                        placeholder="Mín. 6 caracteres" />
                      <button type="button" onClick={() => setShowNew(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                        {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Confirmar contraseña</label>
                    <input type="password" required value={confirmPwd}
                      onChange={e => setConfirmPwd(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 outline-none"
                      placeholder="Repetir nueva contraseña" />
                  </div>
                  {pwdError && <p className="text-red-400 text-xs font-bold bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{pwdError}</p>}
                  <button type="submit" disabled={savingPwd}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
                    {savingPwd
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Guardando…</>
                      : <><KeyRound size={15} />Actualizar Contraseña</>}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- App Component ---
export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/condos" element={<ProtectedRoute allowedRoles={['super_admin']}><Layout><Condos /></Layout></ProtectedRoute>} />
          <Route path="/equipment" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'technician', 'operator']}><Layout><Equipment /></Layout></ProtectedRoute>} />
          <Route path="/technicians" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator']}><Layout><Technicians /></Layout></ProtectedRoute>} />
          <Route path="/operators" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator']}><Layout><Operators /></Layout></ProtectedRoute>} />
          <Route path="/residents" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator', 'technician']}><Layout><Residents /></Layout></ProtectedRoute>} />
          <Route path="/my-unit" element={<ProtectedRoute allowedRoles={['resident']}><Layout><MyUnit /></Layout></ProtectedRoute>} />
          <Route path="/incidents" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator', 'technician']}><Layout><Incidents /></Layout></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'resident']}><Layout><Expenses /></Layout></ProtectedRoute>} />
          <Route path="/facilities" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'resident', 'operator']}><Layout><Facilities /></Layout></ProtectedRoute>} />
          <Route path="/visitors" element={<ProtectedRoute allowedRoles={['resident', 'operator', 'super_admin', 'technician']}><Layout><Visitors /></Layout></ProtectedRoute>} />
          {/* /settings removed — password change is in sidebar modal */}
          {/* Dahua DSS diagnostic sandbox — no auth, no Firebase */}
          <Route path="/dahua-test" element={<DahuaTest />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
