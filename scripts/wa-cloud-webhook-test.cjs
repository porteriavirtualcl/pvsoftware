#!/usr/bin/env node
// Pruebas de la integración con WhatsApp Cloud API. No necesitan Firebase ni red.
//
//   node scripts/wa-cloud-webhook-test.cjs
//       Pruebas unitarias de lib/waCloud.cjs: firma HMAC, normalización del
//       webhook y traducción de errores de Graph API.
//
//   node scripts/wa-cloud-webhook-test.cjs --post https://host/api/wa/cloud/webhook --secret APP_SECRET [--phone-id 123]
//       Firma un evento de ejemplo con el App Secret y lo envía al webhook real,
//       tal como lo haría Meta. Sirve para probar el servidor de punta a punta
//       antes de tener el número migrado.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const wa = require(path.join(__dirname, '..', 'lib', 'waCloud.cjs'));

// Evento realista de Meta: un texto, una imagen con caption y un estado de entrega.
const sample = (phoneId = '123456789012345') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '100000000000000', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '56912345678', phone_number_id: phoneId },
    contacts: [{ profile: { name: 'Vecina de Prueba' }, wa_id: '56987654321' }],
    messages: [
      { from: '56987654321', id: 'wamid.TEXT1', timestamp: '1757900000', type: 'text',
        text: { body: 'Hola, ¿llegó mi encomienda?' } },
      { from: '56987654321', id: 'wamid.IMG1', timestamp: '1757900010', type: 'image',
        image: { id: 'MEDIA1', mime_type: 'image/jpeg', sha256: 'abc', caption: 'la foto' } },
    ],
    statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1757900020', recipient_id: '56987654321' }],
  }}]}],
});

const firma = (raw, secret) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

function unit() {
  let n = 0;
  const t = (nombre, fn) => { fn(); n++; console.log('  ✓', nombre); };

  const secret = 'secreto-de-prueba';
  const raw = Buffer.from(JSON.stringify(sample()));

  t('firma válida se acepta',            () => assert.strictEqual(wa.verifySignature(raw, firma(raw, secret), secret), true));
  t('firma con otro secreto se rechaza', () => assert.strictEqual(wa.verifySignature(raw, firma(raw, 'otro'), secret), false));
  t('cuerpo alterado se rechaza',        () => assert.strictEqual(wa.verifySignature(Buffer.from(raw + ' '), firma(raw, secret), secret), false));
  t('sin cabecera se rechaza',           () => assert.strictEqual(wa.verifySignature(raw, undefined, secret), false));
  t('cabecera mal formada se rechaza',   () => assert.strictEqual(wa.verifySignature(raw, 'sha1=abc', secret), false));
  t('sin secreto configurado se rechaza',() => assert.strictEqual(wa.verifySignature(raw, firma(raw, secret), ''), false));

  const ev = wa.normalizeWebhook(sample());
  t('un evento por cambio',              () => assert.strictEqual(ev.length, 1));
  t('trae el phoneNumberId',             () => assert.strictEqual(ev[0].phoneNumberId, '123456789012345'));
  t('dos mensajes y un estado',          () => { assert.strictEqual(ev[0].messages.length, 2); assert.strictEqual(ev[0].statuses.length, 1); });
  t('texto: cuerpo, remitente y nombre', () => {
    const m = ev[0].messages[0];
    assert.strictEqual(m.type, 'text'); assert.strictEqual(m.text, 'Hola, ¿llegó mi encomienda?');
    assert.strictEqual(m.from, '56987654321'); assert.strictEqual(m.name, 'Vecina de Prueba');
    assert.strictEqual(m.waMessageId, 'wamid.TEXT1'); assert.strictEqual(m.ts, 1757900000); assert.strictEqual(m.media, null);
  });
  t('imagen: media con id/mime y caption como texto', () => {
    const m = ev[0].messages[1];
    assert.strictEqual(m.type, 'image'); assert.strictEqual(m.text, 'la foto');
    assert.deepStrictEqual(m.media, { id: 'MEDIA1', mimeType: 'image/jpeg', filename: '', sha256: 'abc' });
  });
  t('estado de entrega normalizado',     () => assert.deepStrictEqual(ev[0].statuses[0],
      { waMessageId: 'wamid.OUT1', status: 'delivered', recipientId: '56987654321', ts: 1757900020, errors: null }));
  t('payload de otro objeto se ignora',  () => assert.deepStrictEqual(wa.normalizeWebhook({ object: 'page', entry: [] }), []));
  t('payload vacío/nulo se ignora',      () => { assert.deepStrictEqual(wa.normalizeWebhook(null), []); assert.deepStrictEqual(wa.normalizeWebhook({}), []); });
  t('ubicación y reacción producen texto', () => {
    const loc = wa.normalizeMessage({ id: 'x', from: '1', timestamp: '1', type: 'location', location: { latitude: -33.4, longitude: -70.6, name: 'Portería' } }, new Map());
    assert.ok(loc.text.includes('-33.4') && loc.text.includes('Portería'));
    const re = wa.normalizeMessage({ id: 'y', from: '1', timestamp: '1', type: 'reaction', reaction: { emoji: '👍' } }, new Map());
    assert.strictEqual(re.text, '👍');
  });

  t('error 131047 → 409 ventana de 24 h', () => {
    const m = wa.mapGraphError({ error: { code: 131047, message: 'Re-engagement message' } });
    assert.strictEqual(m.status, 409); assert.ok(/24 horas/.test(m.error)); assert.strictEqual(m.code, 131047);
  });
  t('error 190 → 503 token',             () => assert.strictEqual(wa.mapGraphError({ error: { code: 190 } }).status, 503));
  t('error 131030 → 422 destinatario no permitido (número de pruebas)', () => {
    const m = wa.mapGraphError({ error: { code: 131030, message: 'Recipient phone number not in allowed list' } });
    assert.strictEqual(m.status, 422); assert.ok(/API Setup/.test(m.error));
  });
  t('error desconocido → 502 con detalle', () => {
    const m = wa.mapGraphError({ error: { code: 999, message: 'Algo raro' } });
    assert.strictEqual(m.status, 502); assert.ok(m.error.includes('Algo raro'));
  });

  // Calling API
  const callsPayload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'calls', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '56921753798', phone_number_id: '1365524493303542' },
    contacts: [{ profile: { name: 'Vecino' }, wa_id: '56987654321' }],
    calls: [{ id: 'wacid.ABC', to: '56921753798', from: '56987654321', event: 'connect', timestamp: '1757900000',
      direction: 'USER_INITIATED', session: { sdp_type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111' } }],
    statuses: [{ id: 'wacid.ABC', type: 'call', status: 'RINGING', timestamp: '1757900001', recipient_id: '56987654321' }],
  } }] }] };
  const cev = wa.normalizeWebhook(callsPayload);
  t('campo calls: llamada entrante normalizada', () => {
    assert.strictEqual(cev.length, 1);
    const c = cev[0].calls[0];
    assert.strictEqual(c.direction, 'inbound'); assert.strictEqual(c.event, 'connect'); assert.strictEqual(c.name, 'Vecino');
    assert.ok(c.sdp.includes('m=audio')); assert.strictEqual(cev[0].messages.length, 0);
  });
  t('estados de llamada separados de los de mensaje', () => {
    assert.strictEqual(cev[0].callStatuses.length, 1); assert.strictEqual(cev[0].callStatuses[0].status, 'RINGING');
    assert.strictEqual(cev[0].statuses.length, 0);
  });
  t('terminate trae duración y resultado', () => {
    const c = wa.normalizeCall({ id: 'wacid.X', event: 'terminate', direction: 'BUSINESS_INITIATED', status: 'COMPLETED', duration: 120, start_time: '1', end_time: '121' });
    assert.strictEqual(c.direction, 'outbound'); assert.strictEqual(c.status, 'COMPLETED'); assert.strictEqual(c.duration, 120);
  });
  t('respuesta al permiso de llamada', () => {
    const m = wa.normalizeMessage({ id: 'm1', from: '1', timestamp: '1', type: 'interactive',
      interactive: { type: 'call_permission_reply', call_permission_reply: { response: 'accept', is_permanent: false, expiration_timestamp: '1758000000', response_source: 'user_action' } } }, new Map());
    assert.strictEqual(m.callPermission.response, 'accept'); assert.strictEqual(m.callPermission.expiresAt, 1758000000); assert.ok(/Aceptó/.test(m.text));
  });
  t('error 138006 → 409 sin permiso para llamar', () => {
    const m = wa.mapGraphError({ error: { code: 138006 } });
    assert.strictEqual(m.status, 409); assert.ok(/autoriz/i.test(m.error));
  });

  console.log(`\n${n} pruebas OK`);
}

async function post(url, secret, phoneId) {
  const body = JSON.stringify(sample(phoneId));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma(Buffer.from(body), secret) },
    body,
  });
  console.log(`POST ${url}\n  → HTTP ${res.status}  ${await res.text()}`);
}

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
if (arg('--post')) {
  if (!arg('--secret')) { console.error('Falta --secret'); process.exit(1); }
  post(arg('--post'), arg('--secret'), arg('--phone-id') || '123456789012345').catch(e => { console.error(e.message); process.exit(1); });
} else {
  unit();
}
