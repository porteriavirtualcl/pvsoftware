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
  Settings,
  LayoutDashboard,
  QrCode,
  Building2,
  Wrench,
  AlertTriangle,
  History,
  Shield,
  Smartphone,
  ArrowUpRight,
  User as UserIcon,
  Home,
  CheckCircle2,
  Clock,
  Package,
  Activity,
  Zap,
  Lock,
  Search,
  Plus
} from 'lucide-react';

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
      flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 font-bold group
      ${active 
        ? 'bg-blue-600/10 text-blue-500 border border-blue-500/20 shadow-[0_0_20px_rgba(37,99,235,0.1)]' 
        : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}
    `}
  >
    <div className={`
      w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300
      ${active ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-800/50 text-gray-500 group-hover:text-blue-400'}
    `}>
      <Icon size={18} />
    </div>
    <span className="flex-1 text-base">{label}</span>
    {active && <motion.div layoutId="nav-pill" className="w-1.5 h-6 bg-blue-500 rounded-full" />}
  </Link>
);

// --- Bottom Nav Item (Mobile) ---
const BottomNavItem = ({ to, icon: Icon, label, active }: { to: string, icon: any, label: string, active: boolean }) => (
  <Link to={to} className={`flex flex-col items-center justify-center gap-1 transition-all ${active ? 'text-blue-500' : 'text-gray-500'}`}>
    <div className={`p-2 rounded-xl transition-all ${active ? 'bg-blue-600/10' : ''}`}>
      <Icon size={22} className={active ? 'scale-110' : ''} />
    </div>
    <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
  </Link>
);

// --- Global Layout Wrapper ---
const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, profile } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation().pathname;

  const handleLogout = () => {
    localStorage.removeItem('auth_user');
    window.location.href = '/login';
  };

  const menuItems = [
    { to: '/', icon: LayoutDashboard, label: 'Panel Control' },
    { to: '/condos', icon: Building2, label: 'Condominios', roles: ['super_admin'] },
    { to: '/equipment', icon: Wrench, label: 'Equipamiento', roles: ['super_admin', 'condo_admin', 'technician'] },
    { to: '/operators', icon: Shield, label: 'Seguridad / Op.', roles: ['super_admin', 'condo_admin'] },
    { to: '/residents', icon: Users, label: 'Residentes', roles: ['super_admin', 'condo_admin', 'operator'] },
    { to: '/my-unit', icon: Home, label: 'Mi Unidad', roles: ['resident'] },
    { to: '/visitors', icon: QrCode, label: 'Pases de Visita' },
    { to: '/incidents', icon: AlertTriangle, label: 'Incidentes' },
    { to: '/expenses', icon: CreditCard, label: 'Gastos Comunes' },
    { to: '/facilities', icon: Package, label: 'Instalaciones' },
  ];

  const filteredMenuItems = menuItems.filter(item => 
    !item.roles || (profile && item.roles.includes(profile.role))
  );

  const mobileNavItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/visitors', icon: QrCode, label: 'Visitas' },
    { to: '/incidents', icon: AlertTriangle, label: 'Ayuda' },
    { to: '/residents', icon: UserIcon, label: 'Perfil' },
  ];

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
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-xl shadow-blue-600/20">
                <ShieldAlert className="text-white" size={22} />
              </div>
              <div className="flex flex-col">
                <span className="text-base font-black tracking-tight leading-none uppercase">Portería</span>
                <span className="text-[11px] font-black text-blue-500 tracking-[0.3em] uppercase">Virtual</span>
              </div>
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

          <div className="pt-6 border-t border-white/5 space-y-4 shrink-0">
            <div className="bg-white/5 rounded-3xl p-5 border border-white/5 group hover:bg-white/10 transition-all">
              <div className="flex items-center gap-3 mb-1">
                 <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce shrink-0" />
                 <p className="text-base font-black text-white truncate uppercase tracking-tight">{profile?.name || 'Usuario'}</p>
              </div>
              <p className="text-base text-gray-500 font-bold uppercase tracking-widest pl-5 truncate">{profile?.role?.replace('_', ' ') || 'Residente'}</p>
            </div>
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
          {mobileNavItems.map((item) => (
            <BottomNavItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              active={location === item.to}
            />
          ))}
        </nav>
      </main>
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
          <Route path="/settings" element={<ProtectedRoute><Layout><Settings /></Layout></ProtectedRoute>} />
          {/* Dahua DSS diagnostic sandbox — no auth, no Firebase */}
          <Route path="/dahua-test" element={<DahuaTest />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
