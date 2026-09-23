import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

/**
 * Alerta del Centro de eventos (alarmas del DSS).
 *
 * El servidor resume en `config/dssAlarmsStatus` cuántas alarmas de gravedad alta
 * siguen sin gestionar y si hay ráfagas anómalas. Con cualquiera de las dos, el
 * botón "Centro de eventos" del menú se pone ROJO (mismo criterio que Iluminación).
 */

export interface Rafaga { id: string; deviceName: string; channelName: string; condoName: string; condoId: string; typeName: string; count: number; desde: number; hasta: number; grade: number }
export interface DssAlarmsStatus {
  lastSync?: Timestamp | null; lastError?: string | null; pendientesAltas?: number; porCondo?: Record<string, number>;
  rafagas?: Rafaga[]; rafagasCount?: number;
}
interface Value { status: DssAlarmsStatus | null; pendientes: number; rafagas: number }

const Ctx = createContext<Value>({ status: null, pendientes: 0, rafagas: 0 });
export const useEventsAlert = () => useContext(Ctx);
const STAFF = ['super_admin', 'condo_admin', 'administrador', 'operator', 'technician'];

export const EventsAlertProvider = ({ children }: { children: React.ReactNode }) => {
  const { profile } = useAuth();
  const [status, setStatus] = useState<DssAlarmsStatus | null>(null);
  const esStaff = !!profile && STAFF.includes(profile.role);
  useEffect(() => {
    if (!esStaff) { setStatus(null); return; }
    const unsub = onSnapshot(doc(db, 'config', 'dssAlarmsStatus'), s => setStatus(s.exists() ? (s.data() as DssAlarmsStatus) : null), () => setStatus(null));
    return () => unsub();
  }, [esStaff]);
  return <Ctx.Provider value={{ status, pendientes: status?.pendientesAltas || 0, rafagas: status?.rafagasCount || 0 }}>{children}</Ctx.Provider>;
};
