'use strict';
// Piezas puras de la integración con WhatsApp Cloud API (Meta).
// Sin Firebase ni Express a propósito: se prueban con `node scripts/wa-cloud-webhook-test.cjs`.
//   - verifySignature : valida la firma HMAC-SHA256 que Meta pone en X-Hub-Signature-256
//   - normalizeWebhook: convierte el payload del webhook en eventos planos por número
//   - mapGraphError   : traduce los códigos de error de Graph API a mensajes para el operador
const crypto = require('crypto');

/** true si `headerValue` ("sha256=<hex>") es la firma HMAC-SHA256 de `rawBody` con `appSecret`. */
function verifySignature(rawBody, headerValue, appSecret) {
  if (!appSecret || !headerValue || !rawBody) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(String(headerValue).trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(m[1].toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MEDIA_TYPES = new Set(['image', 'sticker', 'video', 'audio', 'document']);

/** Un mensaje de Meta → { waMessageId, from, name, ts, type, text, media, context }. */
function normalizeMessage(m, names) {
  const type = m.type || 'unknown';
  let text = '';
  let media = null;
  if (type === 'text') {
    text = m.text?.body || '';
  } else if (MEDIA_TYPES.has(type)) {
    const obj = m[type] || {};
    media = { id: obj.id || '', mimeType: obj.mime_type || '', filename: obj.filename || '', sha256: obj.sha256 || '' };
    text = obj.caption || '';
  } else if (type === 'location') {
    const l = m.location || {};
    text = `📍 ${l.latitude},${l.longitude}${l.name ? ' · ' + l.name : ''}`;
  } else if (type === 'contacts') {
    text = '👤 ' + (m.contacts || []).map(c => c.name?.formatted_name).filter(Boolean).join(', ');
  } else if (type === 'button') {
    text = m.button?.text || '';
  } else if (type === 'interactive') {
    text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
  } else if (type === 'reaction') {
    text = m.reaction?.emoji || '';
  }
  return {
    waMessageId: m.id || '',
    from: m.from || '',
    name: (names && names.get(m.from)) || '',
    ts: Number(m.timestamp) || 0,
    type, text, media,
    context: m.context ? { from: m.context.from || '', id: m.context.id || '' } : null,
  };
}

/**
 * Payload completo del webhook → [{ phoneNumberId, displayPhone, messages[], statuses[] }].
 * Una entrega puede traer varios cambios; cada uno viene con el phone_number_id
 * al que pertenece, que es la clave para saber a qué número nuestro va.
 */
function normalizeWebhook(payload) {
  const out = [];
  if (!payload || payload.object !== 'whatsapp_business_account') return out;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const v = change.value || {};
      const names = new Map((v.contacts || []).map(c => [c.wa_id, c.profile?.name || '']));
      out.push({
        phoneNumberId: String(v.metadata?.phone_number_id || ''),
        displayPhone:  String(v.metadata?.display_phone_number || ''),
        messages: (v.messages || []).map(m => normalizeMessage(m, names)),
        statuses: (v.statuses || []).map(s => ({
          waMessageId: s.id || '',
          status:      s.status || '',
          recipientId: s.recipient_id || '',
          ts:          Number(s.timestamp) || 0,
          errors:      s.errors || null,
        })),
      });
    }
  }
  return out;
}

// Códigos de Graph API que el operador puede encontrarse y qué decirle.
const SEND_ERRORS = {
  131047: { status: 409, error: 'Han pasado más de 24 horas desde el último mensaje del contacto. WhatsApp sólo permite reabrir la conversación con una plantilla aprobada.' },
  131026: { status: 422, error: 'El número no puede recibir mensajes de WhatsApp (no tiene WhatsApp o bloqueó este número).' },
  131051: { status: 422, error: 'Tipo de mensaje no soportado por WhatsApp.' },
  131053: { status: 422, error: 'No se pudo subir el archivo adjunto a WhatsApp.' },
  130429: { status: 429, error: 'Límite de envío de WhatsApp alcanzado. Intenta en unos minutos.' },
  // Número de pruebas de Meta: sólo puede escribir a destinatarios verificados en API Setup.
  131030: { status: 422, error: 'Este número de WhatsApp es de pruebas: sólo puede escribir a destinatarios agregados en Meta → API Setup → "To". Agrega ese celular ahí (recibirá un código) y reintenta.' },
  131031: { status: 503, error: 'La cuenta de WhatsApp Business está bloqueada por Meta. Revisa el estado en Meta Business.' },
  133010: { status: 503, error: 'El número no está registrado en la Cloud API. Complétalo en Meta → WhatsApp → API Setup.' },
  190:    { status: 503, error: 'El token de acceso de WhatsApp expiró o es inválido. Avisa al administrador.' },
  100:    { status: 400, error: 'Parámetro inválido en el envío a WhatsApp.' },
};

/** Respuesta de error de Graph API → { status, error, code, detail } listo para res.status().json(). */
function mapGraphError(json) {
  const e = (json && json.error) || {};
  const known = SEND_ERRORS[e.code];
  const detail = e.error_data?.details || e.message || 'Error desconocido de WhatsApp';
  return {
    status: known ? known.status : 502,
    error:  known ? known.error : `WhatsApp rechazó el envío: ${detail}`,
    code:   e.code || null,
    detail,
  };
}

module.exports = { verifySignature, normalizeWebhook, normalizeMessage, mapGraphError };
