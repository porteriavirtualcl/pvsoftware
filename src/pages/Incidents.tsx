import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, onSnapshot, addDoc, Timestamp, orderBy, updateDoc, doc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { ShieldAlert, Plus, X, CheckCircle2, Clock, AlertTriangle, MessageSquare, User, Wrench, Edit2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

interface Incident {
  id: string;
  condoId: string;
  reporterId: string;
  technicianId?: string;
  description: string;
  status: 'open' | 'assigned' | 'reviewing' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: any;
  updatedAt?: any;
}

const Incidents = () => {
  const { profile, user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newIncident, setNewIncident] = useState({
    description: '',
    priority: 'medium' as Incident['priority'],
  });

  useEffect(() => {
    if (!profile) return;

    const q = query(
      collection(db, 'condos', profile.condoId || 'default', 'incidents'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const incidentData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Incident[];
      setIncidents(incidentData);
    }, (error) => {
      console.error("Error fetching incidents:", error);
    });

    return () => unsubscribe();
  }, [profile]);

  const handleAddIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    try {
      await addDoc(collection(db, 'condos', profile.condoId || 'default', 'incidents'), {
        ...newIncident,
        condoId: profile.condoId || 'default',
        reporterId: user.uid,
        status: 'open',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      setShowAddModal(false);
      setNewIncident({ description: '', priority: 'medium' });
    } catch (error) {
      console.error("Error adding incident:", error);
    }
  };

  const updateIncidentStatus = async (incidentId: string, newStatus: Incident['status']) => {
    if (!profile) return;
    try {
      const docRef = doc(db, 'condos', profile.condoId || 'default', 'incidents', incidentId);
      await updateDoc(docRef, {
        status: newStatus,
        updatedAt: Timestamp.now(),
        ...(newStatus === 'assigned' && profile.role === 'technician' ? { technicianId: user?.uid } : {})
      });
    } catch (error) {
      console.error("Error updating incident:", error);
    }
  };

  const getStatusColor = (status: Incident['status']) => {
    switch (status) {
      case 'open': return 'bg-red-900/20 text-red-500';
      case 'assigned': return 'bg-blue-900/20 text-blue-500';
      case 'reviewing': return 'bg-yellow-900/20 text-yellow-500';
      case 'closed': return 'bg-green-900/20 text-green-500';
      default: return 'bg-gray-800 text-gray-400';
    }
  };

  const getPriorityColor = (priority: Incident['priority']) => {
    switch (priority) {
      case 'critical': return 'text-red-500';
      case 'high': return 'text-orange-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-blue-500';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Reporte de Incidencias</h2>
          <p className="text-gray-400 mt-1">Monitorea y gestiona fallas técnicas en tiempo real.</p>
        </div>
        {(profile?.role === 'operator' || profile?.role === 'condo_admin' || profile?.role === 'super_admin') && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-red-600/20"
          >
            <Plus size={20} />
            Reportar Falla
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {incidents.map((incident) => (
          <motion.div
            layout
            key={incident.id}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-all"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(incident.status)}`}>
                    {incident.status}
                  </span>
                  <span className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wider ${getPriorityColor(incident.priority)}`}>
                    <AlertTriangle size={12} />
                    {incident.priority}
                  </span>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock size={12} />
                    {incident.createdAt?.toDate ? format(incident.createdAt.toDate(), 'dd/MM HH:mm') : 'Reciente'}
                  </span>
                </div>
                <p className="text-white font-medium leading-relaxed">{incident.description}</p>
                <div className="flex items-center gap-6 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <User size={14} />
                    <span>Reportado por: {incident.reporterId.slice(0, 6)}</span>
                  </div>
                  {incident.technicianId && (
                    <div className="flex items-center gap-1.5">
                      <Wrench size={14} />
                      <span>Técnico: {incident.technicianId.slice(0, 6)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {profile?.role === 'technician' && incident.status === 'open' && (
                  <button
                    onClick={() => updateIncidentStatus(incident.id, 'assigned')}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2 px-4 rounded-lg transition-all"
                  >
                    Tomar Caso
                  </button>
                )}
                {profile?.role === 'technician' && incident.status === 'assigned' && (
                  <button
                    onClick={() => updateIncidentStatus(incident.id, 'reviewing')}
                    className="bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-bold py-2 px-4 rounded-lg transition-all"
                  >
                    En Revisión
                  </button>
                )}
                {(profile?.role === 'technician' || profile?.role === 'condo_admin') && (incident.status === 'reviewing' || incident.status === 'assigned') && (
                  <button
                    onClick={() => updateIncidentStatus(incident.id, 'closed')}
                    className="bg-green-600 hover:bg-green-500 text-white text-sm font-bold py-2 px-4 rounded-lg transition-all"
                  >
                    Cerrar Caso
                  </button>
                )}
                <button className="p-2 text-gray-500 hover:text-blue-400 transition-colors" title="Editar">
                  <Edit2 size={18} />
                </button>
                <button className="p-2 text-gray-500 hover:text-red-400 transition-colors" title="Eliminar">
                  <Trash2 size={18} />
                </button>
                <button className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-all">
                  <MessageSquare size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add Incident Modal */}
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
                <h3 className="text-2xl font-bold text-white">Reportar Incidencia</h3>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleAddIncident} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Descripción de la Falla</label>
                  <textarea
                    required
                    rows={4}
                    value={newIncident.description}
                    onChange={(e) => setNewIncident({ ...newIncident, description: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white focus:border-red-600 focus:ring-1 focus:ring-red-600 outline-none transition-all resize-none"
                    placeholder="Describe detalladamente el problema..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Prioridad</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewIncident({ ...newIncident, priority: p })}
                        className={`py-2 px-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${
                          newIncident.priority === p
                            ? 'bg-red-600 border-red-600 text-white'
                            : 'bg-gray-950 border-gray-800 text-gray-500 hover:border-gray-700'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-red-600/20 mt-4"
                >
                  Enviar Reporte
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Incidents;
