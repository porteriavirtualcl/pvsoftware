'use strict';
// QR de visitas SIN DSS ("pass-through") para controladores Dahua ASI.
//
// Con `BackendComparison.QRCodeTransmissionEnable=true` el equipo deja de validar el QR él mismo:
// lo reenvía crudo por su "Carga automática" (HTTP) y espera que el backend decida. Aquí se busca
// la visita en Firestore, se comprueba su vigencia y, si corresponde, se abre la puerta por CGI
// directo al equipo (lib/dahuaDevice.cjs). El contenido del QR lo define nuestra app: hoy el
// `dahuaPassportCardNo` de la visita; también se acepta un campo propio `qrToken`.
//
// Variables de entorno:
//   QR_PASSTHROUGH_ENABLED=1     activa la ruta (apagada por defecto: producción no la usa)
//   QR_PASSTHROUGH_SECRET        segmento secreto de la ruta. En el equipo, Carga automática →
//                                Ruta = /api/dahua/qr-passthrough/<secret>
//   QR_DEVICES                   JSON { "<SN del equipo>": { ip, channel?, condoId?, user?, pass? } }
//   DEVICE_ADMIN_USER / _PASS    credenciales admin por defecto de los equipos
const zlib = require('zlib');
const { abrirPuerta } = require('./dahuaDevice.cjs');

const ESTADOS_CERRADOS = new Set(['finalized', 'cancelled', 'canceled', 'exited', 'rejected', 'expired']);
const TOLERANCIA_S = 15 * 60;

function leerDispositivos() {
  try { return JSON.parse(process.env.QR_DEVICES || '{}') || {}; }
  catch { console.warn('[QR] QR_DEVICES no es JSON válido'); return {}; }
}

// El equipo manda "Content-Encoding: deflate" aunque el cuerpo venga en JSON plano; body-parser
// respondería 415. Se lee crudo y se intenta JSON directo, luego inflate e inflateRaw.
function leerJsonCrudo(req, _res, next) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    req._body = true; req.body = {};
    for (const intento of [() => buf, () => zlib.inflateSync(buf), () => zlib.inflateRawSync(buf)]) {
      try { req.body = JSON.parse(intento().toString('utf8')); break; } catch { /* siguiente intento */ }
    }
    next();
  });
  req.on('error', next);
}

function aSegundos(t) { const n = Number(t); if (!n) return null; return n > 1e12 ? Math.floor(n / 1000) : n; }

async function buscarVisita(admin, qr, condoId) {
  const db = admin.firestore();
  const condos = condoId ? [condoId] : (await db.collection('condos').select().get()).docs.map((d) => d.id);
  for (const cid of condos) {
    // qrCodeValue: QR que la app genera sola cuando no hay DSS (8 hex); es lo que muestra en pantalla.
    for (const campo of ['dahuaPassportCardNo', 'qrToken', 'qrCodeValue']) {
      const s = await db.collection(`condos/${cid}/visitors`).where(campo, '==', qr).limit(1).get();
      if (!s.empty) return { ref: s.docs[0].ref, v: s.docs[0].data(), condoId: cid };
    }
  }
  return null;
}

/** Devuelve el motivo de rechazo, o null si el pase está vigente. */
function evaluar(v) {
  if (ESTADOS_CERRADOS.has(String(v.status || ''))) return `pase ${v.status}`;
  const now = Math.floor(Date.now() / 1000), ini = aSegundos(v.startTs), fin = aSegundos(v.endTs);
  if (ini && now < ini - TOLERANCIA_S) return 'aún no vigente';
  if (fin && now > fin + TOLERANCIA_S) return 'vencido';
  return null;
}

function crearHandler(admin) {
  return async (req, res) => {
    const secret = process.env.QR_PASSTHROUGH_SECRET || '';
    if (!secret || req.params.secret !== secret) return res.status(401).json({ error: 'no autorizado' });
    const d = (req.body && req.body.Data) || {};
    const qr = String(d.QRCode || d.QRCodeEx || '').trim();
    const sn = String(d.SN || '');
    // Sólo lecturas de QR (Method 14). Los registros offline y otros eventos del mismo canal se aceptan sin acción.
    if (!qr || (d.Method !== undefined && Number(d.Method) !== 14)) return res.json({ Data: { TxnID: d.TxnID, Result: false } });

    const equipo = leerDispositivos()[sn];
    let permitido = false, motivo = '', visita = null;
    try {
      if (!admin.apps.length) motivo = 'Firestore no disponible';
      else if (!equipo) motivo = `equipo ${sn || '?'} no está en QR_DEVICES`;
      else {
        visita = await buscarVisita(admin, qr, equipo.condoId);
        motivo = !visita ? 'QR no corresponde a ninguna visita' : (evaluar(visita.v) || '');
        permitido = !!visita && !motivo;
      }
    } catch (e) { motivo = e.message; }

    // Responder ya: el equipo espera pocos segundos (BackendComparison.ValidTime).
    res.json({ Data: { TxnID: d.TxnID, TransmissionUuid: d.TransmissionUuid, Result: permitido, Allow: permitido ? 1 : 0 } });

    if (!permitido) { console.log(`[QR] ${sn} "${qr}" DENEGADO: ${motivo}`); return; }
    const r = await abrirPuerta({
      ip: equipo.ip, channel: equipo.channel || 1,
      user: equipo.user || process.env.DEVICE_ADMIN_USER, pass: equipo.pass || process.env.DEVICE_ADMIN_PASS,
    }).catch((e) => ({ ok: false, detalle: e.message }));
    console.log(`[QR] ${sn} "${qr}" PERMITIDO → ${visita.v.visitorName || visita.ref.id} · openDoor ${r.detalle}`);
    visita.ref.set({ lastQrScanAt: admin.firestore.Timestamp.now(), lastQrScanDevice: sn, lastQrScanOk: r.ok }, { merge: true }).catch(() => {});
  };
}

/** Registra la ruta y los latidos de la Carga automática. No hace nada salvo QR_PASSTHROUGH_ENABLED=1. */
function montar(app, admin) {
  if (process.env.QR_PASSTHROUGH_ENABLED !== '1') return false;
  if (!process.env.QR_PASSTHROUGH_SECRET) { console.warn('[QR] QR_PASSTHROUGH_ENABLED=1 pero falta QR_PASSTHROUGH_SECRET — ruta desactivada'); return false; }
  app.post('/api/dahua/qr-passthrough/:secret', crearHandler(admin));
  // Latidos que el equipo manda a la raíz del host configurado; responder JSON en vez del index.html.
  app.get(['/EventHttpUpload/keepalive', '/PictureHttpUpload/keepalive'], (_req, res) => res.json({ result: true }));
  console.log('[QR] pass-through activo · equipos: ' + (Object.keys(leerDispositivos()).join(', ') || '(ninguno en QR_DEVICES)'));
  return true;
}

module.exports = { montar, leerJsonCrudo, crearHandler, buscarVisita, evaluar };
