import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { 
  Users, 
  ShieldAlert, 
  Clock, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Package, 
  QrCode, 
  Building2, 
  CreditCard, 
  ArrowUpRight,
  Shield,
  Smartphone,
  Zap,
  Globe,
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
        <div className={`px-3 py-1 rounded-full text-base font-black uppercase tracking-widest flex items-center gap-1 ${trend.startsWith('+') ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
          {trend.startsWith('+') ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {trend}
        </div>
      )}
    </div>
    <div className="relative">
      <p className="text-[11px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1">{label}</p>
      <h3 className="text-xl font-black text-white italic tracking-tight">{value}</h3>
    </div>
  </div>
);

const Dashboard = () => {
  const { profile } = useAuth();

  const renderSuperAdmin = () => (
    <div className="space-y-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <StatCard icon={Building2} label="Condominios" value="12" color="bg-blue-500" trend="+2" />
        <StatCard icon={Users} label="Total Vecinos" value="1,248" color="bg-indigo-500" trend="+124" />
        <StatCard icon={Activity} label="Dispositivos" value="48/50" color="bg-green-500" trend="ONLINE" />
        <StatCard icon={ShieldAlert} label="Alertas Críticas" value="0" color="bg-red-500" trend="-5" />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 glass-card rounded-[2.5rem] p-10">
          <div className="flex items-center justify-between mb-10">
            <h3 className="text-xl font-black text-white flex items-center gap-3">
              <div className="w-2 h-6 bg-blue-500 rounded-full" />
              Sincronización Cloud-IoT
            </h3>
            <div className="flex items-center gap-2">
               <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
               <span className="text-base font-black text-gray-500 uppercase tracking-widest italic">CGI Bridge Active</span>
            </div>
          </div>
          <div className="space-y-6">
            {[
              { name: 'Acceso Norte LPR', loc: 'Condominio Alborada', status: '85ms', icon: Smartphone },
              { name: 'Facial P_Principal', loc: 'Condominio Los Olivos', status: '120ms', icon: Shield },
              { name: 'NVR Backend 01', loc: 'Casa Matriz', status: '12ms', icon: Globe },
            ].map((d, i) => (
              <div key={i} className="p-6 bg-white/5 rounded-3xl border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all">
                <div className="flex items-center gap-5">
                   <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center text-blue-500 shadow-xl group-hover:rotate-6 transition-transform">
                      <d.icon size={24} />
                   </div>
                   <div>
                      <p className="font-black text-white leading-tight">{d.name}</p>
                      <p className="text-base text-gray-600 font-bold uppercase tracking-widest">{d.loc}</p>
                   </div>
                </div>
                <div className="flex items-center gap-4">
                   <div className="text-right">
                      <p className="text-base font-black text-blue-500 uppercase italic">Latencia</p>
                      <p className="text-base font-bold text-gray-300">{d.status}</p>
                   </div>
                   <ArrowUpRight className="text-gray-700 group-hover:text-white transition-colors" size={20} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-[2.5rem] p-10 relative overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 shadow-2xl">
           <Zap className="absolute top-[-20px] right-[-20px] text-white/10 w-64 h-64 -rotate-12" />
           <div className="relative z-10 h-full flex flex-col">
              <h3 className="text-xl font-black text-white italic mb-4">Command Bridge</h3>
              <p className="text-blue-100 text-base leading-relaxed mb-auto">Servicio de apertura remota sin necesidad de VPN. Encriptación AES-256 activa.</p>
              <div className="space-y-4 pt-10">
                 <div className="flex items-center justify-between text-base font-black uppercase text-blue-200">
                    <span>Carga del Puente</span>
                    <span>85%</span>
                 </div>
                 <div className="w-full bg-white/10 rounded-full h-3 border border-white/5 shadow-inner p-0.5">
                    <motion.div initial={{ width: 0 }} animate={{ width: '85%' }} transition={{ duration: 1.5 }} className="h-full bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.4)]" />
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
        <StatCard icon={Calendar} label="Proyectos Reservados" value="1" color="bg-blue-500" />
        <StatCard icon={QrCode} label="Pases Emitidos" value="12" color="bg-purple-500" />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="glass-card rounded-[2.5rem] p-10">
           <h3 className="text-xl font-black text-white mb-10 flex items-center gap-3 italic">
              <div className="w-2 h-6 bg-blue-500 rounded-full" />
              Accesos Recientes
           </h3>
           <div className="space-y-5">
             {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-6 bg-white/5 rounded-[2rem] border border-white/5 group hover:bg-white/10 transition-all cursor-pointer">
                   <div className="flex items-center gap-5">
                      <div className="w-14 h-14 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                         <QrCode size={26} />
                      </div>
                      <div>
                         <p className="font-black text-white leading-tight">Invitado {i}</p>
                         <p className="text-base text-gray-600 font-bold uppercase tracking-widest">Validado vía QR</p>
                      </div>
                   </div>
                   <p className="text-base font-black text-gray-500">14:3{i}</p>
                </div>
             ))}
           </div>
        </div>

        <div className="glass-card rounded-[2.5rem] p-10 bg-gradient-to-br from-gray-900 to-black relative group overflow-hidden">
           <div className="absolute inset-0 bg-blue-600/5 group-hover:scale-110 transition-transform duration-1000" />
           <div className="relative">
              <div className="flex items-center justify-between mb-8">
                 <h3 className="text-xl font-black text-white">Mi Unidad Digital</h3>
                 <div className="px-4 py-1.5 bg-blue-600/10 border border-blue-500/20 rounded-full">
                    <span className="text-base font-black text-blue-500 uppercase tracking-widest">Activa</span>
                 </div>
              </div>
              <div className="p-8 bg-black/20 rounded-[2rem] border border-white/5 flex items-center gap-6 mb-8">
                 <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white"><Package size={32} /></div>
                 <div>
                    <h4 className="text-3xl font-black text-white leading-tight uppercase italic">{profile?.condoName || 'Condominio'}</h4>
                    <p className="text-base text-gray-500 font-black uppercase tracking-widest italic">{profile?.unitId || 'Sector S/N'}</p>
                 </div>
              </div>
              <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl transition-all active:scale-95">
                 <Lock size={20} />
                 Abrir Acceso Remoto
              </button>
           </div>
        </div>
      </div>
    </div>
  );

  const renderOperator = () => (
    <div className="space-y-10">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
        <StatCard icon={ShieldAlert} label="Alertas" value="5" color="bg-red-500" />
        <StatCard icon={Users} label="En Sitio" value="12" color="bg-blue-500" />
        <StatCard icon={Clock} label="SLA" value="4m" color="bg-orange-500" />
        <StatCard icon={CheckCircle2} label="Status" value="OK" color="bg-green-500" />
      </div>
      
      <div className="glass-card rounded-[2.5rem] p-10 overflow-hidden">
        <h3 className="text-xl font-black text-white mb-10 flex items-center gap-3">
          <div className="w-2 h-6 bg-blue-500 rounded-full" />
          Bitácora de Acceso Real-Time
        </h3>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left min-w-[600px]">
            <thead>
              <tr className="text-base text-gray-500 uppercase font-black tracking-widest border-b border-white/5">
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
                    <p className="text-base text-gray-600 uppercase font-bold tracking-widest">Hoy</p>
                  </td>
                  <td className="py-6 px-4">
                    <p className="font-black text-white uppercase italic">Puerta {i}A</p>
                    <p className="text-base text-gray-600 font-bold uppercase tracking-widest">Sector Norte</p>
                  </td>
                  <td className="py-6 px-4">
                    <p className="font-black text-white uppercase italic">Invitado Externo</p>
                    <p className="text-base text-gray-600 font-bold uppercase tracking-widest">QR Validado</p>
                  </td>
                  <td className="py-6 text-right px-4">
                    <span className="px-4 py-1.5 bg-green-500/10 text-green-500 text-base font-black uppercase tracking-widest rounded-full border border-green-500/20">VÁLIDO</span>
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
          <h2 className="text-3xl font-black text-white tracking-tight italic uppercase">Hola, {profile?.name?.split(' ')[0]} 👋</h2>
          <p className="text-base text-gray-500 font-medium italic">Gestión de {profile?.condoName || 'Portería Virtual Master'}.</p>
        </div>
        <div className="hidden md:flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-2xl px-6 py-3">
           <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
           <span className="text-base font-black text-gray-400 uppercase tracking-[0.2em] italic">Sistema Sincronizado</span>
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
