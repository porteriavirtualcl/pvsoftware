import React from 'react';
import { motion } from 'motion/react';
import { Building2, Plus, MapPin, Users, MoreVertical, Edit2, Trash2 } from 'lucide-react';

const Condos = () => {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Condominios</h2>
          <p className="text-gray-400 mt-1">Administra los complejos residenciales registrados.</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20">
          <Plus size={20} />
          Nuevo Condominio
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-all"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-blue-900/20 rounded-xl flex items-center justify-center text-blue-400">
                <Building2 size={24} />
              </div>
              <div className="flex gap-2">
                <button className="p-2 text-gray-500 hover:text-blue-400 transition-colors" title="Editar">
                  <Edit2 size={18} />
                </button>
                <button className="p-2 text-gray-500 hover:text-red-400 transition-colors" title="Eliminar">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Condominio Los Olivos {i}</h3>
            <div className="space-y-3 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <MapPin size={14} />
                <span>Av. Principal 123, Santiago</span>
              </div>
              <div className="flex items-center gap-2">
                <Users size={14} />
                <span>120 Residentes</span>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-gray-800 flex gap-2">
              <button className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold py-2 rounded-lg transition-all">
                Ver Edificios
              </button>
              <button className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold py-2 rounded-lg transition-all">
                Equipamiento
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Condos;
