import React from 'react';
import { Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, Mic, MicOff, Building2, X, AlertCircle } from 'lucide-react';
import { useWaCall, WaCallDoc } from '../hooks/waCall';
import { fmtSegundos } from '../lib/webrtc';
import { cn } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Panel flotante de llamadas por WhatsApp. Vive en el Layout para que la llamada
// entrante suene en cualquier página y para que el operador pueda seguir
// chateando mientras habla: es una tarjeta compacta abajo a la derecha (en el
// celular, sobre la barra inferior), no un modal que tape la pantalla.
// ─────────────────────────────────────────────────────────────────────────────

const initials = (name: string) =>
  (name || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';

function Contacto({ call, small = false }: { call: WaCallDoc; small?: boolean }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className={cn(
        'rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold shrink-0',
        small ? 'w-9 h-9 text-xs' : 'w-12 h-12 text-sm',
      )}>
        {initials(call.contactName)}
      </div>
      <div className="min-w-0">
        <p className={cn('font-semibold text-slate-900 dark:text-white truncate', small ? 'text-sm' : 'text-base')}>
          {call.contactName || call.contactPhone || 'Contacto'}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
          {call.contactPhone && <span>+{call.contactPhone}</span>}
          {call.condoName && (
            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
              · <Building2 size={10} /> {call.condoName}{call.unit ? ` · ${call.unit}` : ''}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

const Redondo = ({ onClick, className, label, children, disabled }: {
  onClick: () => void; className?: string; label: string; children: React.ReactNode; disabled?: boolean;
}) => (
  <button
    type="button" onClick={onClick} aria-label={label} title={label} disabled={disabled}
    className={cn('w-12 h-12 rounded-full flex items-center justify-center shadow-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed', className)}
  >
    {children}
  </button>
);

export default function WaCallPanel() {
  const { incoming, current, phase, seconds, muted, busy, error, ended, answer, reject, hangup, toggleMute, dismissError, dismissEnded } = useWaCall();

  const entrante = phase === 'idle' && !current ? incoming[0] : undefined;
  const enCurso = current && phase !== 'idle' && phase !== 'ended';
  if (!entrante && !enCurso && !error && !ended) return null;

  const estadoTexto = phase === 'connecting' ? 'Conectando audio…'
    : phase === 'calling' ? 'Llamando…'
    : phase === 'ringing' ? 'Sonando…'
    : phase === 'active' ? fmtSegundos(seconds)
    : '';

  const endedTexto = ended ? (
    ended.status === 'ended' ? `Llamada finalizada · ${fmtSegundos(ended.duration)}`
    : ended.status === 'rejected' ? 'El contacto no aceptó la llamada'
    : ended.status === 'unanswered' ? 'Sin respuesta'
    : ended.status === 'cancelled' ? 'Llamada cancelada'
    : ended.status === 'missed' ? 'Llamada perdida'
    : ended.status === 'taken' ? 'Otro operador tomó la llamada'
    : 'La llamada falló'
  ) : '';

  return (
    <div className="fixed z-[150] right-3 left-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-5 sm:bottom-5 sm:w-[340px] flex flex-col gap-2 pointer-events-none">

      {/* Aviso de error */}
      {error && (
        <div className="pointer-events-auto flex items-start gap-2 rounded-2xl bg-red-600 text-white px-4 py-3 shadow-xl text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p className="flex-1">{error}</p>
          <button onClick={dismissError} aria-label="Cerrar" className="cursor-pointer opacity-80 hover:opacity-100"><X size={16} /></button>
        </div>
      )}

      {/* Fin de llamada */}
      {ended && !enCurso && !entrante && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-3 shadow-xl text-sm">
          <PhoneOff size={16} className="shrink-0 opacity-70" />
          <p className="flex-1 truncate">{endedTexto}{ended.contactName ? ` · ${ended.contactName}` : ''}</p>
          <button onClick={dismissEnded} aria-label="Cerrar" className="cursor-pointer opacity-70 hover:opacity-100"><X size={16} /></button>
        </div>
      )}

      {/* Llamada entrante sonando */}
      {entrante && (
        <div className="pointer-events-auto rounded-3xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/30 shadow-2xl p-4 ring-4 ring-emerald-500/10">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-widest mb-3">
            <span className="relative flex w-2.5 h-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <PhoneIncoming size={13} /> Llamada de WhatsApp
            {incoming.length > 1 && <span className="ml-auto text-slate-400 normal-case tracking-normal font-semibold">+{incoming.length - 1} en espera</span>}
          </div>
          <Contacto call={entrante} />
          <div className="flex items-center justify-between mt-4 px-2">
            <button onClick={() => reject(entrante)} disabled={busy} className="flex flex-col items-center gap-1 cursor-pointer disabled:opacity-50">
              <span className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg"><PhoneOff size={24} /></span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Rechazar</span>
            </button>
            <button onClick={() => answer(entrante)} disabled={busy} className="flex flex-col items-center gap-1 cursor-pointer disabled:opacity-50">
              <span className={cn('w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg', !busy && 'animate-bounce')}>
                {busy ? <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Phone size={24} />}
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Contestar</span>
            </button>
          </div>
        </div>
      )}

      {/* Llamada en curso (entrante contestada o saliente) */}
      {enCurso && current && (
        <div className="pointer-events-auto rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest mb-2 text-slate-500 dark:text-slate-400">
            {current.direction === 'outbound' ? <PhoneOutgoing size={13} /> : <PhoneIncoming size={13} />}
            WhatsApp
            <span className={cn('ml-auto normal-case tracking-normal font-mono text-sm',
              phase === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 animate-pulse')}>
              {estadoTexto}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0"><Contacto call={current} small /></div>
            <Redondo
              onClick={toggleMute} label={muted ? 'Activar micrófono' : 'Silenciar micrófono'} disabled={phase !== 'active'}
              className={muted ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/15'}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </Redondo>
            <Redondo onClick={hangup} label={phase === 'active' ? 'Colgar' : 'Cancelar'} className="bg-red-600 hover:bg-red-700 text-white">
              <PhoneOff size={20} />
            </Redondo>
          </div>
        </div>
      )}
    </div>
  );
}
