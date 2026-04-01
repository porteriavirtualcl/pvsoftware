import React from 'react';
import { motion } from 'motion/react';
import { Calendar, Plus, MapPin, Users, MoreVertical, CheckCircle2, AlertCircle, Clock, Info, Edit2, Trash2 } from 'lucide-react';

const Facilities = () => {
  const facilities = [
    { id: '1', name: 'Piscina Exterior', type: 'reservable', status: 'enabled', capacity: '20 personas', image: 'https://picsum.photos/seed/pool/800/600' },
    { id: '2', name: 'Gimnasio Torre A', type: 'non-reservable', status: 'enabled', capacity: '10 personas', image: 'https://picsum.photos/seed/gym/800/600' },
    { id: '3', name: 'Sala de Eventos 1', type: 'reservable', status: 'disabled', capacity: '50 personas', image: 'https://picsum.photos/seed/party/800/600' },
    { id: '4', name: 'Quincho Terraza', type: 'reservable', status: 'enabled', capacity: '15 personas', image: 'https://picsum.photos/seed/bbq/800/600' },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Instalaciones y Reservas</h2>
          <p className="text-gray-400 mt-1">Reserva áreas comunes y consulta disponibilidad en tiempo real.</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20">
          <Calendar size={20} />
          Mis Reservas
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {facilities.map((facility, i) => (
          <motion.div
            key={facility.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden hover:border-gray-700 transition-all group"
          >
            <div className="relative h-48">
              <img
                src={facility.image}
                alt={facility.name}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-transparent" />
              <div className="absolute top-4 right-4 flex gap-2">
                <button className="p-2 bg-gray-900/80 hover:bg-blue-600 text-white rounded-full backdrop-blur-sm transition-all" title="Editar">
                  <Edit2 size={14} />
                </button>
                <button className="p-2 bg-gray-900/80 hover:bg-red-600 text-white rounded-full backdrop-blur-sm transition-all" title="Eliminar">
                  <Trash2 size={14} />
                </button>
                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  facility.status === 'enabled' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                }`}>
                  {facility.status === 'enabled' ? 'Disponible' : 'Cerrado'}
                </span>
              </div>
            </div>
            
            <div className="p-6">
              <h3 className="text-lg font-bold text-white mb-2">{facility.name}</h3>
              <div className="space-y-3 text-sm text-gray-400 mb-6">
                <div className="flex items-center gap-2">
                  <Users size={14} />
                  <span>Capacidad: {facility.capacity}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Info size={14} />
                  <span className="capitalize">{facility.type.replace('-', ' ')}</span>
                </div>
              </div>
              
              {facility.type === 'reservable' && facility.status === 'enabled' ? (
                <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all">
                  Reservar Ahora
                </button>
              ) : (
                <button disabled className="w-full bg-gray-800 text-gray-500 font-bold py-3 rounded-xl cursor-not-allowed">
                  No Reservable
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Facilities;
