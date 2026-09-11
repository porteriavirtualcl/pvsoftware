import { useEffect, useState } from 'react';
import { Modal } from './ui';
import { useAuth } from '../hooks/useAuth';
import { authedFetch } from '../lib/apiBase';
import { UserCog, DoorOpen, Globe, Loader2 } from 'lucide-react';

/**
 * Al iniciar sesión un operador, este aviso le pregunta qué PUESTO toma hoy:
 * Operador 1, Operador 2 o Part time. Según lo que elija se cargan sus datos
 * (condominios y número de WhatsApp). El cambio lo hace el backend
 * (/api/operator/switch-group) de forma segura y luego se recarga la app.
 *
 * Antes el part time no podía elegir: veía un aviso informativo y quedaba
 * atrapado en su grupo. Ahora los tres puestos están en el mismo cuadro.
 */
const PUESTOS = [
  { id: 'operador1' as const, label: 'Operador 1', detalle: 'Zona Holanda (con casilleros)', icono: DoorOpen, color: 'text-blue-600' },
  { id: 'operador2' as const, label: 'Operador 2', detalle: 'Zona Quillay',                  icono: DoorOpen, color: 'text-emerald-600' },
  { id: 'parttime'  as const, label: 'Part time',  detalle: 'Todos los condominios',         icono: Globe,    color: 'text-purple-600' },
];
type Puesto = typeof PUESTOS[number]['id'];

export default function OperatorShiftPopup() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string>('');
  const [error, setError] = useState('');
  const grupo = profile?.operatorGroup;

  useEffect(() => {
    // Se muestra a TODO operador, tenga grupo asignado o no: el que aún no lo
    // tiene también necesita elegir para que se le carguen condominios.
    if (!user || profile?.role !== 'operator') return;
    try {
      const key = `operatorShiftSeen:${user.uid}`;
      if (sessionStorage.getItem(key)) return; // ya se mostró en esta sesión
      sessionStorage.setItem(key, '1');
    } catch { /* sin storage: se muestra igual */ }
    setOpen(true);
  }, [user?.uid, profile?.role, grupo]);

  // Elegir puesto: si es el mismo, solo cerrar; si cambia, backend + recarga.
  const elegir = async (destino: Puesto) => {
    if (destino === grupo) { setOpen(false); return; }
    setError(''); setSaving(destino);
    try {
      const res = await authedFetch('/api/operator/switch-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: destino }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cambiar de puesto');
      // Limpiar la marca "visto" para que, tras recargar, el selector REAPAREZCA
      // y el operador pueda volver a cambiar de puesto (ej. regresar a Operador 2).
      try { if (user?.uid) sessionStorage.removeItem(`operatorShiftSeen:${user.uid}`); } catch { /* ignore */ }
      // Recargar para que se carguen condominios y WhatsApp del nuevo puesto.
      window.location.reload();
    } catch (e: any) {
      setError(e.message || 'Error al cambiar de puesto');
      setSaving('');
    }
  };

  if (profile?.role !== 'operator') return null;

  return (
    <Modal open={open} onClose={() => !saving && setOpen(false)}
      title="¿Qué puesto tomas hoy?" icon={UserCog} size="sm">
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-sm text-center text-slate-500 dark:text-slate-400">
          Elige tu puesto: se cargarán sus condominios y su WhatsApp.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {PUESTOS.map(p => {
            const actual = p.id === grupo;
            const cargando = saving === p.id;
            const Icono = p.icono;
            return (
              <button key={p.id} disabled={!!saving}
                onClick={() => elegir(p.id)}
                className={
                  'relative rounded-2xl border-2 p-3.5 flex flex-col items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 ' +
                  (actual
                    ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-500/10'
                    : 'border-slate-200 dark:border-white/10 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-white/5')
                }>
                {cargando
                  ? <Loader2 className="animate-spin text-blue-600" size={24} />
                  : <Icono className={p.color} size={24} />}
                <span className="font-bold text-sm text-slate-800 dark:text-slate-100">{p.label}</span>
                <span className="text-[11px] text-slate-400 text-center leading-tight">{p.detalle}</span>
                {actual && (
                  <span className="absolute top-1.5 right-1.5 text-[10px] font-semibold text-blue-600 bg-blue-100 dark:bg-blue-500/20 rounded-full px-1.5 py-0.5">
                    actual
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {error && <p className="text-xs text-center text-red-500">{error}</p>}
        <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">
          Cambiar de puesto reasigna tus condominios y tu número de WhatsApp.
        </p>
      </div>
    </Modal>
  );
}
