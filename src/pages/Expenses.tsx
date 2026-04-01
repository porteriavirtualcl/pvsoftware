import React from 'react';
import { motion } from 'motion/react';
import { CreditCard, Plus, Download, CheckCircle2, AlertCircle, FileText, TrendingUp, TrendingDown, Edit2, Trash2 } from 'lucide-react';

const Expenses = () => {
  const expenses = [
    { id: '1', month: 'Marzo', year: '2024', amount: '45.000', status: 'paid', date: '2024-03-05' },
    { id: '2', month: 'Febrero', year: '2024', amount: '42.500', status: 'paid', date: '2024-02-05' },
    { id: '3', month: 'Enero', year: '2024', amount: '48.000', status: 'paid', date: '2024-01-05' },
    { id: '4', month: 'Diciembre', year: '2023', amount: '44.200', status: 'paid', date: '2023-12-05' },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Gastos Comunes</h2>
          <p className="text-gray-400 mt-1">Consulta y paga tus gastos comunes de forma segura.</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2.5 px-6 rounded-xl transition-all">
            <FileText size={20} />
            Historial Completo
          </button>
          <button className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-green-600/20">
            <CreditCard size={20} />
            Pagar Ahora
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-lg font-bold text-white mb-4">Últimos Pagos</h3>
          {expenses.map((expense, i) => (
            <motion.div
              key={expense.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex items-center justify-between hover:border-gray-700 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-green-900/20 rounded-xl flex items-center justify-center text-green-500">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white">{expense.month} {expense.year}</h4>
                  <p className="text-sm text-gray-500">Pagado el {expense.date}</p>
                </div>
              </div>
              <div className="text-right flex items-center gap-6">
                <div>
                  <p className="text-xl font-bold text-white">${expense.amount}</p>
                  <p className="text-xs text-green-500 font-bold uppercase tracking-wider">Pagado</p>
                </div>
                <button className="p-2 text-gray-500 hover:text-blue-400 transition-colors" title="Editar">
                  <Edit2 size={18} />
                </button>
                <button className="p-2 text-gray-500 hover:text-red-400 transition-colors" title="Eliminar">
                  <Trash2 size={18} />
                </button>
                <button className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-all">
                  <Download size={20} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full -mr-16 -mt-16 blur-2xl" />
            <h3 className="text-lg font-bold text-white mb-6">Resumen de Cuenta</h3>
            <div className="space-y-6">
              <div>
                <p className="text-sm text-gray-400 mb-1">Saldo Actual</p>
                <p className="text-4xl font-bold text-white">$0</p>
                <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  Al día con tus pagos
                </p>
              </div>
              <div className="pt-6 border-t border-gray-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Promedio Mensual</span>
                  <span className="text-sm font-bold text-white">$44.925</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Variación Anual</span>
                  <span className="text-sm font-bold text-red-500 flex items-center gap-1">
                    <TrendingUp size={14} />
                    +2.4%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-600 rounded-3xl p-8 text-white">
            <h3 className="text-lg font-bold mb-4">Pago Automático</h3>
            <p className="text-sm text-blue-100 mb-6 leading-relaxed">
              Activa el pago automático y olvídate de las fechas de vencimiento.
            </p>
            <button className="w-full bg-white text-blue-600 font-bold py-3 rounded-xl hover:bg-blue-50 transition-all">
              Configurar Ahora
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Expenses;
