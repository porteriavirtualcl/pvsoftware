'use strict';
// Piezas puras de la integración con WhatsApp Cloud API (Meta).
// Sin Firebase ni Express a propósito: se prueban con `node scripts/wa-cloud-webhook-test.cjs`.
//   - verifySignature : valida la firma HMAC-SHA256 que Meta pone en X-Hub-Signature-256
//   - normalizeWebhook: convierte el payload del webhook en eventos planos por número
//                       (mensajes, estados de entrega, llamadas y estados de llamada)
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
  let callPermission = null;
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
    // Respuesta a nuestra solicitud de permiso para llamar (Calling API).
    if (m.interactive?.type === 'call_permission_reply') {
      const r = m.interactive.call_permission_reply || {};
      callPermission = {
        response:    r.response === 'accept' ? 'accept' : 'reject',
        isPermanent: !!r.is_permanent,
        expiresAt:   Number(r.expiration_timestamp) || 0,
        source:      r.response_source || '',
      };
      text = r.response === 'accept'
        ? '✅ Aceptó recibir llamadas por WhatsApp'
        : '🚫 No aceptó recibir llamadas por WhatsApp';
    }
  } else if (type === 'reaction') {
    text = m.reaction?.emoji || '';
  }
  return {
    waMessageId: m.id || '',
    from: m.from || '',
    name: (names && names.get(m.from)) || '',
    ts: Number(m.timestamp) || 0,
    type, text, media, callPermission,
    context: m.context ? { from: m.context.from || '', id: m.context.id || '' } : null,
  };
}

/**
 * Un evento de llamada de Meta (campo "calls") → objeto plano.
 *   connect   : llamada entrante con la oferta SDP del usuario (USER_INITIATED), o la
 *               respuesta SDP del usuario a una llamada nuestra (BUSINESS_INITIATED).
 *   terminate : fin de la llamada con duración y resultado (COMPLETED | FAILED).
 */
function normalizeCall(c, names) {
  return {
    waCallId:  c.id || '',
    from:      String(c.from || ''),
    to:        String(c.to || ''),
    name:      (names && names.get(String(c.from))) || '',
    event:     c.event || '',
    direction: c.direction === 'BUSINESS_INITIATED' ? 'outbound' : 'inbound',
    ts:        Number(c.timestamp) || 0,
    sdpType:   c.session?.sdp_type || '',
    sdp:       c.session?.sdp || '',
    status:    String(c.status || '').toUpperCase(),
    startTime: Number(c.start_time) || 0,
    endTime:   Number(c.end_time) || 0,
    duration:  Number(c.duration) || 0,
    bizData:   c.biz_opaque_callback_data || '',
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
      // "messages": mensajes y estados de entrega. "calls": llamadas y sus estados
      // (RINGING/ACCEPTED/REJECTED llegan en statuses con type:'call').
      if (change.field !== 'messages' && change.field !== 'calls') continue;
      const v = change.value || {};
      const names = new Map((v.contacts || []).map(c => [c.wa_id, c.profile?.name || '']));
      const statuses = [], callStatuses = [];
      for (const s of v.statuses || []) {
        if (s.type === 'call') {
          callStatuses.push({
            waCallId:    s.id || '',
            status:      String(s.status || '').toUpperCase(),
            recipientId: s.recipient_id || '',
            ts:          Number(s.timestamp) || 0,
            bizData:     s.biz_opaque_callback_data || '',
          });
        } else {
          statuses.push({
            waMessageId: s.id || '',
            status:      s.status || '',
            recipientId: s.recipient_id || '',
            ts:          Number(s.timestamp) || 0,
            errors:      s.errors || null,
          });
        }
      }
      out.push({
        phoneNumberId: String(v.metadata?.phone_number_id || ''),
        displayPhone:  String(v.metadata?.display_phone_number || ''),
        messages: (v.messages || []).map(m => normalizeMessage(m, names)),
        statuses,
        calls:    (v.calls || []).map(c => normalizeCall(c, names)),
        callStatuses,
        errors:   v.errors || null,
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
  // Calling API
  138006: { status: 409, error: 'El contacto aún no autorizó recibir llamadas de este número. Pídele permiso desde el chat o espera a que él llame primero.' },
  138000: { status: 409, error: 'Las llamadas no están habilitadas para este número. Actívalas en WhatsApp — Números.' },
  138002: { status: 409, error: 'El contacto no puede recibir llamadas por WhatsApp en este momento.' },
  138003: { status: 409, error: 'La llamada ya no está disponible (fue contestada, rechazada o terminó).' },
  138004: { status: 422, error: 'WhatsApp rechazó la conexión de audio (SDP/ICE inválido). Reintenta la llamada.' },
  138005: { status: 429, error: 'Límite de llamadas alcanzado para este contacto. Intenta más tarde.' },
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

module.exports = { verifySignature, normalizeWebhook, normalizeMessage, normalizeCall, mapGraphError };
