import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, getDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { 
  Home, 
  Users, 
  Car, 
  CreditCard, 
  Bell, 
  Shield, 
  Lock, 
  Smartphone, 
  ChevronRight, 
  Package, 
  Activity,
  Calendar,
  AlertCircle,
  FileText,
  Clock,
  QrCode,
  ArrowUpRight,
  TrendingUp,
  MapPin,
  Building2,
  Zap,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';

const MyUnit = () => {
  const { profile, user } = useAuth();
  const [unitData, setUnitData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recentVisits, setRecentVisits] = useState<any[]>([]);

  useEffect(() => {
    if (!profile || !user) return;

    // Fetch full profile details
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      setUnitData(doc.data());
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    // Fetch recent visits
    const visitsQuery = query(
      collection(db, `condos/${profile.condoId || 'default'}/visitors`),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    const visitsUnsubscribe = onSnapshot(visitsQuery, (snapshot) => {
      setRecentVisits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribe();
      visitsUnsubscribe();
    };
  }, [profile, user]);

  if (loading) return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-12 pb-20">
      {/* Premium Hero Section */}
      <div className="relative group perspective-1000">
        <div className="absolute inset-0 bg-blue-600/10 rounded-[3rem] blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
        <div className="relative bg-gray-900/50 backdrop-blur-2xl border border-white/5 rounded-[3.5rem] p-12 overflow-hidden flex flex-col md:flex-row items-center gap-12 group-hover:border-blue-500/30 transition-all duration-700 shadow-2xl">
           <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full -mr-32 -mt-32 blur-3xl" />
           
           <div className="w-32 h-32 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2.5rem] flex items-center justify-center text-white shadow-2xl shadow-blue-600/40 relative shrink-0 group-hover:scale-105 transition-transform duration-500">
              <Building2 size={64} />
              <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-green-500 rounded-2xl flex items-center justify-center border-4 border-gray-900 text-white shadow-lg">
                 <CheckCircle2 size={16} />
              </div>
           </div>

           <div className="text-center md:text-left flex-1">
              <div className="flex items-center justify-center md:justify-start gap-4 mb-2">
                 <h2 className="text-4xl font-black text-white italic uppercase tracking-tight">{profile?.condoName || 'Residencia'}</h2>
                 <div className="px-3 py-1 bg-blue-600/10 border border-blue-500/20 rounded-full">
                    <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{profile?.unitId || profile?.unit || 'Unidad Activa'}</span>
                 </div>
              </div>
              <p className="text-gray-400 font-medium text-lg leading-relaxed max-w-xl">
                 Bienvenido a tu panel residencial. Gestiona tus accesos, vehículos y pagos de forma transparente.
              </p>
           </div>

           <div className="flex flex-col items-center md:items-end gap-3 shrink-0">
             <div className="text-right">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest italic mb-1">Estado Cuenta</p>
                <div className="flex items-center gap-2 text-green-500 bg-green-500/10 px-4 py-2 rounded-2xl border border-green-500/20 shadow-xl">
                   <TrendingUp size={16} />
                   <span className="font-black italic uppercase tracking-tighter text-sm">Al Día</span>
                </div>
             </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="glass-card rounded-[2.5rem] p-10 space-y-10 group relative border border-white/5 hover:border-blue-500/30 transition-all">
           <h3 className="text-2xl font-black text-white flex items-center gap-4 italic uppercase tracking-tight">
              <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
              Dotación Vehicular (LPR)
           </h3>
           <div className="space-y-6">
              {unitData?.plates && unitData.plates.length > 0 ? (
                unitData.plates.map((plate: string, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/5 group-hover:bg-white/10 transition-all shadow-inner">
                     <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-gray-950 rounded-2xl flex items-center justify-center text-blue-500 border border-gray-800 shadow-xl"><Car size={26} /></div>
                        <div>
                           <p className="text-xl font-black text-white tracking-widest font-mono uppercase">{plate}</p>
                           <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest group-hover:text-blue-500 transition-colors">Sincronizado LPR</p>
                        </div>
                     </div>
                     <span className="px-3 py-1 bg-green-500/10 text-green-500 text-[10px] font-black uppercase rounded-full border border-green-500/20">Activo</span>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center bg-white/5 border-2 border-dashed border-white/5 rounded-3xl space-y-4">
                   <Car size={40} className="mx-auto text-gray-700" />
                   <p className="text-gray-500 font-bold italic uppercase text-xs">Sin vehículos vinculados</p>
                   <button className="text-[10px] font-black text-blue-500 uppercase tracking-widest border border-blue-500/30 px-6 py-2 rounded-xl">Solicitar Vinculación</button>
                </div>
              )}
           </div>
           <div className="bg-blue-600/5 p-6 rounded-3xl border border-blue-500/20 flex gap-4">
              <Info className="text-blue-500 shrink-0" size={24} />
              <p className="text-xs text-blue-400 font-bold italic leading-relaxed uppercase tracking-tight">Estas patentes están autorizadas para la apertura automática vía cámara. Máximo 2 vehículos.</p>
           </div>
        </div>

        <div className="space-y-10">
           <div className="glass-card rounded-[2.5rem] p-10 bg-gradient-to-br from-gray-900 to-black relative overflow-hidden group">
              <div className="absolute inset-0 bg-blue-600/5 group-hover:scale-125 transition-transform duration-1000" />
              <div className="relative">
                 <h3 className="text-2xl font-black text-white mb-8 italic uppercase tracking-tight">Control Maestría</h3>
                 <div className="grid grid-cols-2 gap-6">
                    <button className="p-8 bg-black/40 rounded-3xl border border-white/5 flex flex-col items-center gap-4 hover:border-blue-500/50 hover:bg-black/60 transition-all group/btn shadow-2xl">
                       <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl group-hover/btn:scale-110 transition-transform"><Lock size={24} /></div>
                       <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] group-hover/btn:text-white transition-colors">Abrir Peatonal</span>
                    </button>
                    <button className="p-8 bg-black/40 rounded-3xl border border-white/5 flex flex-col items-center gap-4 hover:border-blue-500/50 hover:bg-black/60 transition-all group/btn shadow-2xl">
                       <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl group-hover/btn:scale-110 transition-transform"><Smartphone size={24} /></div>
                       <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] group-hover/btn:text-white transition-colors">Portón Autos</span>
                    </button>
                 </div>
              </div>
           </div>

           <div className="glass-card rounded-[2.5rem] p-10 border border-white/5 relative group bg-gray-950/50">
              <div className="flex items-center justify-between mb-8">
                 <h3 className="text-xl font-black text-white flex items-center gap-3 italic">
                    <div className="w-1.5 h-6 bg-purple-500 rounded-full" />
                    Últimas Visitas
                 </h3>
                 <button className="text-[10px] font-black text-blue-500 uppercase tracking-widest p-2 bg-blue-500/5 rounded-xl hover:bg-blue-500/10 transition-colors">Historial</button>
              </div>
              <div className="space-y-4">
                 {recentVisits.length > 0 ? (
                   recentVisits.map((v, i) => (
                      <div key={i} className="p-6 bg-white/5 rounded-3xl border border-white/5 flex items-center justify-between group/v transition-all hover:bg-white/10">
                         <div className="flex items-center gap-5">
                            <div className="w-12 h-12 bg-purple-600/10 rounded-2xl flex items-center justify-center text-purple-400 group-hover/v:scale-110 transition-transform"><QrCode size={22} /></div>
                            <div>
                               <p className="font-black text-white text-lg tracking-tight leading-none uppercase">{v.visitorName}</p>
                               <p className="text-[9px] text-gray-600 font-bold uppercase tracking-widest mt-1">{v.date} • {v.entryTime}</p>
                            </div>
                         </div>
                         <div className={`p-2 rounded-lg ${v.status === 'entered' ? 'text-green-500' : 'text-gray-700'}`}><CheckCircle size={16} /></div>
                      </div>
                   ))
                 ) : (
                   <p className="text-center text-gray-600 italic font-medium py-10 uppercase text-[10px] tracking-widest">Sin actividad de visitas este mes</p>
                 )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default MyUnit;
