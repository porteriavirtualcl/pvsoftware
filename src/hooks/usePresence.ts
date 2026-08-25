import { useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { db } from '../firebase';
import { APP_VERSION } from '../lib/appVersion';

const HEARTBEAT_MS = 2 * 60 * 1000;      // late cada 2 min
const TOLERANCIA_MS = 10 * 60 * 1000;    // sin latido por más de esto = desconectado

export function usePresence(uid: string | null | undefined) {
  useEffect(() => {
    if (!uid) return;

    const ref = doc(db, 'users', uid);

    // Reportar versión y plataforma de la app una vez por sesión, para verlo en
    // la ficha del usuario y detectar quién no actualizó (Android/iOS).
    (async () => {
      let appVersion = APP_VERSION;
      if (Capacitor.isNativePlatform()) {
        try { appVersion = (await CapApp.getInfo()).version; } catch { /* usa APP_VERSION */ }
      }
      updateDoc(ref, { appVersion, appPlatform: Capacitor.getPlatform() }).catch(() => {});
    })();

    const late = () =>
      updateDoc(ref, { isOnline: true, lastSeen: serverTimestamp() }).catch(() => {});

    const setOffline = () =>
      updateDoc(ref, { isOnline: false, lastSeen: serverTimestamp() }).catch(() => {});

    late();
    const heartbeat = setInterval(late, HEARTBEAT_MS);

    // OJO: minimizar la ventana o cambiar de pestaña NO es desconectarse. Antes acá se
    // marcaba offline y por eso el operador solo aparecía en línea con la app a la vista.
    // Al volver a primer plano se late de inmediato, sin esperar el intervalo.
    const onVisibility = () => { if (document.visibilityState === 'visible') late(); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', setOffline);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', setOffline);
      setOffline();
    };
  }, [uid]);
}

/** Hay sesión viva (latido reciente). No dice nada sobre el turno. */
export function isOnlineNow(user: { isOnline?: boolean; lastSeen?: { toMillis(): number } | null }): boolean {
  if (!user.isOnline) return false;
  if (!user.lastSeen?.toMillis) return false;
  return Date.now() - user.lastSeen.toMillis() < TOLERANCIA_MS;
}

/* ─────────────────────────────────────────────────────────────
   Turnos de portería: 08:00–20:00 (día) y 20:00–08:00 (noche),
   hora de Chile. El turno no depende del reloj del equipo: se
   calcula sobre la hora de America/Santiago.
   ──────────────────────────────────────────────────────────── */

export const TURNO_DIA_INICIO = 8 * 60;      // 08:00 en minutos
export const TURNO_NOCHE_INICIO = 20 * 60;   // 20:00
/** Minutos de gracia tras el cambio de turno antes de exigir confirmación. */
export const GRACIA_MIN = 5;
/** Minutos antes del cierre en que se avisa "cierra tu sesión". */
export const AVISO_CIERRE_MIN = 5;

const TZ = 'America/Santiago';
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

export type Turno = {
  id: string;                  // '2026-08-25-dia'
  tipo: 'dia' | 'noche';
  etiqueta: string;            // 'Turno día 08:00–20:00'
  minutosDesdeInicio: number;  // cuánto lleva corriendo
  minutosParaFin: number;      // cuánto le queda
  inicioMs: number;            // epoch aproximado del inicio del turno
};

/** El turno vigente en Chile para un instante dado. */
export function turnoActual(ahora: Date = new Date()): Turno {
  // 'sv-SE' entrega "2026-08-25 14:32"
  const [fecha, hora] = fmt.format(ahora).split(' ');
  const [h, m] = hora.split(':').map(Number);
  const minutos = h * 60 + m;

  const esDia = minutos >= TURNO_DIA_INICIO && minutos < TURNO_NOCHE_INICIO;
  const tipo: 'dia' | 'noche' = esDia ? 'dia' : 'noche';

  // El turno de noche que corre antes de las 08:00 empezó el día anterior.
  let fechaTurno = fecha;
  if (!esDia && minutos < TURNO_DIA_INICIO) {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    fechaTurno = d.toISOString().slice(0, 10);
  }

  const inicio = esDia ? TURNO_DIA_INICIO : TURNO_NOCHE_INICIO;
  const minutosDesdeInicio = (minutos - inicio + 1440) % 1440;

  return {
    id: `${fechaTurno}-${tipo}`,
    tipo,
    etiqueta: esDia ? 'Turno día 08:00–20:00' : 'Turno noche 20:00–08:00',
    minutosDesdeInicio,
    minutosParaFin: 12 * 60 - minutosDesdeInicio,
    inicioMs: ahora.getTime() - minutosDesdeInicio * 60 * 1000,
  };
}

export type EstadoPresencia = 'en_turno' | 'sin_confirmar' | 'offline';

/**
 * Estado real de un operador. "En turno" exige sesión viva Y turno confirmado:
 * una sesión que quedó abierta del turno anterior queda 'sin_confirmar' y no
 * cuenta como disponible para los residentes.
 */
export function estadoPresencia(
  user: { isOnline?: boolean; lastSeen?: { toMillis(): number } | null; shiftId?: string },
  ahora: Date = new Date(),
): EstadoPresencia {
  if (!isOnlineNow(user)) return 'offline';
  const t = turnoActual(ahora);
  if (user.shiftId === t.id) return 'en_turno';
  // Durante los primeros minutos del cambio se le da el beneficio de la duda.
  return t.minutosDesdeInicio < GRACIA_MIN ? 'en_turno' : 'sin_confirmar';
}

export const ETIQUETA_PRESENCIA: Record<EstadoPresencia, string> = {
  en_turno: 'En turno',
  sin_confirmar: 'Sesión sin confirmar',
  offline: 'Desconectado',
};
