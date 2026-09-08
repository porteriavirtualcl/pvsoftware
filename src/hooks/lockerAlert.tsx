import React, { createContext, useContext, useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

/**
 * Alerta de encomiendas en locker para el operador / super_admin.
 *
 * Enciende un aviso en el botón "Encomiendas" del menú cuando llega una
 * encomienda nueva a un casillero, para que el operador lo note aunque esté en
 * otro módulo. Se apaga al abrir el módulo (Parcels llama markSeen()).
 *
 * "Nueva" = pendiente, dejada en un locker (tiene lockerId) y que llegó DESPUÉS
 * de la última vez que el operador abrió el módulo (marca de tiempo por usuario
 * en localStorage). Solo escritorio; se consume en el sidebar.
 */

interface LockerAlertValue {
  newCount: number;
  markSeen: () => void;
}

const LockerAlertContext = createContext<LockerAlertValue>({
  newCount: 0,
  markSeen: () => {},
});

export const useLockerAlert = () => useContext(LockerAlertContext);

export const seenKey = (uid: string) => `lockerAlertSeen:${uid}`;

interface PendItem { id: string; arrivedMs: number; }

export const LockerAlertProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, profile } = useAuth();
  const [pendientes, setPendientes] = useState<PendItem[]>([]);
  const [lastSeen, setLastSeen] = useState<number>(() => Date.now());

  const isStaff = !!profile && profile.role !== 'resident' && profile.role !== 'usuario';
  const isSuperAdmin = profile?.role === 'super_admin' || profile?.condoScope === 'all';

  // Marca de tiempo "visto" persistida por usuario. Si nunca vio nada, la
  // línea base es ahora: lo que ya estaba en los casilleros no cuenta como nuevo.
  useEffect(() => {
    if (!user?.uid) return;
    try {
      const raw = localStorage.getItem(seenKey(user.uid));
      if (raw) {
        setLastSeen(Number(raw));
      } else {
        const now = Date.now();
        localStorage.setItem(seenKey(user.uid), String(now));
        setLastSeen(now);
      }
    } catch {
      setLastSeen(Date.now());
    }
  }, [user?.uid]);

  // Suscripción a encomiendas pendientes en locker, según el alcance del staff.
  useEffect(() => {
    if (!isStaff || !user) { setPendientes([]); return; }

    const acc: Record<string, PendItem[]> = {};
    const publish = () => setPendientes(Object.values(acc).flat());

    const mapSnap = (snap: any): PendItem[] =>
      snap.docs
        .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .filter((p: any) => !!p.lockerId) // solo lo dejado en un casillero
        .map((p: any) => ({ id: p.id, arrivedMs: (p.arrivedAt?.seconds ?? 0) * 1000 }));

    const listenCondo = (condoId: string) =>
      onSnapshot(
        query(collection(db, `condos/${condoId}/parcels`), where('status', '==', 'pending')),
        (snap: any) => { acc[condoId] = mapSnap(snap); publish(); },
        () => {},
      );

    if (isSuperAdmin) {
      // Todos los condominios: un listener por condominio, agregado sin fugas.
      const perCondo: Record<string, () => void> = {};
      const unsubCondos = onSnapshot(collection(db, 'condos'), (snap) => {
        snap.docs.forEach((d) => {
          if (!perCondo[d.id]) perCondo[d.id] = listenCondo(d.id);
        });
      }, () => {});
      return () => { unsubCondos(); Object.values(perCondo).forEach((fn) => fn()); };
    }

    // Un operador multi-condominio tiene condoId = su condominio PRIMARIO, que
    // puede no ser aquel donde hay lockers. Hay que escuchar TODOS sus
    // condominios (condoId + condoIds), no solo el primario.
    const ids = new Set<string>();
    if (profile?.condoId) ids.add(profile.condoId);
    if (Array.isArray(profile?.condoIds)) profile!.condoIds.forEach((id) => id && ids.add(id));
    const unsubs = [...ids].map(listenCondo);
    return () => unsubs.forEach((fn) => fn());
  }, [isStaff, isSuperAdmin, user, profile?.condoId, (profile?.condoIds || []).join(',')]);

  const newCount = pendientes.filter((p) => p.arrivedMs > lastSeen).length;

  const markSeen = () => {
    const now = Date.now();
    setLastSeen(now);
    try {
      if (user?.uid) localStorage.setItem(seenKey(user.uid), String(now));
    } catch { /* ignore */ }
  };

  return (
    <LockerAlertContext.Provider value={{ newCount, markSeen }}>
      {children}
    </LockerAlertContext.Provider>
  );
};
