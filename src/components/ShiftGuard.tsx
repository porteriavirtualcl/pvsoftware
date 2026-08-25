import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { turnoActual, GRACIA_MIN, AVISO_CIERRE_MIN } from '../hooks/usePresence';
import { Button, Modal } from './ui';
import { Clock, LogOut, UserCheck, X } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────
   Control de turno — SOLO para el rol `operator`.

   Residentes, técnicos y administración no ven nada de esto: el componente
   retorna null para cualquier otro rol (ver la guarda al inicio del render).

   Qué resuelve: el operador sale de su turno y deja la sesión abierta, así que
   seguía apareciendo "en línea" y recibiendo llamadas de residentes.

   Cómo:
   · Si inició sesión dentro de este turno, se confirma solo (ya se autenticó).
   · Si la sesión viene del turno anterior, a los 5 min del cambio aparece un
     modal bloqueante: confirma quién está o cierra sesión.
   · 5 min antes del cierre, aviso para que cierre sesión y el próximo quede
     registrado.
   ──────────────────────────────────────────────────────────── */

const LS_AVISO = 'pv_aviso_cierre_turno';

export default function ShiftGuard() {
  const { user, profile } = useAuth();
  const [ahora, setAhora] = useState(() => new Date());
  const [avisoVisible, setAvisoVisible] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const autoConfirmado = useRef(false);

  const esOperador = profile?.role === 'operator';

  // Reloj: basta con revisar cada 30 s.
  useEffect(() => {
    if (!esOperador) return;
    const t = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(t);
  }, [esOperador]);

  const turno = useMemo(() => turnoActual(ahora), [ahora]);
  const confirmado = profile?.shiftId === turno.id;

  /* Confirmación automática: si el login ocurrió dentro de este turno, es esta
     persona la que está — no tiene sentido preguntárselo de nuevo. Una sesión
     arrastrada del turno anterior NO entra por acá. */
  useEffect(() => {
    if (!esOperador || !user?.uid || confirmado || autoConfirmado.current) return;
    const loginMs = user.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).getTime() : 0;
    if (!loginMs || loginMs < turno.inicioMs) return;
    autoConfirmado.current = true;
    updateDoc(doc(db, 'users', user.uid), {
      shiftId: turno.id, shiftConfirmedAt: serverTimestamp(), shiftConfirmedBy: 'login',
    }).catch(() => {});
  }, [esOperador, user, confirmado, turno.id, turno.inicioMs]);

  /* Aviso de cierre, una sola vez por turno. */
  useEffect(() => {
    if (!esOperador) return;
    if (turno.minutosParaFin > AVISO_CIERRE_MIN || turno.minutosParaFin < 0) return;
    try {
      if (localStorage.getItem(LS_AVISO) === turno.id) return;
      localStorage.setItem(LS_AVISO, turno.id);
    } catch { /* modo privado: se muestra igual */ }
    setAvisoVisible(true);
  }, [esOperador, turno.id, turno.minutosParaFin]);

  const confirmar = async () => {
    if (!user?.uid) return;
    setGuardando(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        shiftId: turno.id, shiftConfirmedAt: serverTimestamp(), shiftConfirmedBy: 'manual',
      });
    } finally { setGuardando(false); }
  };

  const cerrarSesion = async () => {
    setGuardando(true);
    try {
      if (user?.uid) await updateDoc(doc(db, 'users', user.uid), { isOnline: false }).catch(() => {});
      await signOut(auth);
    } finally { setGuardando(false); }
  };

  // ── Guarda de rol: nada de esto existe para quien no sea operador ──
  if (!esOperador) return null;

  const debeConfirmar = !confirmado && turno.minutosDesdeInicio >= GRACIA_MIN;

  return (
    <>
      {/* Modal bloqueante: sin botón de cerrar, solo confirmar o salir. */}
      <Modal
        open={debeConfirmar}
        onClose={() => { /* bloqueante a propósito */ }}
        title="¿Sigues tú de turno?"
        description={turno.etiqueta}
        icon={UserCheck}
        footer={
          <>
            <Button variant="secondary" icon={LogOut} onClick={cerrarSesion} loading={guardando}>
              No soy yo — cerrar sesión
            </Button>
            <Button icon={UserCheck} onClick={confirmar} loading={guardando}>
              Sí, continúo yo
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Esta sesión quedó abierta del turno anterior. Confirma quién está en portería
            para que la administración vea al operador correcto en línea.
          </p>
          <div className="rounded-xl bg-slate-50 dark:bg-white/5 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Sesión abierta como</p>
            <p className="font-semibold text-slate-900 dark:text-white">{profile?.name || profile?.email}</p>
            {profile?.email && profile?.name && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{profile.email}</p>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-500">
            Si el turno lo tomó otra persona, cierra sesión para que ingrese con su propia cuenta.
          </p>
        </div>
      </Modal>

      {/* Aviso de cierre de turno: informativo, no bloquea. */}
      {avisoVisible && !debeConfirmar && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[min(94vw,30rem)]">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 shadow-lg">
            <span className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Clock size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Tu turno termina en {Math.max(0, turno.minutosParaFin)} min
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
                Cierra sesión al salir para que el próximo operador quede registrado en línea.
              </p>
              <div className="mt-2">
                <Button size="sm" variant="secondary" icon={LogOut} onClick={cerrarSesion} loading={guardando}>
                  Cerrar sesión
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAvisoVisible(false)}
              className="p-1 rounded-lg text-amber-700/70 hover:bg-amber-100 dark:text-amber-300/70 dark:hover:bg-amber-500/20"
              title="Cerrar aviso"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
