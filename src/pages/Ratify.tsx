import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { authedFetch } from '../lib/apiBase';
import { ShieldCheck, ScanFace, Check, AlertCircle } from 'lucide-react';

/**
 * Página pública de ratificación (Ley 21.719). Un integrante adulto del hogar confirma
 * (o rechaza) su propio consentimiento del reconocimiento facial mediante un enlace con
 * token de un solo uso, generado cuando el titular declaró por él.
 */
const Ratify: React.FC = () => {
  const { token = '' } = useParams();
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ accepted: boolean; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rut, setRut] = useState('');

  const submit = async (accept: boolean) => {
    if (accept && (!name.trim() || !rut.trim())) { setError('Ingresa tu nombre y RUT para autorizar.'); return; }
    setState('saving'); setError(null);
    try {
      const res = await authedFetch('/api/consent/ratify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, accept, name: name.trim(), rut: rut.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo procesar el enlace');
      setResult({ accepted: data.accepted, name: data.subjectName });
      setState('done');
    } catch (e: any) {
      setError(e.message || 'Error al procesar');
      setState('error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 shadow-xl p-7 sm:p-9">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center"><ShieldCheck size={20} /></div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Consentimiento de datos</h1>
        </div>

        {state === 'done' ? (
          <div className="text-center py-6">
            <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4 ${result?.accepted ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-200 dark:bg-white/10 text-slate-500'}`}>
              <Check size={28} />
            </div>
            <p className="text-slate-700 dark:text-slate-200 font-medium">
              {result?.accepted
                ? 'Tu consentimiento quedó registrado. Gracias.'
                : 'Registramos que no autorizas el reconocimiento facial. Se usará acceso por código QR.'}
            </p>
            {result?.name && <p className="text-sm text-slate-400 mt-2">{result.name}</p>}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
              Eres usuario de <strong>reconocimiento facial</strong> para el control de acceso a tu condominio
              o edificio. El titular de tu hogar te registró y, conforme a la <strong>Ley N° 21.719</strong>,
              el reconocimiento facial es un <strong>dato sensible</strong> que requiere tu <strong>consentimiento
              personal</strong>. Puedes autorizarlo o usar acceso por <strong>código QR</strong>.
            </p>

            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-5 rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2.5">
              <ScanFace size={16} className="text-emerald-600 shrink-0" />
              <span>Al autorizar, tu rostro se usará solo para abrir el acceso del condominio.</span>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Nombre completo</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Tu nombre y apellidos"
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/50 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">RUT</label>
                <input
                  type="text" value={rut} onChange={e => setRut(e.target.value.toUpperCase())}
                  placeholder="12.345.678-9"
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/50 px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 text-sm">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => submit(true)} disabled={state === 'saving'}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                {state === 'saving' ? 'Registrando…' : 'Autorizo el reconocimiento facial'}
              </button>
              <button
                onClick={() => submit(false)} disabled={state === 'saving'}
                className="w-full py-3 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold text-sm transition-colors cursor-pointer"
              >
                No autorizo — usaré código QR
              </button>
            </div>

            <p className="text-center mt-5">
              <a href="/privacy" className="text-xs text-blue-600 dark:text-blue-400 underline">Ver Política de Privacidad</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default Ratify;
