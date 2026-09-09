import { useEffect, useState } from 'react';
import { Modal, Button } from './ui';
import { useAuth } from '../hooks/useAuth';
import { UserCog } from 'lucide-react';

/**
 * Aviso de turno al iniciar sesión un operador: le dice si es Operador 1,
 * Operador 2 o Part time (según su `operatorGroup`), que define qué condominios
 * ve. Se muestra UNA vez por sesión. El grupo lo reasigna un super_admin en caso
 * de emergencia desde el módulo de Operadores.
 */

const INFO: Record<string, { titulo: string; detalle: string; color: string }> = {
  operador1: {
    titulo: 'Operador 1',
    detalle: 'Zona con casilleros — incluye Edificio Holanda.',
    color: 'text-blue-600 dark:text-blue-400',
  },
  operador2: {
    titulo: 'Operador 2',
    detalle: 'Zona sin casilleros — Quillay, La Estancia, Los Cantaros y otros.',
    color: 'text-emerald-600 dark:text-emerald-400',
  },
  parttime: {
    titulo: 'Part time',
    detalle: 'Cobertura de TODOS los condominios.',
    color: 'text-purple-600 dark:text-purple-400',
  },
};

export default function OperatorShiftPopup() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const grupo = profile?.operatorGroup;

  useEffect(() => {
    if (!user || profile?.role !== 'operator' || !grupo) return;
    try {
      const key = `operatorShiftSeen:${user.uid}`;
      if (sessionStorage.getItem(key)) return; // ya se mostró en esta sesión
      sessionStorage.setItem(key, '1');
    } catch { /* sesión sin storage: se muestra igual */ }
    setOpen(true);
  }, [user?.uid, profile?.role, grupo]);

  const info = grupo ? INFO[grupo] : null;
  if (!info) return null;

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Tu turno de hoy" icon={UserCog} size="sm">
      <div className="flex flex-col items-center gap-3 pt-1 text-center">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Iniciaste sesión como</div>
        <div className={`text-3xl font-extrabold ${info.color}`}>{info.titulo}</div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{info.detalle}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Si hay un cambio de turno de emergencia, un administrador puede reasignarte.
        </p>
        <Button onClick={() => setOpen(false)}>Entendido</Button>
      </div>
    </Modal>
  );
}
