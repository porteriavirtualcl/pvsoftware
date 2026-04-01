import React from 'react';
import { motion } from 'motion/react';
import { Wrench, Plus, User, MapPin, Phone, Mail, MoreVertical, CheckCircle2, AlertCircle, Star, Edit2, Trash2 } from 'lucide-react';

const Technicians = () => {
  const technicians = [
    { id: '1', name: 'Carlos Medina', specialty: 'Cámaras IP / Redes', status: 'active', rating: 4.9, activeCases: 2 },
    { id: '2', name: 'Andrés Soto', specialty: 'Barreras / Control Acceso', status: 'active', rating: 4.7, activeCases: 5 },
    { id: '3', name: 'Ricardo Ruiz', specialty: 'Intercomunicadores', status: 'inactive', rating: 4.5, activeCases: 0 },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Equipo Técnico</h2>
          <p className="text-gray-400 mt-1">Gestiona el personal de mantenimiento y soporte técnico.</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20">
          <Plus size={20} />
          Nuevo Técnico
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {technicians.map((tech, i) => (
          <motion.div
            key={tech.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-3xl p-8 hover:border-gray-700 transition-all group relative overflow-hidden"
          >
             <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl" />
            
            <div className="flex items-start justify-between mb-6">
              <div className="w-16 h-16 bg-blue-900/20 rounded-2xl flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                <Wrench size={32} />
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 text-gray-500 hover:text-blue-400 transition-colors" title="Editar">
                  <Edit2 size={18} />
                </button>
                <button className="p-2 text-gray-500 hover:text-red-400 transition-colors" title="Eliminar">
                  <Trash2 size={18} />
                </button>
                <div className="flex items-center gap-1 bg-gray-950 px-2 py-1 rounded-lg border border-gray-800">
                  <Star className="text-yellow-500 fill-yellow-500" size={14} />
                  <span className="text-xs font-bold text-white">{tech.rating}</span>
                </div>
              </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-1">{tech.name}</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium uppercase tracking-wider">{tech.specialty}</p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Casos Activos</p>
                <p className="text-lg font-bold text-white">{tech.activeCases}</p>
              </div>
              <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Estado</p>
                <p className={`text-lg font-bold ${tech.status === 'active' ? 'text-green-500' : 'text-gray-500'}`}>
                  {tech.status === 'active' ? 'Activo' : 'Inactivo'}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-3 rounded-xl transition-all">
                Asignar Caso
              </button>
              <button className="p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-all">
                <Phone size={20} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Technicians;
