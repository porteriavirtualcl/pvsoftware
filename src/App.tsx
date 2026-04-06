import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';
import { LayoutDashboard, ShieldAlert, Building2, Wrench, Users, CreditCard, Calendar, QrCode, LogOut, Menu, X, Settings, ClipboardList, Home, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Pages
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Incidents from './pages/Incidents';
import Facilities from './pages/Facilities';
import Expenses from './pages/Expenses';
import Visitors from './pages/Visitors';
import Condos from './pages/Condos';
import Equipment from './pages/Equipment';
import Technicians from './pages/Technicians';
import Operators from './pages/Operators';
import Residents from './pages/Residents';
import MyUnit from './pages/MyUnit';
import Devices from './pages/Devices';

const roleNames: Record<string, string> = {
  super_admin: 'Super Administrador',
  condo_admin: 'Administrador',
  operator: 'Operador',
  technician: 'Técnico',
  resident: 'Residente'
};

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) => {
  const { user, profile, loading } = useAuth();

  if (loading) return <div className="flex items-center justify-center h-screen bg-gray-950 text-white">Cargando...</div>;
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) return <Navigate to="/" />;

  return <>{children}</>;
};

import NotificationCenter from './components/NotificationCenter';

const SidebarItem = ({ to, icon: Icon, label, active, onClick }: { to: string, icon: any, label: string, active: boolean, onClick?: () => void }) => (
  <Link
    to={to}
    className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-all ${
      active ? 'text-blue-500 scale-105' : 'text-gray-500'
    }`}
  >
    <Icon size={22} strokeWidth={active ? 2.5 : 2} />
    <span className={`text-[10px] font-black uppercase tracking-widest ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
  </Link>
);

const BottomNavItem = ({ to, icon: Icon, label, active, onClick }: { key?: string, to?: string, icon: any, label: string, active?: boolean, onClick?: () => void }) => {
  const content = (
    <div className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-all ${
      active ? 'text-blue-500 scale-105' : 'text-gray-500'
    }`}>
      <Icon size={22} strokeWidth={active ? 2.5 : 2} />
      <span className={`text-[10px] font-black uppercase tracking-widest ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
    </div>
  );

  if (to) return <Link to={to} onClick={onClick}>{content}</Link>;
  return <button onClick={onClick} className="flex-1">{content}</button>;
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { profile } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = window.location.pathname;

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const menuItems = [
    { to: '/', icon: LayoutDashboard, label: 'Inicio', roles: ['super_admin', 'condo_admin', 'operator', 'technician', 'resident'] },
    { to: '/condos', icon: Building2, label: 'Condos', roles: ['super_admin'] },
    { to: '/equipment', icon: Settings, label: 'Equipos', roles: ['super_admin', 'condo_admin', 'technician', 'operator'] },
    { to: '/devices', icon: Cpu, label: 'Dispositivos', roles: ['super_admin', 'condo_admin', 'operator'] },
    { to: '/technicians', icon: Wrench, label: 'Técnicos', roles: ['super_admin', 'condo_admin', 'operator'] },
    { to: '/operators', icon: Users, label: 'Operadores', roles: ['super_admin', 'condo_admin', 'operator'] },
    { to: '/residents', icon: Users, label: 'Residentes', roles: ['super_admin', 'condo_admin', 'operator', 'technician'] },
    { to: '/my-unit', icon: Home, label: 'Mi Unidad', roles: ['resident'] },
    { to: '/incidents', icon: ShieldAlert, label: 'Incidencias', roles: ['super_admin', 'condo_admin', 'operator', 'technician'] },
    { to: '/expenses', icon: CreditCard, label: 'Gastos', roles: ['super_admin', 'condo_admin', 'resident'] },
    { to: '/facilities', icon: Calendar, label: 'Reservas', roles: ['super_admin', 'condo_admin', 'resident', 'operator'] },
    { to: '/visitors', icon: QrCode, label: 'Visitas', roles: ['resident', 'operator', 'super_admin', 'technician'] },
  ];

  const filteredMenuItems = menuItems.filter(item => profile && item.roles.includes(profile.role));

  // Quick actions for mobile navigation
  const mobileNavItems = [
    { to: '/', icon: LayoutDashboard, label: 'Inicio' },
    { to: '/incidents', icon: ShieldAlert, label: 'Incidencias' },
    { to: '/visitors', icon: QrCode, label: 'Visitas' },
    { to: profile?.role === 'resident' ? '/my-unit' : '/residents', icon: Users, label: 'Perfil' },
  ];

  return (
    <div className="flex h-screen bg-[#020617] text-gray-100 overflow-hidden font-sans selection:bg-blue-500/30">
      {/* Mobile Sidebar Overlay */}
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

      {/* Sidebar for Desktop / Tablet */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-[110] w-72 bg-gray-900 border-r border-white/5 transform transition-transform duration-500 ease-in-out
        ${isSidebarOpen ? 'translate-x-0 shadow-2xl overflow-y-auto no-scrollbar' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col min-h-full p-6 pb-32 lg:pb-6">
          <div className="flex items-center justify-between mb-10 px-2 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-blue-600 rounded-[1.25rem] flex items-center justify-center shadow-xl shadow-blue-600/20 group cursor-pointer hover:rotate-12 transition-transform">
                <ShieldAlert className="text-white" size={26} />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-black tracking-tight leading-none">PORTERÍA</span>
                <span className="text-[10px] font-black text-blue-500 tracking-[0.3em]">VIRTUAL</span>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-gray-500 hover:text-white">
              <X size={24} />
            </button>
          </div>

          <nav className="flex-1 space-y-2">
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

          <div className="pt-6 mt-6 border-t border-white/5 space-y-4 shrink-0">
            <div className="bg-white/5 rounded-3xl p-5 border border-white/5 group hover:bg-white/10 transition-colors">
              <div className="flex items-center gap-3 mb-1">
                 <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
                 <p className="text-sm font-black text-white truncate">{profile?.name || 'Usuario'}</p>
              </div>
              <p className="text-[10px] text-gray-500 truncate uppercase font-bold tracking-widest pl-5">{profile?.role?.replace('_', ' ') || 'Cargando...'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-5 py-4 text-gray-500 hover:bg-red-500/10 hover:text-red-500 rounded-2xl transition-all font-bold"
            >
              <LogOut size={20} />
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-18 min-h-[4.5rem] flex items-center justify-between px-6 lg:px-10 bg-gray-900/50 border-b border-white/5 backdrop-blur-xl z-40 sticky top-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2.5 text-gray-400 hover:text-white bg-white/5 rounded-2xl transition-colors"
            >
              <Menu size={24} />
            </button>
            <div className="sm:hidden flex flex-col">
              <span className="text-sm font-black tracking-tight leading-none">PORTERÍA</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4 sm:gap-6">
            <NotificationCenter />
            
            <div className="text-right hidden sm:block border-l border-white/5 pl-6">
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-0.5">SISTEMA ACTIVO</p>
              <p className="text-sm font-bold text-white flex items-center justify-end gap-1.5">
                {profile?.condoName || 'Master Dashboard'}
              </p>
            </div>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-500/20 shrink-0">
              {profile?.name?.charAt(0) || 'U'}
            </div>
            
            <button 
              onClick={handleLogout}
              className="hidden lg:flex items-center gap-2 px-4 py-2 bg-red-500/5 hover:bg-red-500/10 text-red-500/70 hover:text-red-500 rounded-xl transition-all font-bold text-xs border border-red-500/10"
              title="Cerrar Sesión"
            >
              <LogOut size={16} />
              <span>SALIR</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto w-full max-w-full pb-32 lg:pb-12 pt-6 lg:pt-10 px-4 md:px-8 lg:px-12 scroll-smooth no-scrollbar">
          {children}
        </div>

        {/* Mobile Bottom Navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-20 bg-gray-900/90 backdrop-blur-2xl border-t border-white/10 flex items-center justify-around px-4 pb-[env(safe-area-inset-bottom)] z-[100] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
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

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/condos" element={<ProtectedRoute allowedRoles={['super_admin']}><Layout><Condos /></Layout></ProtectedRoute>} />
          <Route path="/equipment" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'technician', 'operator']}><Layout><Equipment /></Layout></ProtectedRoute>} />
          <Route path="/devices" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator']}><Layout><Devices /></Layout></ProtectedRoute>} />
          <Route path="/technicians" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator']}><Layout><Technicians /></Layout></ProtectedRoute>} />
          <Route path="/operators" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator']}><Layout><Operators /></Layout></ProtectedRoute>} />
          <Route path="/residents" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator', 'technician']}><Layout><Residents /></Layout></ProtectedRoute>} />
          <Route path="/my-unit" element={<ProtectedRoute allowedRoles={['resident']}><Layout><MyUnit /></Layout></ProtectedRoute>} />
          <Route path="/incidents" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'operator', 'technician']}><Layout><Incidents /></Layout></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'resident']}><Layout><Expenses /></Layout></ProtectedRoute>} />
          <Route path="/facilities" element={<ProtectedRoute allowedRoles={['super_admin', 'condo_admin', 'resident', 'operator']}><Layout><Facilities /></Layout></ProtectedRoute>} />
          <Route path="/visitors" element={<ProtectedRoute allowedRoles={['resident', 'operator', 'super_admin', 'technician']}><Layout><Visitors /></Layout></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
