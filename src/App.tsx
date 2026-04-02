import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';
import { LayoutDashboard, ShieldAlert, Building2, Wrench, Users, CreditCard, Calendar, QrCode, LogOut, Menu, X, Settings, ClipboardList, Home } from 'lucide-react';
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

const SidebarItem = ({ to, icon: Icon, label, active, onClick }: { to: string, icon: any, label: string, active: boolean, onClick?: () => void, key?: string }) => (
  <Link
    to={to}
    onClick={onClick}
    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
      active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
    }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </Link>
);

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { profile } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const menuItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['super_admin', 'condo_admin', 'operator', 'technician', 'resident'] },
    { to: '/condos', icon: Building2, label: 'Condominios', roles: ['super_admin'] },
    { to: '/equipment', icon: Settings, label: 'Equipos', roles: ['super_admin', 'condo_admin', 'technician', 'operator'] },
    { to: '/technicians', icon: Wrench, label: 'Técnicos', roles: ['super_admin', 'condo_admin', 'operator'] },
    { to: '/operators', icon: Users, label: 'Operadores', roles: ['super_admin', 'condo_admin', 'operator'] },
    { to: '/residents', icon: Users, label: 'Residentes', roles: ['super_admin', 'condo_admin', 'operator', 'technician'] },
    { to: '/my-unit', icon: Home, label: 'Mi Unidad', roles: ['resident'] },
    { to: '/incidents', icon: ShieldAlert, label: 'Incidencias', roles: ['super_admin', 'condo_admin', 'operator', 'technician'] },
    { to: '/expenses', icon: CreditCard, label: 'Gastos Comunes', roles: ['super_admin', 'condo_admin', 'resident'] },
    { to: '/facilities', icon: Calendar, label: 'Instalaciones', roles: ['super_admin', 'condo_admin', 'resident', 'operator'] },
    { to: '/visitors', icon: QrCode, label: 'Visitas', roles: ['resident', 'operator', 'super_admin', 'technician'] },
  ];

  const filteredMenuItems = menuItems.filter(item => profile && item.roles.includes(profile.role));

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden font-sans">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gray-900 border-r border-gray-800 transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full p-4">
          <div className="flex items-center gap-3 px-2 mb-8">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <ShieldAlert className="text-white" size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Portería Virtual</h1>
          </div>

          <nav className="flex-1 space-y-1">
            {filteredMenuItems.map((item) => (
              <SidebarItem
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                active={window.location.pathname === item.to}
                onClick={() => setIsSidebarOpen(false)}
              />
            ))}
          </nav>

          <div className="pt-4 mt-4 border-t border-gray-800">
            <div className="px-4 py-3 mb-4">
              <p className="text-sm font-medium text-white truncate">{profile?.name || 'Usuario'}</p>
              <p className="text-xs text-gray-500 truncate uppercase tracking-wider">{roleNames[profile?.role || ''] || 'Cargando...'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-4 py-3 text-gray-400 hover:bg-red-900/20 hover:text-red-400 rounded-lg transition-colors"
            >
              <LogOut size={20} />
              <span className="font-medium">Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 flex items-center justify-between px-4 lg:px-8 bg-gray-900/50 border-b border-gray-800 backdrop-blur-sm">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden p-2 text-gray-400 hover:text-white"
          >
            <Menu size={24} />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-white">Portería Virtual</p>
              <p className="text-xs text-green-500 flex items-center justify-end gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Sistema Activo
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          {children}
        </div>
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
