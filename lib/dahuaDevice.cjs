'use strict';
// Acceso DIRECTO a un controlador Dahua (ASI/VTO) por su API CGI, vía la VPN (sin DSS).
// Autenticación HTTP Digest (MD5, qop=auth) implementada a mano: fetch de Node no la soporta.
const http = require('http');
const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function pedir({ ip, port = 80, path, user, pass, timeoutMs = 8000 }) {
  const req = (auth) => new Promise((resolve, reject) => {
    const r = http.request({ host: ip, port, path, method: 'GET', timeout: timeoutMs, headers: auth ? { Authorization: auth } : {} }, (res) => {
      let data = ''; res.setEncoding('utf8'); res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('timeout', () => r.destroy(new Error('sin respuesta del equipo'))); r.on('error', reject); r.end();
  });
  return req(null).then((r1) => {
    if (r1.status !== 401) return r1;
    const chal = r1.headers['www-authenticate'] || '';
    const p = {}; chal.replace(/(\w+)=("([^"]*)"|[^,\s]+)/g, (_, k, _2, q) => { p[k.toLowerCase()] = q !== undefined ? q : _2; });
    const nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${user}:${p.realm}:${pass}`), ha2 = md5(`GET:${path}`);
    const qop = /auth/.test(String(p.qop || '')) ? 'auth' : null;
    const resp = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    const auth = `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${path}", response="${resp}", algorithm=MD5` + (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : '') + (p.opaque ? `, opaque="${p.opaque}"` : '');
    return req(auth);
  });
}

/** Abre la puerta `channel` (1 = primera) del controlador. Devuelve { ok, detalle }. */
async function abrirPuerta({ ip, user, pass, channel = 1 }) {
  const r = await pedir({ ip, user, pass, path: `/cgi-bin/accessControl.cgi?action=openDoor&channel=${channel}&UserID=porteria&Type=Remote` });
  const ok = r.status === 200 && /^OK/i.test(r.body.trim());
  return { ok, detalle: ok ? 'OK' : `HTTP ${r.status} ${r.body.trim().slice(0, 80)}` };
}
async function estadoPuerta({ ip, user, pass, channel = 1 }) {
  const r = await pedir({ ip, user, pass, path: `/cgi-bin/accessControl.cgi?action=getDoorStatus&channel=${channel}` });
  return { status: r.status, estado: (r.body.match(/Info\.status=(\w+)/) || [])[1] || null, siempre: (r.body.match(/DoorAlwaysStatus=(\w+)/) || [])[1] || null };
}
async function identificar({ ip, user, pass }) {
  const t = await pedir({ ip, user, pass, path: '/cgi-bin/magicBox.cgi?action=getDeviceType' });
  const n = await pedir({ ip, user, pass, path: '/cgi-bin/magicBox.cgi?action=getMachineName' });
  return { status: t.status, tipo: (t.body.match(/type=(.+)/) || [])[1] || null, nombre: (n.body.match(/name=(.+)/) || [])[1] || null };
}

// ── Credencial QR de visita directa en el equipo (sin DSS) ────────────────────
// El DSS sólo emite el pasaporte (qrcode + passportCardNo con passport/generate);
// aquí bajamos passportCardNo como tarjeta al lector por la VPN. Cuando la visita
// muestra el qrcode, el lector lo descifra → obtiene passportCardNo → abre.
// Verificado end-to-end en MB_Prueba (28-09-2026).

const dosDig = (n) => String(n).padStart(2, '0');
/** Lee el reloj del equipo y devuelve el desfase (ms) equipo-local − UTC, para
 * escribir la vigencia en la MISMA hora local del lector (algunos van en Buenos
 * Aires sin horario de verano, no en la del servidor). */
async function offsetEquipoMs({ ip, user, pass }) {
  const r = await pedir({ ip, user, pass, path: '/cgi-bin/global.cgi?action=getCurrentTime' });
  const m = (r.body || '').match(/result=(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const [, Y, Mo, D, h, mi, s] = m.map(Number);
  const asUtc = Date.UTC(Y, Mo - 1, D, h, mi, s); // interpretamos la hora del equipo como si fuera UTC
  return asUtc - Date.now();                       // ≈ desfase de la zona del equipo
}
/** Formatea un epoch (segundos) como "YYYY-MM-DD HH:MM:SS" en la hora local del equipo. */
function fmtLocalEquipo(epochSec, offsetMs) {
  const d = new Date(epochSec * 1000 + offsetMs);
  return `${d.getUTCFullYear()}-${dosDig(d.getUTCMonth() + 1)}-${dosDig(d.getUTCDate())} ${dosDig(d.getUTCHours())}:${dosDig(d.getUTCMinutes())}:${dosDig(d.getUTCSeconds())}`;
}

/** RecNo(s) de la tarjeta de un UserID en el equipo. */
async function recNosDeUsuario({ ip, user, pass, userId }) {
  const r = await pedir({ ip, user, pass, path: `/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCard&condition.UserID=${encodeURIComponent(userId)}` });
  return [...r.body.matchAll(/records\[\d+\]\.RecNo=(\d+)/g)].map((m) => m[1]);
}

/** Carga (o reemplaza) la credencial QR de una visita en el equipo.
 * cardNo = passportCardNo del DSS; userId identifica el pase (para poder borrarlo). */
async function cargarCredencialQR({ ip, user, pass, cardNo, userId, cardName = 'Visita', startTs, endTs }) {
  if (!cardNo || !userId) throw new Error('cardNo y userId requeridos');
  await borrarCredencialUsuario({ ip, user, pass, userId }).catch(() => {}); // idempotente
  const off = await offsetEquipoMs({ ip, user, pass }).catch(() => 0);
  const desde = fmtLocalEquipo(Number(startTs), off);
  const hasta = fmtLocalEquipo(Number(endTs), off);
  const q = new URLSearchParams({
    action: 'insert', name: 'AccessControlCard',
    CardNo: String(cardNo), UserID: String(userId), CardName: String(cardName).slice(0, 32),
    CardType: '0', CardStatus: '0', UserType: '0', UseTime: '200',
    ValidDateStart: desde, ValidDateEnd: hasta,
  });
  // Doors[0] y TimeSections[0][0] no entran por URLSearchParams (corchetes); van aparte.
  const path = `/cgi-bin/recordUpdater.cgi?${q.toString()}&Doors[0]=0&TimeSections[0][0]=255`;
  const r = await pedir({ ip, user, pass, path });
  const recNo = (r.body.match(/RecNo=(\d+)/) || [])[1] || null;
  const ok = r.status === 200 && !!recNo;
  return { ok, recNo, vigencia: [desde, hasta], detalle: ok ? 'OK' : `HTTP ${r.status} ${r.body.trim().slice(0, 80)}` };
}

/** Borra la credencial de la visita (por UserID). Devuelve cuántas quitó. */
async function borrarCredencialUsuario({ ip, user, pass, userId }) {
  const recs = await recNosDeUsuario({ ip, user, pass, userId });
  let borradas = 0;
  for (const n of recs) {
    const r = await pedir({ ip, user, pass, path: `/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&recno=${n}` });
    if (r.status === 200) borradas++;
  }
  return { ok: true, borradas };
}

module.exports = { abrirPuerta, estadoPuerta, identificar, pedir, cargarCredencialQR, borrarCredencialUsuario, recNosDeUsuario, offsetEquipoMs, fmtLocalEquipo };
