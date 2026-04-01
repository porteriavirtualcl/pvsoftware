import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Users, Search, Plus, Filter, MoreVertical, Mail, Building2, Home, Edit2, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

const Residents = () => {
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const residents = [
    { id: '1', name: 'Juan Pérez', email: 'juan@example.com', condo: 'Los Olivos', unit: 'Torre A - 402', status: 'Activo' },
    { id: '2', name: 'María García', email: 'maria@example.com', condo: 'Los Olivos', unit: 'Torre B - 105', status: 'Activo' },
    { id: '3', name: 'Carlos López', email: 'carlos@example.com', condo: 'Vista Mar', unit: 'Depto 1203', status: 'Pendiente' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-7xl mx-auto"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Residentes / Usuarios</h2>
          <p className="text-gray-400 mt-1">Gestiona los usuarios que habitan en los condominios.</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-blue-600/20">
          <Plus size={20} />
          Nuevo Residente
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-gray-800 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Buscar por nombre, email o unidad..."
              className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            <Filter size={18} />
            Filtros
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800 bg-gray-900/50">
                <th className="px-6 py-4 font-medium text-white">Nombre / Email</th>
                <th className="px-6 py-4 font-medium text-white">Condominio</th>
                <th className="px-6 py-4 font-medium text-white">Unidad</th>
                <th className="px-6 py-4 font-medium text-white">Estado</th>
                <th className="px-6 py-4 font-medium text-white text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {residents.map((resident) => (
                <tr key={resident.id} className="hover:bg-gray-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-900/30 rounded-full flex items-center justify-center text-blue-400 font-bold">
                        {resident.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{resident.name}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Mail size={12} />
                          {resident.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                      <Building2 size={16} className="text-gray-500" />
                      {resident.condo}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                      <Home size={16} className="text-gray-500" />
                      {resident.unit}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      resident.status === 'Activo' ? 'bg-green-900/20 text-green-500' : 'bg-yellow-900/20 text-yellow-500'
                    }`}>
                      {resident.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-2 text-gray-500 hover:text-blue-400 transition-colors" title="Editar">
                        <Edit2 size={18} />
                      </button>
                      <button className="p-2 text-gray-500 hover:text-red-400 transition-colors" title="Eliminar">
                        <Trash2 size={18} />
                      </button>
                      <button className="p-2 text-gray-500 hover:text-white transition-colors">
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

export default Residents;
