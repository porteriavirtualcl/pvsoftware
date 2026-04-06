import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { LayoutDashboard, ShieldAlert, Building2, Wrench, Users, CreditCard, Calendar, QrCode, ArrowUpRight, ArrowDownRight, Clock, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

const StatCard = ({ icon: Icon, label, value, trend, color }: { icon: any, label: string, value: string | number, trend?: { value: string, up: boolean }, color: string }) => (
  <div className="glass-card rounded-[2rem] p-7 shadow-2xl hover:border-blue-500/30 transition-all group overflow-hidden relative">
    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
    <div className="flex items-center justify-between mb-6 relative">
      <div className={`p-4 rounded-2xl ${color} bg-opacity-10 group-hover:bg-opacity-20 transition-all shadow-inner`}>
        <Icon className={color.replace('bg-', 'text-')} size={28} />
      </div>
      {trend && (
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black tracking-widest ${trend.up ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
          {trend.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {trend.value}
        </div>
      )}
    </div>
    <p className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em] mb-1 relative">{label}</p>
    <h3 className="text-3xl font-black text-white relative leading-none">{value}</h3>
  </div>
);

const Dashboard = () => {
  const { profile } = useAuth();

  const renderSuperAdmin = () => (
    <div className="space-y-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <StatCard icon={Building2} label="Condominios" value="12" trend={{ value: '12%', up: true }} color="bg-blue-500" />
        <StatCard icon={Users} label="Usuarios" value="1,240" trend={{ value: '5%', up: true }} color="bg-purple-500" />
        <StatCard icon={ShieldAlert} label="Alertas" value="3" trend={{ value: '2', up: false }} color="bg-red-500" />
        <StatCard icon={Wrench} label="Soporte" value="18" trend={{ value: '1', up: true }} color="bg-orange-500" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="glass-card rounded-[2.5rem] p-10 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full -mr-32 -mt-32 blur-3xl opacity-50" />
          <h3 className="text-xl font-black text-white mb-8 flex items-center gap-3 relative">
            <div className="w-2 h-6 bg-blue-500 rounded-full" />
            Actividad Reciente
          </h3>
          <div className="space-y-5 relative">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-5 bg-white/5 rounded-3xl border border-white/5 hover:bg-white/10 transition-colors cursor-pointer group">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform shadow-inner">
                    <Building2 size={24} />
                  </div>
                  <div>
                    <p className="text-base font-black text-white leading-tight">Los Olivos</p>
                    <p className="text-xs text-gray-500 font-medium">Nuevo reporte generado</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-gray-500 uppercase">2:0{i} PM</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card rounded-[2.5rem] p-10 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/5 rounded-full -mr-32 -mt-32 blur-3xl opacity-50" />
          <h3 className="text-xl font-black text-white mb-8 flex items-center gap-3 relative">
            <div className="w-2 h-6 bg-green-500 rounded-full" />
            Estado de Equipos
          </h3>
          <div className="space-y-8 relative">
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Cámaras IP</span>
                <span className="text-xs font-black text-green-500 uppercase">98% Online</span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-3 p-0.5 border border-white/5 shadow-inner">
                <div className="bg-gradient-to-r from-green-600 to-green-400 h-full rounded-full shadow-[0_0_10px_rgba(34,197,94,0.4)]" style={{ width: '98%' }} />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Controles QR</span>
                <span className="text-xs font-black text-blue-500 uppercase">100% Online</span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-3 p-0.5 border border-white/5 shadow-inner">
                <div className="bg-gradient-to-r from-blue-600 to-blue-400 h-full rounded-full shadow-[0_0_10px_rgba(37,99,235,0.4)]" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Barreras LPR</span>
                <span className="text-xs font-black text-orange-500 uppercase">85% Online</span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-3 p-0.5 border border-white/5 shadow-inner">
                <div className="bg-gradient-to-r from-orange-600 to-orange-400 h-full rounded-full shadow-[0_0_10px_rgba(249,115,22,0.4)]" style={{ width: '85%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderResident = () => (
    <div className="space-y-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        <StatCard icon={CreditCard} label="Estado de Pago" value="Al día" color="bg-green-500" />
        <StatCard icon={Calendar} label="Reservas Semanales" value="1 Programada" color="bg-blue-500" />
        <StatCard icon={QrCode} label="Pases Emitidos" value="12 Activos" color="bg-purple-500" />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="glass-card rounded-[2.5rem] p-10">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-black text-white flex items-center gap-3">
              <div className="w-2 h-6 bg-purple-500 rounded-full" />
              Visitas Hoy
            </h3>
            <button className="text-xs font-black text-blue-500 uppercase tracking-widest hover:text-blue-400 transition-colors">Historial</button>
          </div>
          <div className="space-y-5">
            {[1, 2].map((i) => (
              <div key={i} className="p-6 bg-white/5 rounded-[2rem] border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all cursor-pointer">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 bg-purple-600/10 rounded-2xl flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform shadow-inner">
                    <QrCode size={26} />
                  </div>
                  <div>
                    <p className="text-lg font-black text-white leading-tight">Invitado {i}</p>
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Pase Familiar</p>
                  </div>
                </div>
                <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-blue-400 opacity-0 group-hover:opacity-100 transition-all shadow-xl">
                  <ArrowUpRight size={18} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-[2.5rem] p-10 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-indigo-600/5 group-hover:scale-110 transition-transform duration-700" />
          <div className="relative">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-black text-white">Mi Residencia</h3>
              <div className="px-4 py-1.5 bg-blue-600/10 border border-blue-500/20 rounded-full">
                <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Torre A • 402</span>
              </div>
            </div>
            
            <div className="p-8 bg-black/20 rounded-3xl border border-white/5 mb-8">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 bg-blue-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-2xl shadow-blue-600/40">
                  <Building2 size={32} />
                </div>
                <div>
                  <h4 className="text-2xl font-black text-white leading-none mb-1">{profile?.condoName || 'Los Olivos'}</h4>
                  <p className="text-sm text-gray-500 font-medium italic">Acceso vehicular habilitado</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 p-5 rounded-2xl border border-white/5">
                <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1">Monto Gastos</p>
                <p className="text-xl font-black text-green-500">$45.000</p>
              </div>
              <div className="bg-white/5 p-5 rounded-2xl border border-white/5">
                <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1">Cerradura App</p>
                <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest underline cursor-pointer">Abrir Portón</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOperator = () => (
    <div className="space-y-10 text-gray-100">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <StatCard icon={ShieldAlert} label="Alertas" value="5" color="bg-red-500" />
        <StatCard icon={Users} label="En Sitio" value="12" color="bg-blue-500" />
        <StatCard icon={Clock} label="SLA" value="4m" color="bg-orange-500" />
        <StatCard icon={CheckCircle2} label="Status" value="OK" color="bg-green-500" />
      </div>
      <div className="glass-card rounded-[2.5rem] p-10 overflow-hidden relative">
        <h3 className="text-xl font-black text-white mb-10 flex items-center gap-3">
          <div className="w-2 h-6 bg-blue-500 rounded-full" />
          Protocolos de Acceso
        </h3>
        <div className="overflow-x-auto no-scrollbar -mx-2">
          <table className="w-full text-left min-w-[600px]">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase font-black tracking-[0.2em] border-b border-white/5">
                <th className="pb-6 font-medium px-2">Registro</th>
                <th className="pb-6 font-medium px-2">Punto de Control</th>
                <th className="pb-6 font-medium px-2">Identidad</th>
                <th className="pb-6 font-medium text-right px-2">Autorización</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {[1, 2, 3, 4].map((i) => (
                <tr key={i} className="border-b border-white/5 group hover:bg-white/5 transition-colors">
                  <td className="py-6 px-2">
                    <p className="text-blue-500 font-black tracking-tight">14:2{i}</p>
                    <p className="text-[10px] font-bold text-gray-600 uppercase">Hoy</p>
                  </td>
                  <td className="py-6 px-2">
                    <p className="font-black text-white">Puerta {i}A</p>
                    <p className="text-[10px] font-bold text-gray-600 uppercase">Sector Norte</p>
                  </td>
                  <td className="py-6 px-2">
                    <p className="font-black text-white">QR Sincronizado</p>
                    <p className="text-[10px] font-bold text-gray-600 uppercase">Invitado Externo</p>
                  </td>
                  <td className="py-6 text-right px-2">
                    <span className="px-4 py-1.5 bg-green-500/10 text-green-500 text-[10px] font-black uppercase tracking-widest rounded-full border border-green-500/20">
                      VÁLIDO
                    </span>
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
