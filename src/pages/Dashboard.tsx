import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { 
  Users, 
  ShieldAlert, 
  Clock, 
  CheckCircle2, 
  TrendingUp,
  TrendingDown,
  Package, 
  QrCode, 
  Building2, 
  CreditCard, 
  Calendar
} from 'lucide-react';
import { motion } from 'motion/react';

const StatCard = ({ icon: Icon, label, value, color, trend }: { icon: any, label: string, value: string, color: string, trend?: string }) => (
  <div className="glass-card rounded-2xl p-6 border border-white/5 relative overflow-hidden group hover:border-blue-500/50 transition-all duration-500 shadow-lg">
    <div className={`absolute top-0 right-0 w-24 h-24 ${color}/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:scale-150 transition-transform duration-700`} />
    <div className="flex items-start justify-between mb-4 relative">
      <div className={`w-11 h-11 ${color}/10 rounded-xl flex items-center justify-center ${color.replace('bg-', 'text-')} shadow-inner group-hover:scale-110 transition-transform`}>
        <Icon size={22} />
      </div>
      {trend && (
        <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1 ${trend.startsWith('+') ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
          {trend.startsWith('+') ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {trend}
        </div>
      )}
    </div>
    <div className="relative">
      <p className="text-[9px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1">{label}</p>
      <h3 className="text-xl font-black text-white italic tracking-tight">{value}</h3>
    </div>
  </div>
);

const Dashboard = () => {
  const { profile } = useAuth();

  const renderSuperAdmin = () => (
    <div className="space-y-6 sm:space-y-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
        <StatCard icon={Building2} label="Condominios" value="12" color="bg-blue-500" trend="+2" />
        <StatCard icon={Users} label="Total Vecinos" value="1,248" color="bg-indigo-500" trend="+124" />
        <StatCard icon={ShieldAlert} label="Alertas Críticas" value="0" color="bg-red-500" trend="-5" />
      </div>
      

    </div>
  );

  const renderResident = () => (
    <div className="space-y-6 sm:space-y-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <StatCard icon={CreditCard} label="Estado de Pago" value="Al día" color="bg-green-500" />
        <StatCard icon={Calendar} label="Proyectos Reservados" value="1" color="bg-blue-500" />
        <StatCard icon={QrCode} label="Pases Emitidos" value="12" color="bg-purple-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8 lg:gap-10">
        <div className="glass-card rounded-2xl sm:rounded-[2.5rem] p-5 sm:p-10">
           <h3 className="text-lg sm:text-xl font-black text-white mb-5 sm:mb-10 flex items-center gap-3 italic">
              <div className="w-2 h-6 bg-blue-500 rounded-full" />
              Accesos Recientes
           </h3>
           <div className="space-y-5">
             {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-4 sm:p-6 bg-white/5 rounded-2xl sm:rounded-[2rem] border border-white/5 group hover:bg-white/10 transition-all cursor-pointer">
                   <div className="flex items-center gap-4">
                      <div className="w-11 h-11 sm:w-14 sm:h-14 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                         <QrCode size={26} />
                      </div>
                      <div>
                         <p className="font-black text-white leading-tight">Invitado {i}</p>
                         <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Validado vía QR</p>
                      </div>
                   </div>
                   <p className="text-xs font-black text-gray-500">14:3{i}</p>
                </div>
             ))}
           </div>
        </div>

        <div className="glass-card rounded-2xl sm:rounded-[2.5rem] p-5 sm:p-10 bg-gradient-to-br from-gray-900 to-black relative group overflow-hidden">
           <div className="absolute inset-0 bg-blue-600/5 group-hover:scale-110 transition-transform duration-1000" />
           <div className="relative">
              <div className="flex items-center justify-between mb-5 sm:mb-8">
                 <h3 className="text-lg sm:text-xl font-black text-white">Mi Unidad Digital</h3>
                 <div className="px-4 py-1.5 bg-blue-600/10 border border-blue-500/20 rounded-full">
                    <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Activa</span>
                 </div>
              </div>
              <div className="p-5 sm:p-8 bg-black/20 rounded-2xl sm:rounded-[2rem] border border-white/5 flex items-center gap-4 sm:gap-6 mb-5 sm:mb-8">
                 <div className="w-12 h-12 sm:w-16 sm:h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white shrink-0"><Package size={26} /></div>
                 <div>
                    <h4 className="text-xl sm:text-2xl font-black text-white leading-tight uppercase italic">{profile?.condoName || 'Condominio'}</h4>
                    <p className="text-xs text-gray-500 font-black uppercase tracking-widest italic">{profile?.unitId || 'Sector S/N'}</p>
                 </div>
              </div>

           </div>
        </div>
      </div>
    </div>
  );

  const renderOperator = () => (
    <div className="space-y-6 sm:space-y-10">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
        <StatCard icon={ShieldAlert} label="Alertas" value="5" color="bg-red-500" />
        <StatCard icon={Users} label="En Sitio" value="12" color="bg-blue-500" />
        <StatCard icon={Clock} label="SLA" value="4m" color="bg-orange-500" />
        <StatCard icon={CheckCircle2} label="Status" value="OK" color="bg-green-500" />
      </div>

      <div className="glass-card rounded-2xl sm:rounded-[2.5rem] p-5 sm:p-10 overflow-hidden">
        <h3 className="text-lg sm:text-xl font-black text-white mb-5 sm:mb-10 flex items-center gap-3">
          <div className="w-2 h-6 bg-blue-500 rounded-full" />
          Bitácora de Acceso Real-Time
        </h3>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left min-w-[600px]">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase font-black tracking-widest border-b border-white/5">
                <th className="pb-6 px-4">Evento</th>
                <th className="pb-6 px-4">Ubicación</th>
                <th className="pb-6 px-4">Identidad</th>
                <th className="pb-6 text-right px-4">Acción</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="py-6 px-4">
                    <p className="text-blue-500 font-black">14:4{i}</p>
                    <p className="text-[10px] text-gray-600 uppercase font-bold tracking-widest">Hoy</p>
                  </td>
                  <td className="py-6 px-4">
                    <p className="font-black text-white uppercase italic">Puerta {i}A</p>
                    <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Sector Norte</p>
                  </td>
                  <td className="py-6 px-4">
                    <p className="font-black text-white uppercase italic">Invitado Externo</p>
                    <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">QR Validado</p>
                  </td>
                  <td className="py-6 text-right px-4">
                    <span className="px-4 py-1.5 bg-green-500/10 text-green-500 text-[10px] font-black uppercase tracking-widest rounded-full border border-green-500/20">VÁLIDO</span>
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
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl mx-auto pb-12">
      <div className="mb-8 flex items-center justify-between">
        <div className="space-y-0.5">
          <h2 className="text-2xl font-black text-white tracking-tight italic uppercase">Hola, {profile?.name?.split(' ')[0]} 👋</h2>
          <p className="text-xs text-gray-500 font-medium italic">Gestión de {profile?.condoName || 'Portería Virtual Master'}.</p>
        </div>

      </div>

      {profile?.role === 'super_admin' && renderSuperAdmin()}
      {profile?.role === 'resident' && renderResident()}
      {profile?.role === 'operator' && renderOperator()}
      {(profile?.role === 'condo_admin' || profile?.role === 'technician') && renderOperator()}
    </motion.div>
  );
};

export default Dashboard;
