import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { CreditCard, Calendar, QrCode, Home, Building2, User, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

const MyUnit = () => {
  const { profile } = useAuth();

  const unitInfo = {
    condo: 'Condominio Los Olivos',
    tower: 'Torre A',
    number: '402',
    owner: 'Juan Pérez',
    status: 'Al día',
  };

  const recentExpenses = [
    { id: '1', month: 'Marzo 2024', amount: '$45.000', status: 'Pagado', date: '05/03/2024' },
    { id: '2', month: 'Febrero 2024', amount: '$42.500', status: 'Pagado', date: '04/02/2024' },
    { id: '3', month: 'Enero 2024', amount: '$48.000', status: 'Pagado', date: '06/01/2024' },
  ];

  const upcomingReservations = [
    { id: '1', facility: 'Quincho 1', date: 'Viernes, 18 de Marzo', time: '18:00 - 22:00', status: 'Confirmado' },
    { id: '2', facility: 'Sala Multiuso', date: 'Sábado, 26 de Marzo', time: '14:00 - 18:00', status: 'Pendiente' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-7xl mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Mi Unidad</h2>
          <p className="text-gray-400 mt-1">Información detallada de tu departamento y servicios.</p>
        </div>
        <div className="flex items-center gap-3 bg-green-900/20 text-green-500 px-4 py-2 rounded-xl border border-green-800/30">
          <CheckCircle2 size={20} />
          <span className="font-semibold">Estado: Al día</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Unit Summary */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
                <Home size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{unitInfo.tower} - {unitInfo.number}</h3>
                <p className="text-sm text-gray-500">{unitInfo.condo}</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-gray-800">
                <span className="text-sm text-gray-400">Propietario</span>
                <span className="text-sm font-medium text-white">{unitInfo.owner}</span>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-gray-800">
                <span className="text-sm text-gray-400">Tipo</span>
                <span className="text-sm font-medium text-white">Departamento</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-gray-400">Superficie</span>
                <span className="text-sm font-medium text-white">75 m²</span>
              </div>
            </div>
          </div>

          <div className="bg-blue-600 rounded-2xl p-6 text-white shadow-xl shadow-blue-600/20">
            <h4 className="font-bold mb-2">¿Necesitas ayuda?</h4>
            <p className="text-sm text-blue-100 mb-4">Contacta a la administración para cualquier consulta sobre tu unidad.</p>
            <button className="w-full bg-white text-blue-600 font-bold py-2.5 rounded-xl text-sm hover:bg-blue-50 transition-colors">
              Contactar Administración
            </button>
          </div>
        </div>

        {/* Expenses and Reservations */}
        <div className="lg:col-span-2 space-y-8">
          {/* Expenses */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <CreditCard className="text-green-500" size={20} />
                Últimos Gastos Comunes
              </h3>
              <button className="text-sm font-medium text-blue-400 hover:text-blue-300">Ver Historial</button>
            </div>
            <div className="space-y-4">
              {recentExpenses.map((expense) => (
                <div key={expense.id} className="flex items-center justify-between p-4 bg-gray-950 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-green-900/20 rounded-lg flex items-center justify-center text-green-500">
                      <CreditCard size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{expense.month}</p>
                      <p className="text-xs text-gray-500">Pagado el {expense.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">{expense.amount}</p>
                    <p className="text-xs text-green-500 font-medium">{expense.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reservations */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Calendar className="text-blue-500" size={20} />
                Próximas Reservas
              </h3>
              <button className="text-sm font-medium text-blue-400 hover:text-blue-300">Nueva Reserva</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {upcomingReservations.map((res) => (
                <div key={res.id} className="p-4 bg-gray-950 rounded-xl border border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      res.status === 'Confirmado' ? 'bg-green-900/20 text-green-500' : 'bg-yellow-900/20 text-yellow-500'
                    }`}>
                      {res.status}
                    </span>
                    <Clock size={14} className="text-gray-500" />
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">{res.facility}</h4>
                  <p className="text-xs text-gray-400">{res.date}</p>
                  <p className="text-xs text-gray-500 mt-1">{res.time}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default MyUnit;
