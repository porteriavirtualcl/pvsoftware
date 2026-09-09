import { useEffect, useState } from 'react';
import { Modal, Button } from './ui';
import { useAuth } from '../hooks/useAuth';
import { authedFetch } from '../lib/apiBase';
import { UserCog, DoorOpen, Loader2 } from 'lucide-react';

/**
 * Al iniciar sesión un operador, este aviso le pregunta qué PUESTO toma hoy:
 * Operador 1 o Operador 2. Según lo que elija se cargan sus datos (condominios y
 * número de WhatsApp del puesto). El cambio lo hace el backend
 * (/api/operator/switch-group) de forma segura y luego se recarga la app.
 *
 * Un operador "part time" cubre todos los condominios: solo ve un aviso, sin
 * elegir puesto.
 */

export default function OperatorShiftPopup() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string>('');
  const [error, setError] = useState('');
  const grupo = profile?.operatorGroup;
  const esPuesto = grupo === 'operador1' || grupo === 'operador2';
  const esPartTime = grupo === 'parttime';

  useEffect(() => {
    if (!user || profile?.role !== 'operator' || !grupo) return;
    try {
      const key = `operatorShiftSeen:${user.uid}`;
      if (sessionStorage.getItem(key)) return; // ya se mostró en esta sesión
      sessionStorage.setItem(key, '1');
    } catch { /* sin storage: se muestra igual */ }
    setOpen(true);
  }, [user?.uid, profile?.role, grupo]);

  // Elegir puesto: si es el mismo, solo cerrar; si cambia, backend + recarga.
  const elegir = async (destino: 'operador1' | 'operador2') => {
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
      // Recargar para que se carguen condominios y WhatsApp del nuevo puesto.
      window.location.reload();
    } catch (e: any) {
      setError(e.message || 'Error al cambiar de puesto');
      setSaving('');
    }
  };

  if (!grupo) return null;

  return (
    <Modal open={open} onClose={() => !saving && setOpen(false)}
      title={esPuesto ? '¿Qué puesto tomas hoy?' : 'Tu turno de hoy'} icon={UserCog} size="sm">
      {esPartTime ? (
        <div className="flex flex-col items-center gap-3 pt-1 text-center">
          <div className="text-3xl font-extrabold text-purple-600 dark:text-purple-400">Part time</div>
          <p className="text-sm text-slate-600 dark:text-slate-300">Cubres TODOS los condominios.</p>
          <Button onClick={() => setOpen(false)}>Entendido</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-sm text-center text-slate-500 dark:text-slate-400">
            Elige tu puesto: se cargarán sus condominios y su WhatsApp.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(['operador1', 'operador2'] as const).map(g => {
              const actual = g === grupo;
              const cargando = saving === g;
              return (
                <button key={g} disabled={!!saving}
                  onClick={() => elegir(g)}
                  className={
                    'relative rounded-2xl border-2 p-4 flex flex-col items-center gap-2 cursor-pointer transition-colors disabled:opacity-60 ' +
                    (actual
                      ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-500/10'
                      : 'border-slate-200 dark:border-white/10 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-white/5')
                  }>
                  {cargando
                    ? <Loader2 className="animate-spin text-blue-600" size={26} />
                    : <DoorOpen className={g === 'operador1' ? 'text-blue-600' : 'text-emerald-600'} size={26} />}
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    {g === 'operador1' ? 'Operador 1' : 'Operador 2'}
                  </span>
                  <span className="text-[11px] text-slate-400 text-center leading-tight">
                    {g === 'operador1' ? 'Zona Holanda (con casilleros)' : 'Zona Quillay'}
                  </span>
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
      )}
    </Modal>
  );
}
