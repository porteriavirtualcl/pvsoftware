'use strict';
// Central SIP mínima (UDP) para recibir llamadas de controladores Dahua configurados con nuestro
// servidor SIP. Sólo acepta cuentas configuradas (digest MD5). Atiende INVITE con audio G.711
// (PCMA/PCMU) y expone el audio como PCM16 8 kHz. Los equipos están tras NAT: se responde siempre a
// la dirección de origen (rport) y el RTP se "engancha" a la dirección de donde llega el primer paquete.
const dgram = require('dgram');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const rnd = (n = 8) => crypto.randomBytes(n).toString('hex');
const COMPACT = { v: 'via', f: 'from', t: 'to', i: 'call-id', m: 'contact', l: 'content-length', c: 'content-type' };

function linToAlaw(s) {
  let sign = (s >> 8) & 0x80; if (sign) s = -s; if (s > 32635) s = 32635;
  let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1);
  const mant = (s >> (exp === 0 ? 4 : exp + 3)) & 0x0f;
  return ((sign | (exp << 4) | mant) ^ 0xd5) & 0xff;
}
function alawToLin(a) { a ^= 0x55; let t = (a & 0x0f) << 4; const seg = (a & 0x70) >> 4; if (seg === 0) t += 8; else if (seg === 1) t += 0x108; else { t += 0x108; t <<= seg - 1; } return (a & 0x80) ? t : -t; }
function linToUlaw(s) {
  const BIAS = 0x84; let sign = 0; if (s < 0) { s = -s; sign = 0x80; } if (s > 32635) s = 32635; s += BIAS;
  let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f; return ~(sign | (exp << 4) | mant) & 0xff;
}
function ulawToLin(u) { u = ~u & 0xff; const sign = u & 0x80, exp = (u >> 4) & 7, mant = u & 0x0f; let s = ((mant << 3) + 0x84) << exp; s -= 0x84; return sign ? -s : s; }

function parse(buf) {
  const txt = buf.toString('utf8'); const sep = txt.indexOf('\r\n\r\n');
  const head = sep >= 0 ? txt.slice(0, sep) : txt; const body = sep >= 0 ? txt.slice(sep + 4) : '';
  const lines = head.split('\r\n'); const first = lines.shift() || '';
  const headers = {};
  for (const l of lines) {
    const i = l.indexOf(':'); if (i < 0) continue;
    let k = l.slice(0, i).trim().toLowerCase(); k = COMPACT[k] || k;
    (headers[k] = headers[k] || []).push(l.slice(i + 1).trim());
  }
  const req = first.match(/^([A-Z]+) (\S+) SIP\/2\.0$/); const res = first.match(/^SIP\/2\.0 (\d{3}) (.*)$/);
  return { method: req ? req[1] : null, uri: req ? req[2] : null, status: res ? Number(res[1]) : null, headers, body, h: (k) => (headers[k] || [])[0] || '' };
}
const tagDe = (v) => (String(v).match(/;tag=([^;>\s]+)/) || [])[1] || null;
const userDe = (v) => (String(v).match(/sip:([^@;>]+)@/) || [])[1] || null;
const paramsDigest = (v) => { const o = {}; String(v).replace(/^Digest\s+/i, '').replace(/(\w+)=("([^"]*)"|[^,\s]+)/g, (_, k, _2, q) => { o[k.toLowerCase()] = q !== undefined ? q : _2; }); return o; };

class SipUas extends EventEmitter {
  /**
   * opts: { port, publicIp, realm, accounts: [{user, pass, ...meta}], rtpPortMin, rtpPortMax, log }
   * Eventos: 'register' (acc, addr), 'invite' (call), 'ended' (call, reason)
   */
  constructor(opts) {
    super();
    this.o = { realm: 'porteriavirtual', rtpPortMin: 40000, rtpPortMax: 40049, log: () => {}, ...opts };
    this.accounts = new Map((opts.accounts || []).map(a => [String(a.user), a]));
    this.bindings = new Map(); // user → { addr, port, expires, contact }
    this.nonces = new Map();
    this.calls = new Map();    // callId → call
    this.tx = new Map();       // `${callId}|${cseq}|${METHOD}` → handler de respuesta (peticiones que iniciamos)
    this.legs = new Map();     // callId → leg de llamadas que iniciamos (DSS, VTS)
    this.usedRtp = new Set();
    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (m, r) => { try { this._onMsg(m, r); } catch (e) { this.o.log('error SIP ' + e.message); } });
    this.sock.on('error', (e) => this.o.log('socket SIP ' + e.message));
  }
  // Los registros se guardan en disco: tras un reinicio los equipos siguen 'registrados' hasta que
  // expire su registro (si no, un reinicio deja a los equipos sin poder llamar durante ~1 min y
  // el equipo Dahua no reintenta el INVITE ante un 401).
  _persistir() { if (!this.o.stateFile) return; try { require('fs').writeFileSync(this.o.stateFile, JSON.stringify([...this.bindings.entries()])); } catch { /* */ } }
  _cargar() {
    if (!this.o.stateFile) return;
    try { const arr = JSON.parse(require('fs').readFileSync(this.o.stateFile, 'utf8')); let n = 0; for (const [u, b] of arr) if (b.expires > Date.now() && this.accounts.has(String(u))) { this.bindings.set(String(u), b); n++; } if (n) this.o.log(`registros recuperados del disco: ${n}`); } catch { /* */ }
  }
  start() { this._cargar(); return new Promise((res) => this.sock.bind(this.o.port, () => { this.o.log(`central SIP escuchando en UDP ${this.o.port}`); res(); })); }
  stop() { for (const c of this.calls.values()) this.hangup(c, 'central detenida'); try { this.sock.close(); } catch { /* */ } }
  /** ¿El equipo `user` tiene un registro vigente en la central? (margen de 30 s) */
  registroActivo(user) { const b = this.bindings.get(String(user)); return !!b && b.expires + 30000 > Date.now(); }
  estado() { return [...this.bindings.entries()].map(([u, b]) => ({ user: u, addr: `${b.addr}:${b.port}`, expira: b.expires, ua: b.ua, tipo: (this.accounts.get(u) || {}).tipo || 'device' })); }

  _send(txt, addr, port) { this.sock.send(Buffer.from(txt), port, addr); }
  _resp(msg, rinfo, code, reason, extra = {}, body = '') {
    const h = [];
    for (const v of msg.headers.via || []) h.push(`Via: ${v.includes('rport') && !/rport=\d/.test(v) ? v.replace(/rport(?!=)/, `rport=${rinfo.port};received=${rinfo.address}`) : v}`);
    const to = msg.h('to');
    h.push(`From: ${msg.h('from')}`, `To: ${extra.toTag && !tagDe(to) ? `${to};tag=${extra.toTag}` : to}`, `Call-ID: ${msg.h('call-id')}`, `CSeq: ${msg.h('cseq')}`);
    for (const [k, v] of Object.entries(extra)) if (k !== 'toTag') h.push(`${k}: ${v}`);
    h.push('Server: PorteriaVirtual-SIP/1.0', `Content-Length: ${Buffer.byteLength(body)}`);
    this._send(`SIP/2.0 ${code} ${reason}\r\n${h.join('\r\n')}\r\n\r\n${body}`, rinfo.address, rinfo.port);
  }
  _auth(msg, rinfo, method) {
    const cred = msg.h('authorization') || msg.h('proxy-authorization');
    const user = userDe(msg.h('from'));
    const acc = this.accounts.get(String(user));
    if (!acc) { this._resp(msg, rinfo, 403, 'Forbidden'); return null; }
    if (cred) {
      const p = paramsDigest(cred);
      if (p.username === String(acc.user) && this.nonces.has(p.nonce)) {
        const ha1 = md5(`${acc.user}:${this.o.realm}:${acc.pass}`); const ha2 = md5(`${method}:${p.uri}`);
        const ok = p.qop ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
        if (ok === p.response) return acc;
      }
    }
    const nonce = rnd(16); this.nonces.set(nonce, Date.now());
    if (this.nonces.size > 500) { const lim = Date.now() - 600000; for (const [n, t] of this.nonces) if (t < lim) this.nonces.delete(n); }
    this._resp(msg, rinfo, 401, 'Unauthorized', { 'WWW-Authenticate': `Digest realm="${this.o.realm}", nonce="${nonce}", algorithm=MD5, qop="auth"` });
    return null;
  }

  _onMsg(buf, rinfo) {
    if (buf.length < 8) return; // keep-alive CRLF
    const msg = parse(buf);
    if (!msg.method) return this._onResponse(msg, rinfo);
    // Petición dentro de un diálogo que iniciamos nosotros (VTS o DSS).
    const legIn = this.legs.get(msg.h('call-id'));
    if (legIn && legIn.onRequest) return legIn.onRequest(msg, rinfo);
    switch (msg.method) {
      case 'REGISTER': {
        const acc = this._auth(msg, rinfo, 'REGISTER'); if (!acc) return;
        const exp = Number((msg.h('contact').match(/expires=(\d+)/) || [])[1] || msg.h('expires') || 3600);
        if (exp === 0) this.bindings.delete(String(acc.user));
        else {
          const prev = this.bindings.get(String(acc.user)); const nuevo = !prev || prev.expires < Date.now();
          this.bindings.set(String(acc.user), { addr: rinfo.address, port: rinfo.port, expires: Date.now() + exp * 1000, contact: msg.h('contact'), ua: msg.h('user-agent') });
          if (nuevo) this.emit('register', acc, rinfo);
        }
        this._persistir();
        return this._resp(msg, rinfo, 200, 'OK', { Contact: `${msg.h('contact').replace(/;expires=\d+/, '')};expires=${Math.min(exp, 60)}`, Expires: String(Math.min(exp, 60)) });
      }
      case 'OPTIONS': return this._resp(msg, rinfo, 200, 'OK', { Allow: 'INVITE, ACK, CANCEL, BYE, OPTIONS, REGISTER' });
      case 'INVITE': return this._onInvite(msg, rinfo);
      case 'ACK': { const c = this.calls.get(msg.h('call-id')); if (c && c.state === 'answered') c.state = 'confirmed'; return; }
      case 'CANCEL': {
        const c = this.calls.get(msg.h('call-id'));
        this._resp(msg, rinfo, 200, 'OK', { toTag: c ? c.localTag : rnd(4) });
        if (c && c.state === 'ringing') { this._resp(c.invite, c.rinfo, 487, 'Request Terminated', { toTag: c.localTag }); this._end(c, 'el equipo cortó antes de contestar'); }
        return;
      }
      case 'BYE': {
        const c = this.calls.get(msg.h('call-id'));
        this._resp(msg, rinfo, 200, 'OK');
        if (c) this._end(c, 'el equipo cortó');
        return;
      }
      case 'INFO': case 'MESSAGE': case 'UPDATE': {
        const c = this.calls.get(msg.h('call-id'));
        this._resp(msg, rinfo, 200, 'OK');
        if (c) this.emit('inrequest', c, msg);
        return;
      }
      default: return this._resp(msg, rinfo, 405, 'Method Not Allowed');
    }
  }
  _onResponse(msg, rinfo) {
    const cs = String(msg.h('cseq')).split(/\s+/);
    const fn = this.tx.get(`${msg.h('call-id')}|${cs[0]}|${String(cs[1] || '').toUpperCase()}`);
    if (fn) return fn(msg, rinfo);
    /* respuestas a nuestros BYE/CANCEL: no se requiere acción */
  }
  _nextCseq(call) { if (!call.localCseq) call.localCseq = Number(String(call.invite.h('cseq')).split(' ')[0]) + 1; return ++call.localCseq; }
  /** Contesta la llamada con un SDP ya armado (relay): no abre RTP propio. */
  answerRelay(call, sdp) {
    if (call.state !== 'ringing') return false;
    clearInterval(call.ringTimer); call.answerSdp = sdp; call.relay = true;
    this._resp(call.invite, call.rinfo, 200, 'OK', { toTag: call.localTag, Contact: call.contact, 'Content-Type': 'application/sdp', Allow: 'INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, MESSAGE' }, sdp);
    call.state = 'answered'; call.answeredAt = Date.now();
    let n = 0; call.okTimer = setInterval(() => { if (call.state !== 'answered' || ++n > 6) return clearInterval(call.okTimer); this._resp(call.invite, call.rinfo, 200, 'OK', { toTag: call.localTag, Contact: call.contact, 'Content-Type': 'application/sdp' }, sdp); }, 500);
    return true;
  }
  /** Reenvía al controlador, dentro de su diálogo, una petición recibida por otro tramo (p. ej. INFO de apertura del VTS). */
  forwardToCall(call, msg) {
    if (!call || call.ended || call.state === 'ringing') return;
    const inv = call.invite; const target = call.remoteContact || inv.uri; const body = msg.body || '';
    const h = [`${msg.method} ${target} SIP/2.0`, `Via: SIP/2.0/UDP ${this.o.publicIp}:${this.o.port};branch=z9hG4bK${rnd(6)};rport`, 'Max-Forwards: 70',
      `From: ${inv.h('to').replace(/;tag=[^;]+/, '')};tag=${call.localTag}`, `To: ${inv.h('from')}`, `Call-ID: ${call.id}`, `CSeq: ${this._nextCseq(call)} ${msg.method}`,
      ...(msg.h('content-type') ? [`Content-Type: ${msg.h('content-type')}`] : []), 'User-Agent: PorteriaVirtual-SIP/1.0', `Content-Length: ${Buffer.byteLength(body)}`];
    this._send(h.join('\r\n') + '\r\n\r\n' + body, call.rinfo.address, call.rinfo.port);
  }

  _onInvite(msg, rinfo) {
    const callId = msg.h('call-id');
    const existe = this.calls.get(callId);
    if (existe) { // retransmisión
      if (existe.state === 'ringing') this._resp(msg, rinfo, 180, 'Ringing', { toTag: existe.localTag });
      else if (existe.answerSdp) this._resp(msg, rinfo, 200, 'OK', { toTag: existe.localTag, Contact: existe.contact, 'Content-Type': 'application/sdp' }, existe.answerSdp);
      return;
    }
    const user = userDe(msg.h('from'));
    const b = this.bindings.get(String(user));
    let acc = this.accounts.get(String(user));
    // Aceptamos sin reto si viene desde la misma dirección registrada; si no, se exige digest.
    if (!acc || !b || b.addr !== rinfo.address) { acc = this._auth(msg, rinfo, 'INVITE'); if (!acc) return; }
    const offer = this._parseSdp(msg.body);
    const pt = offer.audio && offer.audio.pts.includes(8) ? 8 : (offer.audio && offer.audio.pts.includes(0) ? 0 : null);
    if (pt === null) return this._resp(msg, rinfo, 488, 'Not Acceptable Here');
    const call = {
      id: callId, acc, invite: msg, rinfo, localTag: rnd(4), state: 'ringing', pt, offer, desde: Date.now(),
      contact: `<sip:pv@${this.o.publicIp}:${this.o.port}>`, remoteContact: (msg.h('contact').match(/<([^>]+)>/) || [])[1] || null,
      remoteTag: tagDe(msg.h('from')), cseq: 1, queue: new Int16Array(0), rtp: null, rtpRemote: offer.audio ? { addr: offer.audio.ip, port: offer.audio.port } : null, onAudio: null,
    };
    this.calls.set(callId, call);
    this._resp(msg, rinfo, 100, 'Trying');
    this._resp(msg, rinfo, 180, 'Ringing', { toTag: call.localTag });
    call.ringTimer = setInterval(() => { if (call.state === 'ringing') this._resp(msg, rinfo, 180, 'Ringing', { toTag: call.localTag }); }, 4000);
    this.emit('invite', call);
  }
  _parseSdp(sdp) {
    const out = { medias: [] }; let cIp = null; let cur = null;
    for (const l of String(sdp || '').split(/\r?\n/)) {
      if (l.startsWith('c=')) { const ip = l.split(' ')[2]; if (cur) cur.ip = ip; else cIp = ip; }
      if (l.startsWith('m=')) { const [kind, port, proto, ...pts] = l.slice(2).split(' '); cur = { kind, port: Number(port), proto, pts: pts.map(Number), ip: null }; out.medias.push(cur); }
    }
    for (const m of out.medias) m.ip = m.ip || cIp;
    out.audio = out.medias.find(m => m.kind === 'audio' && m.port > 0) || null;
    return out;
  }
  _abrirRtp() {
    for (let p = this.o.rtpPortMin; p <= this.o.rtpPortMax; p += 2) if (!this.usedRtp.has(p)) { this.usedRtp.add(p); return p; }
    throw new Error('sin puertos RTP libres');
  }

  /** Contesta la llamada: 200 OK con SDP y arranca el RTP. onAudio(Int16Array 8 kHz). */
  answer(call, onAudio) {
    return new Promise((resolve, reject) => {
      if (call.state !== 'ringing') return reject(new Error('la llamada ya no está sonando'));
      clearInterval(call.ringTimer);
      const port = this._abrirRtp(); call.rtpPort = port; call.onAudio = onAudio;
      const rtp = dgram.createSocket('udp4'); call.rtp = rtp;
      let latched = false;
      rtp.on('message', (pkt, r) => {
        if (pkt.length <= 12) return;
        if (!latched) { latched = true; call.rtpRemote = { addr: r.address, port: r.port }; }
        const pt = pkt[1] & 0x7f; if (pt !== call.pt) return;
        const cc = pkt[0] & 0x0f; const payload = pkt.subarray(12 + cc * 4);
        const pcm = new Int16Array(payload.length);
        for (let i = 0; i < payload.length; i++) pcm[i] = call.pt === 8 ? alawToLin(payload[i]) : ulawToLin(payload[i]);
        call.onAudio && call.onAudio(pcm);
      });
      rtp.bind(port, () => {
        const sdp = this._answerSdp(call, port); call.answerSdp = sdp;
        this._resp(call.invite, call.rinfo, 200, 'OK', { toTag: call.localTag, Contact: call.contact, 'Content-Type': 'application/sdp', Allow: 'INVITE, ACK, CANCEL, BYE, OPTIONS' }, sdp);
        call.state = 'answered'; call.answeredAt = Date.now();
        let n = 0; call.okTimer = setInterval(() => { if (call.state !== 'answered' || ++n > 6) return clearInterval(call.okTimer); this._resp(call.invite, call.rinfo, 200, 'OK', { toTag: call.localTag, Contact: call.contact, 'Content-Type': 'application/sdp' }, sdp); }, 500);
        const ssrc = crypto.randomBytes(4).readUInt32BE(0); let seq = 0, ts = 0; const silencio = call.pt === 8 ? 0xd5 : 0xff;
        call.txTimer = setInterval(() => {
          if (!call.rtpRemote || !call.rtpRemote.port) return;
          const pkt = Buffer.alloc(12 + 160);
          pkt[0] = 0x80; pkt[1] = call.pt; pkt.writeUInt16BE(seq++ & 0xffff, 2); pkt.writeUInt32BE(ts >>> 0, 4); pkt.writeUInt32BE(ssrc, 8); ts += 160;
          if (call.queue.length >= 160) { for (let i = 0; i < 160; i++) pkt[12 + i] = call.pt === 8 ? linToAlaw(call.queue[i]) : linToUlaw(call.queue[i]); call.queue = call.queue.slice(160); }
          else pkt.fill(silencio, 12);
          rtp.send(pkt, call.rtpRemote.port, call.rtpRemote.addr);
        }, 20);
        resolve(call);
      });
    });
  }
  _answerSdp(call, port) {
    const ip = this.o.publicIp; const sid = Date.now();
    const lines = ['v=0', `o=pv ${sid} ${sid} IN IP4 ${ip}`, 's=PorteriaVirtual', `c=IN IP4 ${ip}`, 't=0 0'];
    let audioHecho = false;
    for (const m of call.offer.medias) {
      if (m.kind === 'audio' && m.port > 0 && !audioHecho) {
        audioHecho = true;
        lines.push(`m=audio ${port} RTP/AVP ${call.pt}`, `a=rtpmap:${call.pt} ${call.pt === 8 ? 'PCMA' : 'PCMU'}/8000`, 'a=ptime:20', 'a=sendrecv');
      } else lines.push(`m=${m.kind} 0 ${m.proto} ${m.pts[0] ?? 0}`);
    }
    return lines.join('\r\n') + '\r\n';
  }
  /** Encola audio PCM16 8 kHz para enviar al equipo. call.maxQueue (muestras) limita la cola:
   *  1 s para un operador en vivo (latencia baja); la asistente sube el límite porque Gemini entrega
   *  el audio en ráfagas más rápidas que el tiempo real y recortar la cola le cortaba las frases. */
  send(call, pcm) {
    if (!call || call.ended) return;
    const all = new Int16Array(call.queue.length + pcm.length); all.set(call.queue); all.set(pcm, call.queue.length);
    const max = call.maxQueue || 8000;
    call.queue = all.length > max ? all.slice(all.length - max) : all;
  }
  flush(call) { if (call) call.queue = new Int16Array(0); }
  /** Corta: rechaza si está sonando, BYE si ya se contestó. */
  hangup(call, reason = 'colgado') {
    if (!call || call.ended) return;
    if (call.state === 'ringing') this._resp(call.invite, call.rinfo, 486, 'Busy Here', { toTag: call.localTag });
    else {
      const inv = call.invite; const target = call.remoteContact || inv.uri;
      const txt = [`BYE ${target} SIP/2.0`, `Via: SIP/2.0/UDP ${this.o.publicIp}:${this.o.port};branch=z9hG4bK${rnd(6)};rport`, 'Max-Forwards: 70',
        `From: ${inv.h('to').replace(/;tag=[^;]+/, '')};tag=${call.localTag}`, `To: ${inv.h('from')}`, `Call-ID: ${call.id}`, `CSeq: ${this._nextCseq(call)} BYE`,
        'User-Agent: PorteriaVirtual-SIP/1.0', 'Content-Length: 0', '', ''].join('\r\n');
      this._send(txt, call.rinfo.address, call.rinfo.port);
    }
    this._end(call, reason);
  }
  _end(call, reason) {
    if (call.ended) return; call.ended = true; call.state = 'ended';
    clearInterval(call.ringTimer); clearInterval(call.txTimer); clearInterval(call.okTimer);
    if (call.rtp) { try { call.rtp.close(); } catch { /* */ } this.usedRtp.delete(call.rtpPort); }
    if (call.forwardIn) call.forwardIn = null;
    this.calls.delete(call.id);
    this.emit('ended', call, reason);
  }
}

SipUas.parse = parse;
module.exports = { SipUas };
