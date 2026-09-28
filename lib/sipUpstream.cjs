'use strict';
// Tramo hacia la central SIP del DSS ("SwitchCenter"), montado sobre el mismo socket de SipUas.
//  · Registro en el DSS a nombre del equipo (así el DSS lo ve "SIP en línea").
//  · Reenvío de la llamada del equipo al DSS (suena a los operadores), con digest, CANCEL, ACK y BYE.
//  · Audio: tramo RTP propio hacia el DSS, en PCM16 8 kHz hacia afuera (el puente lo hace server.cjs).
const dgram = require('dgram');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const rnd = (n = 6) => crypto.randomBytes(n).toString('hex');
const paramsDigest = (v) => { const o = {}; String(v).replace(/^Digest\s+/i, '').replace(/(\w+)=("([^"]*)"|[^,\s]+)/g, (_, k, _2, q) => { o[k.toLowerCase()] = q !== undefined ? q : _2; }); return o; };
const tagDe = (v) => (String(v).match(/;tag=([^;>\s]+)/) || [])[1] || null;

function linToAlaw(s) { let sign = (s >> 8) & 0x80; if (sign) s = -s; if (s > 32635) s = 32635; let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1); const mant = (s >> (exp === 0 ? 4 : exp + 3)) & 0x0f; return ((sign | (exp << 4) | mant) ^ 0xd5) & 0xff; }
function alawToLin(a) { a ^= 0x55; let t = (a & 0x0f) << 4; const seg = (a & 0x70) >> 4; if (seg === 0) t += 8; else if (seg === 1) t += 0x108; else { t += 0x108; t <<= seg - 1; } return (a & 0x80) ? t : -t; }
function linToUlaw(s) { const BIAS = 0x84; let sign = 0; if (s < 0) { s = -s; sign = 0x80; } if (s > 32635) s = 32635; s += BIAS; let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1); const mant = (s >> (exp + 3)) & 0x0f; return ~(sign | (exp << 4) | mant) & 0xff; }
function ulawToLin(u) { u = ~u & 0xff; const sign = u & 0x80, exp = (u >> 4) & 7, mant = u & 0x0f; let s = ((mant << 3) + 0x84) << exp; s -= 0x84; return sign ? -s : s; }

function autorizacion({ method, uri, user, pass, chal }) {
  const p = paramsDigest(chal); const realm = p.realm || ''; const nonce = p.nonce || '';
  const ha1 = md5(`${user}:${realm}:${pass}`), ha2 = md5(`${method}:${uri}`);
  const qop = p.qop ? String(p.qop).split(',').map(x => x.trim()).find(x => x === 'auth') : null;
  if (qop) {
    const nc = '00000001', cnonce = rnd(8);
    const resp = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}", algorithm=MD5, qop=auth, nc=${nc}, cnonce="${cnonce}"${p.opaque ? `, opaque="${p.opaque}"` : ''}`;
  }
  return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${md5(`${ha1}:${nonce}:${ha2}`)}", algorithm=MD5${p.opaque ? `, opaque="${p.opaque}"` : ''}`;
}

/** Instala en una SipUas el soporte de tramo hacia el DSS. cfg: { host, port, domain, pass } */
function instalarUpstream(uas, cfg) {
  cfg = cfg || null; // sin DSS: sólo sirve reenviarA() hacia estaciones registradas
  const o = uas.o; const log = (m) => o.log('[DSS] ' + m);
  uas.tx = uas.tx || new Map();
  uas.legs = uas.legs || new Map();
  uas.regs = new Map(); // user → estado de registro en el DSS

  const enviar = (txt, target) => uas._send(txt, target ? target.addr : cfg.host, target ? target.port : cfg.port);
  const request = ({ method, uri, callId, from, to, cseq, branch, extra = [], body = '', target }) => {
    const h = [`${method} ${uri} SIP/2.0`, `Via: SIP/2.0/UDP ${o.publicIp}:${o.port};branch=${branch};rport`, 'Max-Forwards: 70',
      `From: ${from}`, `To: ${to}`, `Call-ID: ${callId}`, `CSeq: ${cseq} ${method}`, ...extra, 'User-Agent: PorteriaVirtual-SIP/1.0', `Content-Length: ${Buffer.byteLength(body)}`];
    enviar(h.join('\r\n') + '\r\n\r\n' + body, target);
  };

  // Respuestas a nuestras peticiones hacia el DSS.
  const previo = uas._onResponse.bind(uas);
  uas._onResponse = (msg, rinfo) => {
    const cs = String(msg.h('cseq')).split(/\s+/); const key = `${msg.h('call-id')}|${cs[0]}|${String(cs[1] || '').toUpperCase()}`;
    const fn = uas.tx.get(key); if (fn) return fn(msg, rinfo);
    const leg = uas.legs.get(msg.h('call-id'));
    if (leg && msg.status === 200 && /INVITE/i.test(cs[1] || '')) return leg._ack200(msg); // 200 retransmitido
    return previo(msg, rinfo);
  };
  // Peticiones del DSS dentro de un diálogo nuestro (BYE, re-INVITE, INFO...), o llamadas del DSS al equipo.
  const onMsgPrev = uas._onMsg.bind(uas);
  uas._onMsg = (buf, rinfo) => {
    if (buf.length < 8) return;
    const { parse } = uas.constructor; const msg = parse(buf);
    if (cfg && msg.method && rinfo.address === cfg.host) {
      const leg = uas.legs.get(msg.h('call-id'));
      if (leg) {
        if (msg.method === 'ACK') return;
        if (msg.method === 'BYE') { uas._resp(msg, rinfo, 200, 'OK'); return leg._fin('el operador del DSS cortó', true); }
        if (msg.method === 'INVITE') return uas._resp(msg, rinfo, 200, 'OK', { Contact: `<sip:${leg.user}@${o.publicIp}:${o.port}>`, 'Content-Type': 'application/sdp' }, leg.sdpOferta);
        return uas._resp(msg, rinfo, 200, 'OK');
      }
      if (msg.method === 'OPTIONS') return uas._resp(msg, rinfo, 200, 'OK');
      if (msg.method === 'INVITE') { // el DSS llama al equipo (operador → equipo): aún no soportado por esta vía
        uas._resp(msg, rinfo, 100, 'Trying');
        return uas.emit('dss_invite', msg, rinfo);
      }
      if (msg.method === 'NOTIFY' || msg.method === 'MESSAGE' || msg.method === 'INFO') return uas._resp(msg, rinfo, 200, 'OK');
    }
    return onMsgPrev(buf, rinfo);
  };

  /** Mantiene al usuario registrado en el DSS (refresco automático). */
  uas.registrarEnDss = (user, activo) => {
    if (!cfg) return null;
    if (uas.regs.has(String(user)) && uas.regs.get(String(user)).vivo) return uas.regs.get(String(user));
    const st = { user, callId: `reg-${rnd(8)}@${o.publicIp}`, tag: rnd(4), cseq: 1, ok: false, ultimo: null, timer: null, vivo: true };
    uas.regs.set(String(user), st);
    const uri = `sip:${cfg.domain}`;
    const enviarReg = (auth, baja) => {
      // Si el equipo ya no está conectado a la central, se da de baja en el DSS (no mostrarlo en línea).
      if (!baja && activo && !activo()) {
        log(`${user} ya no está conectado a la central: se da de baja en el DSS`);
        st.vivo = false; st.ok = false; clearTimeout(st.timer); clearInterval(st.intervalo); uas.regs.delete(String(user));
        return enviarReg(null, true);
      }
      const cseq = st.cseq++; const branch = 'z9hG4bK' + rnd(6);
      uas.tx.set(`${st.callId}|${cseq}|REGISTER`, (m) => {
        uas.tx.delete(`${st.callId}|${cseq}|REGISTER`);
        if ((m.status === 401 || m.status === 407) && !auth) {
          const chal = m.h('www-authenticate') || m.h('proxy-authenticate');
          return enviarReg({ hdr: m.status === 401 ? 'Authorization' : 'Proxy-Authorization', val: autorizacion({ method: 'REGISTER', uri, user, pass: cfg.pass, chal }) }, baja);
        }
        if (m.status === 200 && baja) { log(`baja de ${user} en el DSS confirmada`); return; }
        if (m.status === 200) {
          const exp = Number((m.h('contact').match(/expires=(\d+)/) || [])[1] || m.h('expires') || 120);
          if (!st.ok) log(`registrado ${user} en el DSS (expira ${exp} s)`);
          st.ok = true; st.ultimo = Date.now(); st.sinRespuesta = 0; st.exp = exp;
        } else if (m.status >= 300) {
          if (st.ok || !st.falloLog) log(`registro ${user} rechazado por el DSS: ${m.status}`);
          st.ok = false; st.falloLog = true;
        }
      });
      // Vigía: si el DSS no contesta en 4 s (UDP perdido), se cuenta y se reintenta en el próximo ciclo.
      setTimeout(() => { if (uas.tx.has(`${st.callId}|${cseq}|REGISTER`)) { uas.tx.delete(`${st.callId}|${cseq}|REGISTER`); st.sinRespuesta = (st.sinRespuesta || 0) + 1; if (st.sinRespuesta === 1 || st.sinRespuesta % 20 === 0) log(`el DSS no respondió al registro de ${user} (${st.sinRespuesta} seguidos)`); } }, 4000);
      request({ method: 'REGISTER', uri, callId: st.callId, from: `<sip:${user}@${cfg.domain}>;tag=${st.tag}`, to: `<sip:${user}@${cfg.domain}>`, cseq, branch,
        extra: [`Contact: <sip:${user}@${o.publicIp}:${o.port}>`, `Expires: ${baja ? 0 : 120}`, ...(auth ? [`${auth.hdr}: ${auth.val}`] : [])] });
    };
    enviarReg();
    // Renovación PERIÓDICA e independiente de las respuestas: antes se programaba al recibir el 200 y
    // un solo paquete UDP perdido cortaba la cadena para siempre (el DSS marcaba el equipo fuera de línea).
    st.intervalo = setInterval(() => { if (st.vivo) enviarReg(); }, 25000);
    return st;
  };
  uas.estadoDss = () => [...uas.regs.values()].map(s => ({ user: s.user, registrado: s.ok, ultimo: s.ultimo }));

  /**
   * Reenvía al DSS la llamada entrante `call` (del equipo). Devuelve un EventEmitter con eventos
   * 'ringing', 'answered', 'failed'(código), 'ended'(motivo) y métodos send(pcm), cancel(), bye().
   */
  // target opcional: { addr, port, uri, domain } → llamar a un equipo/estación registrado en NUESTRA central
  // (audio decodificado, sin video), p. ej. para pasar la llamada de la asistente a un VTS.
  uas.reenviarAlDss = (call, destino, target) => {
    if (!cfg && !target) throw new Error('sin DSS configurado');
    const leg = new EventEmitter();
    const user = String(call.acc.upstreamUser || call.acc.user);
    const dom = target ? (target.domain || o.realm) : cfg.domain;
    const hostMedia = target ? target.addr : cfg.host;
    const pt = call.pt;
    Object.assign(leg, { user, target, callId: `${rnd(8)}@${o.publicIp}`, fromTag: rnd(4), cseq: 1, branch: null, estado: 'llamando', toHeader: `<sip:${destino}@${dom}>`,
      uri: target && target.uri ? target.uri : `sip:${destino}@${dom}`, remoteTarget: null, remoteRtp: null, queue: new Int16Array(0), onAudio: null });
    const rtpPort = uas._abrirRtp(); const rtp = dgram.createSocket('udp4'); leg.rtpPort = rtpPort;
    let latched = false;
    rtp.on('message', (pkt, r) => {
      if (pkt.length <= 12) return;
      if (!latched) { latched = true; leg.remoteRtp = { addr: r.address, port: r.port }; }
      if ((pkt[1] & 0x7f) !== pt) return;
      const cc = pkt[0] & 0x0f; const pl = pkt.subarray(12 + cc * 4); const pcm = new Int16Array(pl.length);
      for (let i = 0; i < pl.length; i++) pcm[i] = pt === 8 ? alawToLin(pl[i]) : ulawToLin(pl[i]);
      leg.onAudio && leg.onAudio(pcm);
    });
    rtp.bind(rtpPort);
    const sid = Date.now();
    leg.sdpOferta = ['v=0', `o=pv ${sid} ${sid} IN IP4 ${o.publicIp}`, 's=PorteriaVirtual', `c=IN IP4 ${o.publicIp}`, 't=0 0',
      `m=audio ${rtpPort} RTP/AVP ${pt}`, `a=rtpmap:${pt} ${pt === 8 ? 'PCMA' : 'PCMU'}/8000`, 'a=ptime:20', 'a=sendrecv'].join('\r\n') + '\r\n';
    const from = () => `<sip:${user}@${dom}>;tag=${leg.fromTag}`;
    const ackNo2xx = (m) => request({ method: 'ACK', uri: leg.uri, callId: leg.callId, from: from(), to: m.h('to'), cseq: String(m.h('cseq')).split(/\s+/)[0], branch: leg.branch, target });
    const invitar = (auth) => {
      const cseq = leg.cseq++; leg.branch = 'z9hG4bK' + rnd(6); leg.inviteCseq = cseq;
      uas.tx.set(`${leg.callId}|${cseq}|INVITE`, (m) => {
        if (m.status < 200) { if ((m.status === 180 || m.status === 183) && leg.estado === 'llamando') { leg.estado = 'sonando'; leg.emit('ringing'); } return; }
        uas.tx.delete(`${leg.callId}|${cseq}|INVITE`);
        if (m.status === 200) return leg._ack200(m);
        ackNo2xx(m);
        if ((m.status === 401 || m.status === 407) && !auth && cfg && !target) {
          const chal = m.h('www-authenticate') || m.h('proxy-authenticate');
          return invitar({ hdr: m.status === 401 ? 'Authorization' : 'Proxy-Authorization', val: autorizacion({ method: 'INVITE', uri: leg.uri, user, pass: cfg.pass, chal }) });
        }
        if (leg.estado === 'cancelando') return leg._fin('cancelado', false);
        log(`llamada ${user} → ${destino} rechazada por ${target ? 'la estación' : 'el DSS'}: ${m.status} ${m.h('reason') || ''}`);
        leg.emit('failed', m.status); leg._fin(`rechazada por el DSS (${m.status})`, false);
      });
      leg._auth = auth;
      request({ method: 'INVITE', uri: leg.uri, callId: leg.callId, from: from(), to: leg.toHeader, cseq, branch: leg.branch,
        extra: [`Contact: <sip:${user}@${o.publicIp}:${o.port}>`, 'Content-Type: application/sdp', 'Allow: INVITE, ACK, CANCEL, BYE, OPTIONS', ...(auth ? [`${auth.hdr}: ${auth.val}`] : [])], body: leg.sdpOferta, target });
    };
    leg._ack200 = (m) => {
      leg.toHeader = m.h('to'); leg.remoteTarget = (m.h('contact').match(/<([^>]+)>/) || [])[1] || leg.uri;
      request({ method: 'ACK', uri: leg.remoteTarget, callId: leg.callId, from: from(), to: leg.toHeader, cseq: String(m.h('cseq')).split(/\s+/)[0], branch: 'z9hG4bK' + rnd(6) , target });
      if (leg.estado === 'cancelando') { leg.bye(); return; }
      if (leg.estado === 'contestada') return;
      leg.estado = 'contestada';
      const sdp = m.body || ''; const ip = (sdp.match(/c=IN IP4 (\S+)/) || [])[1]; const port = Number((sdp.match(/m=audio (\d+)/) || [])[1] || 0);
      if (!latched && ip && port) leg.remoteRtp = { addr: /^(10|127|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(ip) ? hostMedia : ip, port };
      const ssrc = crypto.randomBytes(4).readUInt32BE(0); let seq = 0, ts = 0; const silencio = pt === 8 ? 0xd5 : 0xff;
      leg.txTimer = setInterval(() => {
        if (!leg.remoteRtp) return;
        const pkt = Buffer.alloc(172); pkt[0] = 0x80; pkt[1] = pt; pkt.writeUInt16BE(seq++ & 0xffff, 2); pkt.writeUInt32BE(ts >>> 0, 4); pkt.writeUInt32BE(ssrc, 8); ts += 160;
        if (leg.queue.length >= 160) { for (let i = 0; i < 160; i++) pkt[12 + i] = pt === 8 ? linToAlaw(leg.queue[i]) : linToUlaw(leg.queue[i]); leg.queue = leg.queue.slice(160); } else pkt.fill(silencio, 12);
        rtp.send(pkt, leg.remoteRtp.port, leg.remoteRtp.addr);
      }, 20);
      log(`${target ? "la estación " + destino + " contestó" : "operador del DSS contestó"} la llamada de ${user} (SDP ${ip}:${port})`);
      leg.emit('answered');
    };
    leg.send = (pcm) => { if (leg.estado !== 'contestada') return; const all = new Int16Array(leg.queue.length + pcm.length); all.set(leg.queue); all.set(pcm, leg.queue.length); leg.queue = all.length > 8000 ? all.slice(all.length - 8000) : all; };
    leg.cancel = () => {
      if (leg.estado !== 'llamando' && leg.estado !== 'sonando') return;
      leg.estado = 'cancelando';
      request({ method: 'CANCEL', uri: leg.uri, callId: leg.callId, from: from(), to: `<sip:${destino}@${dom}>`, cseq: leg.inviteCseq, branch: leg.branch,
        extra: leg._auth ? [`${leg._auth.hdr}: ${leg._auth.val}`] : [] , target });
      setTimeout(() => leg._fin('cancelado', false), 4000); // por si el DSS no confirma
    };
    leg.bye = () => {
      if (leg.cerrada) return;
      const cseq = leg.cseq++;
      request({ method: 'BYE', uri: leg.remoteTarget || leg.uri, callId: leg.callId, from: from(), to: leg.toHeader, cseq, branch: 'z9hG4bK' + rnd(6) , target });
      leg._fin('colgado', false);
    };
    // Peticiones dentro del diálogo desde el destino (BYE, re-INVITE, INFO…) — vía genérica de sipUas.
    leg.onRequest = (msg, rinfo) => {
      if (msg.method === 'ACK') return;
      if (msg.method === 'BYE') { uas._resp(msg, rinfo, 200, 'OK'); return leg._fin('el otro extremo cortó', true); }
      if (msg.method === 'INVITE') return uas._resp(msg, rinfo, 200, 'OK', { Contact: `<sip:${leg.user}@${o.publicIp}:${o.port}>`, 'Content-Type': 'application/sdp' }, leg.sdpOferta);
      uas._resp(msg, rinfo, 200, 'OK');
      if ((msg.method === 'INFO' || msg.method === 'MESSAGE') && uas.forwardToCall) uas.forwardToCall(call, msg); // apertura de puerta desde el VTS → controlador
    };
    leg._fin = (motivo, remoto) => {
      if (leg.cerrada) return; leg.cerrada = true; leg.estado = 'terminada';
      clearInterval(leg.txTimer); try { rtp.close(); } catch { /* */ } uas.usedRtp.delete(rtpPort);
      setTimeout(() => uas.legs.delete(leg.callId), 30000);
      leg.emit('ended', motivo, remoto);
    };
    uas.legs.set(leg.callId, leg);
    invitar(null);
    return leg;
  };
}

module.exports = { instalarUpstream };
