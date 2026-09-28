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

module.exports = { abrirPuerta, estadoPuerta, identificar, pedir };
