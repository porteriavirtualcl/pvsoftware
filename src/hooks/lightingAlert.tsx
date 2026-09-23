import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

/**
 * Alerta del módulo Iluminación y Alertas.
 *
 * El servidor resume en `config/shellyStatus` cuántos equipos tienen una alerta
 * activa (luces fuera de horario, equipo sin conexión, reseteo apagado…). Si hay
 * alguna, el botón "Iluminación" del menú se pone ROJO — como el amarillo de
 * Encomiendas, pero rojo porque aquí una alerta puede significar equipos sin
 * energía. Se apaga solo cuando la alerta se resuelve o se marca revisada.
 */

export interface ShellyStatus {
  alertCount: number;
  criticalCount: number;
  devices: number;
  on: number;
  offline: number;
  lastPoll?: Timestamp | null;
  lastError?: string | null;
  configured?: boolean;
}

interface LightingAlertValue { status: ShellyStatus | null; alertCount: number; criticalCount: number }

const LightingAlertContext = createContext<LightingAlertValue>({ status: null, alertCount: 0, criticalCount: 0 });
export const useLightingAlert = () => useContext(LightingAlertContext);

const STAFF = ['super_admin', 'condo_admin', 'administrador', 'operator', 'technician'];

export const LightingAlertProvider = ({ children }: { children: React.ReactNode }) => {
  const { profile } = useAuth();
  const [status, setStatus] = useState<ShellyStatus | null>(null);
  const esStaff = !!profile && STAFF.includes(profile.role);

  useEffect(() => {
    if (!esStaff) { setStatus(null); return; }
    const unsub = onSnapshot(doc(db, 'config', 'shellyStatus'),
      snap => setStatus(snap.exists() ? (snap.data() as ShellyStatus) : null),
      () => setStatus(null));
    return () => unsub();
  }, [esStaff]);

  return (
    <LightingAlertContext.Provider value={{ status, alertCount: status?.alertCount || 0, criticalCount: status?.criticalCount || 0 }}>
      {children}
    </LightingAlertContext.Provider>
  );
};
