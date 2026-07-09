import React, { useEffect, useState } from 'react';
import { authedFetch } from '../lib/apiBase';
import { PageHeader, Card, Button, Badge, Spinner } from '../components/ui';
import { ShieldCheck, Download, Send, FileText } from 'lucide-react';

type ReqType = 'acceso' | 'rectificacion' | 'eliminacion' | 'oposicion' | 'portabilidad';
interface Req { id: string; type: ReqType; status: string; message: string; note?: string; createdAt: number | null; }

const TYPE_LABEL: Record<ReqType, string> = {
  acceso: 'Acceso a mis datos',
  rectificacion: 'Rectificar un dato',
  eliminacion: 'Eliminar mis datos',
  oposicion: 'Oponerme a un tratamiento',
  portabilidad: 'Portabilidad (llevar mis datos)',
};
const STATUS: Record<string, { label: string; variant: 'warn' | 'success' | 'danger' }> = {
  pending: { label: 'Pendiente', variant: 'warn' },
  resolved: { label: 'Resuelta', variant: 'success' },
  rejected: { label: 'Rechazada', variant: 'danger' },
};

const MyData: React.FC = () => {
  const [requests, setRequests] = useState<Req[] | null>(null);
  const [type, setType] = useState<ReqType>('rectificacion');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [ok, setOk] = useState(false);

  const loadReqs = () => authedFetch('/api/me/requests').then(r => r.json()).then(d => setRequests(d.requests || [])).catch(() => setRequests([]));
  useEffect(() => { loadReqs(); }, []);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await authedFetch('/api/me/data');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    } catch { alert('No se pudo descargar. Intenta nuevamente.'); }
    finally { setDownloading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() && type !== 'acceso' && type !== 'portabilidad') { alert('Describe tu solicitud.'); return; }
    setSending(true); setOk(false);
    try {
      const res = await authedFetch('/api/me/rights-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message }),
      });
      if (!res.ok) throw new Error();
      setOk(true); setMessage('');
      loadReqs();
    } catch { alert('No se pudo enviar la solicitud.'); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={ShieldCheck} title="Mis datos personales"
        description="Ejerce tus derechos sobre tus datos personales conforme a la Ley N° 21.719." />

      {/* Portabilidad / acceso */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2"><FileText size={16} /> Descargar mis datos</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-prose">
              Obtén una copia de los datos personales que tenemos sobre ti (perfil, consentimiento, pases, reservas y accesos) en formato estructurado.
            </p>
          </div>
          <Button icon={Download} onClick={download} loading={downloading}>Descargar (JSON)</Button>
        </div>
      </Card>

      {/* Solicitud de derecho */}
      <Card className="p-5">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">Enviar una solicitud</h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(Object.keys(TYPE_LABEL) as ReqType[]).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`text-left px-3 py-2.5 rounded-xl border text-sm transition-colors cursor-pointer ${
                  type === t ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
            placeholder="Detalla tu solicitud (ej.: corregir mi teléfono, eliminar mi cuenta, etc.)"
            className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/50 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500" />
          <div className="flex items-center gap-3">
            <Button type="submit" icon={Send} loading={sending}>Enviar solicitud</Button>
            {ok && <span className="text-sm text-emerald-600">✓ Solicitud enviada. Te responderemos dentro del plazo legal (30 días).</span>}
          </div>
        </form>
      </Card>

      {/* Mis solicitudes */}
      <Card className="p-5">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">Mis solicitudes</h3>
        {!requests ? <Spinner size={26} /> : requests.length === 0 ? (
          <p className="text-sm text-slate-400">No has enviado solicitudes.</p>
        ) : (
          <div className="space-y-2">
            {requests.map(r => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 dark:border-white/5 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{TYPE_LABEL[r.type] || r.type}</div>
                  {r.message && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{r.message}</div>}
                  {r.note && <div className="text-xs text-slate-400 mt-0.5">Respuesta: {r.note}</div>}
                </div>
                <Badge variant={STATUS[r.status]?.variant || 'warn'}>{STATUS[r.status]?.label || r.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default MyData;
