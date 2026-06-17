/**
 * DahuaTest — sandbox aislado para el DSS Pro.
 * No toca Firebase. Accesible en /dahua-test sin autenticación.
 * Mantener incluso después de integrar el flujo principal — sirve para
 * diagnosticar problemas en el DSS sin ruido del resto de la app.
 */

import React, { useState, useRef } from 'react';
import { format, addHours } from 'date-fns';
import DahuaService, { DahuaChannel } from '../services/DahuaService';

interface LogEntry {
  ts: string;
  label: string;
  ok: boolean;
  payload: unknown;
}

function nowStr() { return format(new Date(), 'HH:mm:ss.SSS'); }
function toLocal(d: Date) { return format(d, "yyyy-MM-dd'T'HH:mm"); }
function toUnix(local: string) { return Math.floor(new Date(local).getTime() / 1000); }

export default function DahuaTest() {
  const [visitorName, setVisitorName]   = useState('');
  const [phone, setPhone]               = useState('');
  const [plate, setPlate]               = useState('');
  const [arrival, setArrival]           = useState(toLocal(new Date()));
  const [departure, setDeparture]       = useState(toLocal(addHours(new Date(), 6)));

  const [loggedIn, setLoggedIn]         = useState(false);
  const [channels, setChannels]         = useState<DahuaChannel[]>([]);
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [qrcode, setQrcode]             = useState<string | null>(null);
  const [log, setLog]                   = useState<LogEntry[]>([]);
  const [busy, setBusy]                 = useState(false);
  const logRef                          = useRef<HTMLDivElement>(null);

  function addLog(label: string, ok: boolean, payload: unknown) {
    setLog(prev => [{ ts: nowStr(), label, ok, payload }, ...prev]);
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await fn();
      addLog(label, true, result);
      return result;
    } catch (err: unknown) {
      addLog(label, false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    await run('Login', async () => {
      const token = await DahuaService.login();
      setLoggedIn(true);
      return { token: token.slice(0, 20) + '…' };
    });
  }

  async function handleDiscover() {
    await run('Descubrir canales ACS', async () => {
      const chs = await DahuaService.listAccessChannels();
      setChannels(chs);
      return { count: chs.length, channels: chs };
    });
  }

  async function handlePassport() {
    await run('Generar Passport', () => DahuaService.generatePassport());
  }

  async function handleCreate() {
    if (!selected.size) { addLog('Crear Visitante', false, 'Seleccioná al menos un canal'); return; }
    await run('Crear Visitante', async () => {
      const result = await DahuaService.createVisitor({
        visitorName: visitorName || 'Test Visitante',
        phone: phone || undefined,
        plate: plate || undefined,
        startTs: toUnix(arrival),
        endTs: toUnix(departure),
        acsChannelIds: [...selected],
      });
      if (result) setQrcode((result as any).qrcode ?? null);
      return result;
    });
  }

  async function handleLogout() {
    await run('Logout', async () => {
      await DahuaService.logout();
      setLoggedIn(false); setChannels([]); setSelected(new Set()); setQrcode(null);
      return { ok: true };
    });
  }

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-mono">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-700 pb-4">
          <span className="text-2xl">🔧</span>
          <div>
            <h1 className="text-xl font-bold text-white">Portería Virtual — Test Sandbox</h1>
            <p className="text-xs text-gray-500">Diagnóstico aislado. No toca Firebase.</p>
          </div>
          <div className={`ml-auto px-3 py-1 rounded-full text-xs font-bold ${loggedIn ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
            {loggedIn ? '● Autenticado' : '○ Sin sesión'}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left */}
          <div className="space-y-5">
            {/* Form */}
            <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
              <h2 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Datos del Visitante</h2>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-400">
                  Nombre
                  <input className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    value={visitorName} onChange={e => setVisitorName(e.target.value)} placeholder="Juan Pérez" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Teléfono
                  <input className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    value={phone} onChange={e => setPhone(e.target.value)} placeholder="+56 9…" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Patente
                  <input className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    value={plate} onChange={e => setPlate(e.target.value)} placeholder="ABCD12" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Llegada
                  <input type="datetime-local" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    value={arrival} onChange={e => setArrival(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Salida
                  <input type="datetime-local" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    value={departure} onChange={e => setDeparture(e.target.value)} />
                </label>
              </div>
            </section>

            {/* Actions */}
            <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3">
              <h2 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Acciones (en orden)</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '1. Login',            fn: handleLogin,   disabled: busy || loggedIn,                      color: 'blue' },
                  { label: '2. Descubrir Canales', fn: handleDiscover, disabled: busy || !loggedIn,                    color: 'indigo' },
                  { label: '3. Passport (opt.)',   fn: handlePassport, disabled: busy || !loggedIn,                    color: 'violet' },
                  { label: '4. Crear Visitante',   fn: handleCreate,  disabled: busy || !loggedIn || !selected.size,  color: 'green' },
                ].map(({ label, fn, disabled, color }) => (
                  <button key={label} onClick={fn} disabled={disabled}
                    className={`py-3 px-4 rounded-xl font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-white
                      ${color === 'blue'   ? 'bg-blue-700   hover:bg-blue-600'   : ''}
                      ${color === 'indigo' ? 'bg-indigo-700 hover:bg-indigo-600' : ''}
                      ${color === 'violet' ? 'bg-violet-700 hover:bg-violet-600' : ''}
                      ${color === 'green'  ? 'bg-green-700  hover:bg-green-600'  : ''}`}>
                    {label}
                  </button>
                ))}
                <button onClick={handleLogout} disabled={busy || !loggedIn}
                  className="col-span-2 py-3 rounded-xl font-bold text-sm bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white">
                  5. Logout
                </button>
              </div>
              {!selected.size && channels.length > 0 && (
                <p className="text-xs text-yellow-400">⚠ Seleccioná al menos un canal antes de crear.</p>
              )}
            </section>

            {/* Channels */}
            {channels.length > 0 && (
              <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3">
                <h2 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Canales ACS ({channels.length})</h2>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {channels.map(ch => (
                    <label key={ch.id} className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer border transition-colors ${selected.has(ch.id) ? 'bg-blue-900/30 border-blue-500/40' : 'hover:bg-gray-800 border-transparent'}`}>
                      <input type="checkbox" className="mt-0.5 accent-blue-500" checked={selected.has(ch.id)} onChange={() => toggle(ch.id)} />
                      <div className="min-w-0">
                        <p className="text-xs text-gray-200">{ch.orgName || '(sin nombre)'}</p>
                        <p className="text-[10px] text-gray-500 font-mono break-all">{ch.id}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {/* QR */}
            {qrcode && (
              <section className="bg-gray-900 border border-green-700 rounded-xl p-5 text-center space-y-3">
                <h2 className="text-xs font-bold text-green-400 uppercase tracking-widest">QR Generado</h2>
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrcode)}`}
                  alt="QR visitante" width={200} height={200} className="mx-auto rounded-lg border border-gray-700" />
                <p className="text-[10px] text-gray-500 break-all">{qrcode}</p>
              </section>
            )}
          </div>

          {/* Log */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Log</h2>
              <button onClick={() => setLog([])} className="text-xs text-gray-500 hover:text-red-400">limpiar</button>
            </div>
            <div ref={logRef} className="flex-1 overflow-y-auto space-y-2 min-h-[400px] max-h-[70vh]">
              {log.length === 0 && <p className="text-xs text-gray-600 italic">Sin eventos. Presioná Login para comenzar.</p>}
              {log.map((e, i) => (
                <div key={i} className={`rounded-lg p-3 border text-xs ${e.ok ? 'bg-green-950/50 border-green-800/50' : 'bg-red-950/50 border-red-800/50'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-bold ${e.ok ? 'text-green-400' : 'text-red-400'}`}>{e.ok ? '✓' : '✗'} {e.label}</span>
                    <span className="text-gray-500 ml-auto">{e.ts}</span>
                  </div>
                  <pre className="text-gray-300 whitespace-pre-wrap break-all leading-relaxed">{JSON.stringify(e.payload, null, 2)}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-700">
          proxy: /dahua/ → {import.meta.env.VITE_DAHUA_HOST || '(VITE_DAHUA_HOST no configurado)'}
        </p>
      </div>
    </div>
  );
}
