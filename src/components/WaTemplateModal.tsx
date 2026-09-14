import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, Send } from 'lucide-react';
import { Button, Field, Input, Modal } from './ui';
import { authedFetch } from '../lib/apiBase';

// ─────────────────────────────────────────────────────────────────────────────
// Enviar una plantilla de WhatsApp (Cloud API). Es la única forma de escribirle
// a un número NUEVO o de reabrir un chat con más de 24 h sin respuesta: Meta
// exige que ese primer mensaje sea una plantilla aprobada. Al enviarla, la
// conversación aparece en la lista y, cuando el contacto responde, el operador
// chatea libre durante 24 h.
// ─────────────────────────────────────────────────────────────────────────────

export interface TplNumber { id: string; name: string; phone?: string }
interface Template { name: string; language: string; category: string; body: string; params: number }

// Cómo se llama cada dato de nuestras plantillas (para no mostrar "Dato 1").
const ETIQUETAS: Record<string, string[]> = {
  contacto_porteria:   ['Nombre del residente', 'Condominio'],
  encomienda_en_locker: ['Nombre del residente', 'Condominio', 'N° de casillero'],
  visita_en_porteria:  ['Nombre del residente', 'Condominio', 'Visita (nombre / motivo)'],
};

interface Props {
  open: boolean;
  onClose: () => void;
  numbers: TplNumber[];           // números por API disponibles para este usuario
  defaultNumberId?: string;
  /** Con conversación existente: reabrirla (número fijo). Sin ella: número nuevo. */
  conversationId?: string;
  phone?: string;
  contactName?: string;
  condoName?: string;
  onSent: (conversationId: string) => void;
}

const fmtPreview = (body: string, vals: string[]) =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n) => vals[Number(n) - 1]?.trim() || `[${ETIQUETAS_GENERICA(Number(n))}]`);
const ETIQUETAS_GENERICA = (n: number) => `dato ${n}`;

export default function WaTemplateModal({ open, onClose, numbers, defaultNumberId, conversationId, phone, contactName, condoName, onSent }: Props) {
  const [numberId, setNumberId] = useState(defaultNumberId || numbers[0]?.id || '');
  const [telefono, setTelefono] = useState(phone || '');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  const [vals, setVals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reiniciar al abrir
  useEffect(() => {
    if (!open) return;
    setNumberId(defaultNumberId || numbers[0]?.id || '');
    setTelefono(phone || '');
    setTplName(''); setVals([]); setError(null);
  }, [open, defaultNumberId, phone, numbers]);

  // Plantillas aprobadas del número elegido
  useEffect(() => {
    if (!open || !numberId) return;
    setLoadingTpl(true); setTemplates([]);
    authedFetch(`/api/wa/numbers/${numberId}/templates`)
      .then(r => r.json())
      .then(d => { setTemplates(d.templates || []); if (!d.supported) setError('Este número no tiene WABA configurada.'); })
      .catch(() => setError('No se pudieron cargar las plantillas'))
      .finally(() => setLoadingTpl(false));
  }, [open, numberId]);

  const tpl = useMemo(() => templates.find(t => t.name === tplName), [templates, tplName]);

  // Al elegir plantilla, prellenar nombre/condominio si los conocemos
  useEffect(() => {
    if (!tpl) return;
    const base = Array.from({ length: tpl.params }, (_, i) => vals[i] || '');
    const labels = ETIQUETAS[tpl.name] || [];
    labels.forEach((l, i) => {
      if (base[i]) return;
      if (/nombre/i.test(l) && contactName && !/^\d+$/.test(contactName)) base[i] = contactName.split(' ').slice(0, 2).join(' ');
      if (/condominio/i.test(l) && condoName) base[i] = condoName;
    });
    setVals(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.name]);

  // Número nuevo: buscar al residente por teléfono para rellenar sus datos
  const buscarContacto = async () => {
    const digits = telefono.replace(/\D/g, '');
    if (conversationId || digits.length < 9) return;
    try {
      const d = await (await authedFetch(`/api/wa/contact-lookup?phone=${digits}`)).json();
      if (!tpl) return;
      const labels = ETIQUETAS[tpl.name] || [];
      setVals(prev => prev.map((v, i) => v || (/nombre/i.test(labels[i] || '') ? (d.displayName || '') : /condominio/i.test(labels[i] || '') ? (d.condoName || '') : v)));
    } catch { /* opcional */ }
  };

  const enviar = async () => {
    if (!tpl || busy) return;
    setBusy(true); setError(null);
    try {
      const path = conversationId ? `/api/wa/conversations/${conversationId}/template` : '/api/wa/conversations/start';
      const res = await authedFetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waNumberId: numberId, phone: telefono, templateName: tpl.name, language: tpl.language, params: vals }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'No se pudo enviar');
      onSent(d.conversationId);
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const listo = !!tpl && (conversationId || telefono.replace(/\D/g, '').length >= 9) && vals.slice(0, tpl?.params || 0).every(v => v.trim());

  return (
    <Modal
      open={open} onClose={onClose} size="md" icon={MessageSquarePlus}
      title={conversationId ? 'Reabrir conversación' : 'Nuevo mensaje'}
      description={conversationId
        ? 'Pasaron más de 24 h desde su último mensaje: WhatsApp sólo permite reabrir con una plantilla aprobada.'
        : 'Para escribir a un número nuevo, WhatsApp exige empezar con una plantilla aprobada. Cuando la persona responda, podrás chatear libremente.'}
    >
      <div className="space-y-3">
        {numbers.length > 1 && !conversationId && (
          <Field label="Enviar desde">
            <select value={numberId} onChange={e => setNumberId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100">
              {numbers.map(n => <option key={n.id} value={n.id}>{n.name}{n.phone ? ` (${n.phone})` : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Número de WhatsApp">
          <Input value={telefono} onChange={e => setTelefono(e.target.value)} onBlur={buscarContacto}
            placeholder="+56 9 1234 5678" inputMode="tel" disabled={!!conversationId} />
        </Field>
        <Field label="Plantilla">
          {loadingTpl ? (
            <p className="text-xs text-slate-500">Cargando plantillas aprobadas…</p>
          ) : templates.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">No hay plantillas aprobadas todavía. Meta las revisa tras crearlas (suele tardar minutos).</p>
          ) : (
            <select value={tplName} onChange={e => setTplName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100">
              <option value="">Elige una plantilla…</option>
              {templates.map(t => <option key={t.name + t.language} value={t.name}>{t.name.replace(/_/g, ' ')}</option>)}
            </select>
          )}
        </Field>
        {tpl && Array.from({ length: tpl.params }, (_, i) => (
          <React.Fragment key={i}>
            <Field label={(ETIQUETAS[tpl.name] || [])[i] || `Dato ${i + 1}`}>
              <Input value={vals[i] || ''} onChange={e => setVals(prev => { const c = [...prev]; c[i] = e.target.value; return c; })} />
            </Field>
          </React.Fragment>
        ))}
        {tpl && (
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
            {fmtPreview(tpl.body, vals)}
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={enviar} disabled={!listo} loading={busy} icon={Send} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white border-0">Enviar</Button>
        </div>
      </div>
    </Modal>
  );
}
