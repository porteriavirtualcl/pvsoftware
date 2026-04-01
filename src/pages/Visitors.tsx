import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { QrCode, Plus, Calendar, Clock, User, Car, Download, X, CheckCircle2, Edit2, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

interface Visitor {
  id: string;
  userId: string;
  visitorName: string;
  entryTime: string;
  exitTime: string;
  date: string;
  licensePlate?: string;
  qrCodeValue: string;
  status: 'pending' | 'entered' | 'exited';
  createdAt: any;
}

const Visitors = () => {
  const { profile, user } = useAuth();
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [newVisitor, setNewVisitor] = useState({
    visitorName: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    entryTime: '12:00',
    exitTime: '18:00',
    licensePlate: '',
  });

  useEffect(() => {
    if (!profile || !user) return;

    let q;
    if (profile.role === 'resident') {
      q = query(
        collection(db, 'condos', profile.condoId || 'default', 'visitors'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
    } else {
      q = query(
        collection(db, 'condos', profile.condoId || 'default', 'visitors'),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const visitorData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Visitor[];
      setVisitors(visitorData);
    }, (error) => {
      console.error("Error fetching visitors:", error);
    });

    return () => unsubscribe();
  }, [profile, user]);

  const handleAddVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    try {
      const qrValue = `VISIT-${user.uid}-${Date.now()}`;
      await addDoc(collection(db, 'condos', profile.condoId || 'default', 'visitors'), {
        ...newVisitor,
        userId: user.uid,
        qrCodeValue: qrValue,
        status: 'pending',
        createdAt: Timestamp.now(),
      });
      setShowAddModal(false);
      setNewVisitor({
        visitorName: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        entryTime: '12:00',
        exitTime: '18:00',
        licensePlate: '',
      });
    } catch (error) {
      console.error("Error adding visitor:", error);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Gestión de Visitas</h2>
          <p className="text-gray-400 mt-1">Genera códigos QR para tus invitados y monitorea accesos.</p>
        </div>
        {profile?.role === 'resident' && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus size={20} />
            Nueva Visita
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visitors.map((visitor) => (
          <motion.div
            layoutId={visitor.id}
            key={visitor.id}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-all cursor-pointer group"
            onClick={() => setSelectedVisitor(visitor)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-blue-900/20 rounded-xl flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                <QrCode size={24} />
              </div>
              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                visitor.status === 'pending' ? 'bg-yellow-900/20 text-yellow-500' :
                visitor.status === 'entered' ? 'bg-green-900/20 text-green-500' :
                'bg-gray-800 text-gray-400'
              }`}>
                {visitor.status === 'pending' ? 'Pendiente' : visitor.status === 'entered' ? 'En Sitio' : 'Finalizado'}
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{visitor.visitorName}</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <Calendar size={14} />
                <span>{visitor.date}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={14} />
                <span>{visitor.entryTime} - {visitor.exitTime}</span>
              </div>
              {visitor.licensePlate && (
                <div className="flex items-center gap-2">
                  <Car size={14} />
                  <span>Patente: {visitor.licensePlate}</span>
                </div>
              )}
            </div>
            <div className="mt-6 pt-4 border-t border-gray-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle edit
                  }}
                  className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors" 
                  title="Editar"
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle delete
                  }}
                  className="p-1.5 text-gray-500 hover:text-red-400 transition-colors" 
                  title="Eliminar"
                >
                  <Trash2 size={16} />
                </button>
                <span className="text-xs text-gray-500 ml-2">ID: {visitor.id.slice(0, 8)}</span>
              </div>
              <button className="text-xs font-bold text-blue-400 hover:text-blue-300">Ver Detalles</button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add Visitor Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold text-white">Nueva Visita</h3>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleAddVisitor} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Nombre del Visitante</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                      required
                      type="text"
                      value={newVisitor.visitorName}
                      onChange={(e) => setNewVisitor({ ...newVisitor, visitorName: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-12 pr-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                      placeholder="Ej: Juan Pérez"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Fecha</label>
                    <input
                      required
                      type="date"
                      value={newVisitor.date}
                      onChange={(e) => setNewVisitor({ ...newVisitor, date: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Patente (Opcional)</label>
                    <input
                      type="text"
                      value={newVisitor.licensePlate}
                      onChange={(e) => setNewVisitor({ ...newVisitor, licensePlate: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                      placeholder="ABCD-12"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Hora Entrada</label>
                    <input
                      required
                      type="time"
                      value={newVisitor.entryTime}
                      onChange={(e) => setNewVisitor({ ...newVisitor, entryTime: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Hora Salida</label>
                    <input
                      required
                      type="time"
                      value={newVisitor.exitTime}
                      onChange={(e) => setNewVisitor({ ...newVisitor, exitTime: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 mt-4"
                >
                  Generar Invitación
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* QR Details Modal */}
      <AnimatePresence>
        {selectedVisitor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedVisitor(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl text-gray-900"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-full flex justify-between items-center mb-6">
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Pase de Acceso</span>
                  <button onClick={() => setSelectedVisitor(null)} className="text-gray-400 hover:text-gray-900">
                    <X size={20} />
                  </button>
                </div>
                
                <div className="bg-gray-50 p-6 rounded-2xl mb-6 shadow-inner">
                  <QRCodeSVG value={selectedVisitor.qrCodeValue} size={200} level="H" />
                </div>

                <h3 className="text-2xl font-bold mb-1">{selectedVisitor.visitorName}</h3>
                <p className="text-sm text-gray-500 mb-6 uppercase tracking-wider font-medium">Visitante Autorizado</p>

                <div className="w-full grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-gray-50 p-3 rounded-xl text-left">
                    <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">Fecha</p>
                    <p className="text-sm font-bold">{selectedVisitor.date}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl text-left">
                    <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">Hora</p>
                    <p className="text-sm font-bold">{selectedVisitor.entryTime}</p>
                  </div>
                </div>

                <button className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white font-bold py-4 rounded-2xl hover:bg-gray-800 transition-all">
                  <Download size={20} />
                  Descargar Pase
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Visitors;
