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

  const fetchMyData = async () => {
    const res = await authedFetch('/api/me/data');
    if (!res.ok) throw new Error();
    return res.json();
  };

  const esc = (v: any) => String(v ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const fmtTs = (s: number | undefined) => s ? new Date(s * 1000).toLocaleString('es-CL') : '';

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const d = await fetchMyData();
      const p = d.perfil || {};
      const c = d.consentimiento;
      const rows = (arr: any[], cols: [string, string][]) => !arr || !arr.length
        ? '<p class="empty">Sin registros.</p>'
        : `<table><thead><tr>${cols.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
            arr.map(r => `<tr>${cols.map(([k]) => `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const consentHtml = c
        ? `<div class="grid">
             <div class="field"><label>Reconocimiento facial</label><p>${c.biometric ? 'Autorizado' : 'No autorizado (usa QR)'}</p></div>
             <div class="field"><label>Base</label><p>${esc(c.basis)}</p></div>
             <div class="field"><label>Relación</label><p>${esc(c.relation)}</p></div>
             <div class="field"><label>Fecha</label><p>${fmtTs(c.acceptedAt?._seconds ?? c.acceptedAt?.seconds)}</p></div>
           </div>`
        : '<p class="empty">Sin registro de consentimiento.</p>';
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Mis datos personales</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;padding:24px 20px;max-width:820px;margin:0 auto}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e293b;padding-bottom:14px;margin-bottom:20px;gap:12px;flex-wrap:wrap}
  .logo{font-size:20px;font-weight:900;color:#1e293b}.logo span{color:#3b82f6}
  .doctype{text-align:right}.doctype h2{font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1.5px}
  .doctype p{font-size:12px;color:#6b7280;margin-top:2px}
  .section{margin-bottom:20px}
  .section h3{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:10px;border-bottom:1px solid #e5e7eb;padding-bottom:5px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .field label{font-size:10px;font-weight:700;text-transform:uppercase;color:#9ca3af;display:block;margin-bottom:2px}
  .field p{font-size:13px;font-weight:600;color:#1e293b}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;padding:6px 8px;background:#f1f5f9;border-bottom:1px solid #e2e8f0}
  td{padding:6px 8px;border-bottom:1px solid #eef2f7;color:#374151}
  .empty{font-size:12px;color:#9ca3af}
  .pdf-btn{display:block;width:100%;padding:12px;background:#1e293b;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:20px}
  .footer{margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af}
  @media print{.pdf-btn{display:none}body{padding:14px}}
</style></head><body>
<button class="pdf-btn" onclick="window.print()">⬇ Guardar como PDF</button>
<div class="hdr"><div class="logo">Porteria<span>Virtual</span></div>
  <div class="doctype"><h2>Mis datos personales · Ley 21.719</h2><p>Emitido: ${new Date().toLocaleString('es-CL')}</p></div></div>
<div class="section"><h3>Perfil</h3><div class="grid">
  <div class="field"><label>Nombre</label><p>${esc(p.nombre)}</p></div>
  <div class="field"><label>RUT</label><p>${esc(p.rut) || '—'}</p></div>
  <div class="field"><label>Email</label><p>${esc(p.email) || '—'}</p></div>
  <div class="field"><label>Teléfono</label><p>${esc(p.telefono) || '—'}</p></div>
  <div class="field"><label>Unidad</label><p>${esc(p.unidad) || '—'}</p></div>
  <div class="field"><label>Condominio</label><p>${esc(p.condominio) || '—'}</p></div>
</div></div>
<div class="section"><h3>Consentimiento</h3>${consentHtml}</div>
<div class="section"><h3>Pases de visita</h3>${rows(d.pases, [['visitante', 'Visitante'], ['fecha', 'Fecha'], ['estado', 'Estado'], ['patente', 'Patente']])}</div>
<div class="section"><h3>Reservas</h3>${rows(d.reservas, [['instalacion', 'Instalación'], ['fecha', 'Fecha'], ['horario', 'Horario'], ['estado', 'Estado']])}</div>
<div class="section"><h3>Accesos</h3>${rows(d.accesos, [['fecha', 'Fecha'], ['hora', 'Hora'], ['direccion', 'Dirección'], ['punto', 'Punto']])}</div>
<div class="footer">Portería Virtual SpA · Documento generado a solicitud del titular conforme a la Ley N° 21.719.</div>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { alert('Permite las ventanas emergentes para descargar el PDF.'); return; }
      w.document.write(html); w.document.close();
    } catch { alert('No se pudo generar el PDF. Intenta nuevamente.'); }
    finally { setDownloading(false); }
  };

  const downloadJson = async () => {
    try {
      const data = await fetchMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    } catch { alert('No se pudo descargar. Intenta nuevamente.'); }
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
              Obtén una copia de tus datos personales (perfil, consentimiento, pases, reservas y accesos).
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Button icon={Download} onClick={downloadPdf} loading={downloading}>Descargar (PDF)</Button>
            <button onClick={downloadJson} className="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer">
              o en JSON (portabilidad)
            </button>
          </div>
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
