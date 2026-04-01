import React from 'react';
import { motion } from 'motion/react';
import { Settings, Plus, Camera, Shield, Wifi, MoreVertical, CheckCircle2, AlertCircle, Edit2, Trash2 } from 'lucide-react';

const Equipment = () => {
  const equipment = [
    { id: '1', name: 'Cámara Principal Acceso A', type: 'Cámara IP', status: 'active', lastMaint: '2024-03-15' },
    { id: '2', name: 'Barrera Vehicular B', type: 'Barrera', status: 'maintenance', lastMaint: '2024-02-20' },
    { id: '3', name: 'Intercomunicador Torre 1', type: 'IP Intercom', status: 'active', lastMaint: '2024-03-01' },
    { id: '4', name: 'Cámara Estacionamiento -1', type: 'Cámara IP', status: 'inactive', lastMaint: '2024-01-10' },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Equipamiento Tecnológico</h2>
          <p className="text-gray-400 mt-1">Inventario y estado de salud de los dispositivos instalados.</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20">
          <Plus size={20} />
          Nuevo Equipo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {equipment.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                item.status === 'active' ? 'bg-green-900/20 text-green-500' :
                item.status === 'maintenance' ? 'bg-yellow-900/20 text-yellow-500' :
                'bg-red-900/20 text-red-500'
              }`}>
                {item.type === 'Cámara IP' ? <Camera size={24} /> : item.type === 'Barrera' ? <Shield size={24} /> : <Wifi size={24} />}
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
            <h3 className="text-lg font-bold text-white mb-1">{item.name}</h3>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-4">{item.type}</p>
            
            <div className="space-y-3 text-sm text-gray-400">
              <div className="flex items-center justify-between">
                <span className="text-xs">Estado</span>
                <span className={`text-xs font-bold uppercase ${
                  item.status === 'active' ? 'text-green-500' :
                  item.status === 'maintenance' ? 'text-yellow-500' :
                  'text-red-500'
                }`}>{item.status}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs">Última Mant.</span>
                <span className="text-xs font-medium text-white">{item.lastMaint}</span>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-gray-800">
              <button className="w-full bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold py-2 rounded-lg transition-all">
                Ver Historial
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Equipment;
