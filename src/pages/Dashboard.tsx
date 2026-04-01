import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { LayoutDashboard, ShieldAlert, Building2, Wrench, Users, CreditCard, Calendar, QrCode, ArrowUpRight, ArrowDownRight, Clock, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

const StatCard = ({ icon: Icon, label, value, trend, color }: { icon: any, label: string, value: string | number, trend?: { value: string, up: boolean }, color: string }) => (
  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-lg hover:border-gray-700 transition-all">
    <div className="flex items-center justify-between mb-4">
      <div className={`p-3 rounded-xl ${color} bg-opacity-20`}>
        <Icon className={color.replace('bg-', 'text-')} size={24} />
      </div>
      {trend && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trend.up ? 'text-green-500' : 'text-red-500'}`}>
          {trend.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {trend.value}
        </div>
      )}
    </div>
    <p className="text-sm text-gray-400 font-medium">{label}</p>
    <h3 className="text-2xl font-bold text-white mt-1">{value}</h3>
  </div>
);

const Dashboard = () => {
  const { profile } = useAuth();

  const renderSuperAdmin = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={Building2} label="Condominios" value="12" trend={{ value: '12%', up: true }} color="bg-blue-500" />
        <StatCard icon={Users} label="Usuarios Totales" value="1,240" trend={{ value: '5%', up: true }} color="bg-purple-500" />
        <StatCard icon={ShieldAlert} label="Incidencias Críticas" value="3" trend={{ value: '2', up: false }} color="bg-red-500" />
        <StatCard icon={Wrench} label="Técnicos Activos" value="18" trend={{ value: '1', up: true }} color="bg-orange-500" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-6">Actividad Reciente en Condominios</h3>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-gray-950 rounded-xl border border-gray-800">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-400">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Condominio Los Olivos</p>
                    <p className="text-xs text-gray-500">Nuevo administrador asignado</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">Hace 2h</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-6">Estado Global de Equipos</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Cámaras IP</span>
              <span className="text-sm font-medium text-green-500">98% Operativo</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full" style={{ width: '98%' }} />
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-gray-400">Barreras de Acceso</span>
              <span className="text-sm font-medium text-orange-500">85% Operativo</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div className="bg-orange-500 h-2 rounded-full" style={{ width: '85%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderResident = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard icon={CreditCard} label="Gastos Comunes" value="$45.000" color="bg-green-500" />
        <StatCard icon={Calendar} label="Próxima Reserva" value="Vie, 18:00" color="bg-blue-500" />
        <StatCard icon={QrCode} label="Visitas Hoy" value="2" color="bg-purple-500" />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white">Mis Visitas Planificadas</h3>
            <button className="text-sm font-medium text-blue-400 hover:text-blue-300">Ver Todas</button>
          </div>
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="p-4 bg-gray-950 rounded-xl border border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-purple-900/30 rounded-lg flex items-center justify-center text-purple-400">
                    <QrCode size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Juan Pérez</p>
                    <p className="text-xs text-gray-500">Hoy, 14:00 - 18:00</p>
                  </div>
                </div>
                <button className="text-xs font-medium text-blue-400 hover:text-blue-300">Ver QR</button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white">Mi Unidad</h3>
            <button className="text-sm font-medium text-blue-400 hover:text-blue-300">Gestionar</button>
          </div>
          <div className="p-4 bg-blue-900/20 rounded-xl border border-blue-800/30 flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white">
              <Building2 size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Torre A - 402</p>
              <p className="text-xs text-gray-400">Condominio Los Olivos</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Próximo Vencimiento</span>
              <span className="text-white font-medium">05 de Abril</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Monto Pendiente</span>
              <span className="text-green-500 font-bold">$0 (Al día)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOperator = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={ShieldAlert} label="Alertas Activas" value="5" color="bg-red-500" />
        <StatCard icon={Users} label="Visitantes en Sitio" value="12" color="bg-blue-500" />
        <StatCard icon={Clock} label="Tiempo de Respuesta" value="4m" color="bg-orange-500" />
        <StatCard icon={CheckCircle2} label="Tareas Completadas" value="24" color="bg-green-500" />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-6">Monitor de Accesos en Tiempo Real</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="pb-4 font-medium">Hora</th>
                <th className="pb-4 font-medium">Ubicación</th>
                <th className="pb-4 font-medium">Evento</th>
                <th className="pb-4 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {[1, 2, 3, 4].map((i) => (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="py-4 text-gray-400">14:2{i}</td>
                  <td className="py-4 font-medium text-white">Acceso Principal A</td>
                  <td className="py-4 text-gray-400">Apertura de Barrera</td>
                  <td className="py-4">
                    <span className="px-2 py-1 bg-green-900/20 text-green-500 text-xs rounded-full">Autorizado</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-7xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-white tracking-tight">Bienvenido, {profile?.name}</h2>
        <p className="text-gray-400 mt-1">Aquí tienes un resumen de tu actividad hoy.</p>
      </div>

      {profile?.role === 'super_admin' && renderSuperAdmin()}
      {profile?.role === 'resident' && renderResident()}
      {profile?.role === 'operator' && renderOperator()}
      {(profile?.role === 'condo_admin' || profile?.role === 'technician') && renderOperator()}
    </motion.div>
  );
};

export default Dashboard;
