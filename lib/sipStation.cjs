'use strict';
// Llamadas hacia las estaciones de operador (VTS Dahua u otro teléfono SIP) registradas en NUESTRA
// central, sin pasar por el DSS. La central hace de puente: recibe la llamada del controlador y
// llama a los VTS; el primero que contesta se queda con la llamada. Los medios (audio Y video) se
// RELEVAN paquete a paquete sin decodificar: ambos extremos son Dahua (G.711 / H.264).
// Los dos extremos están tras NAT: cada flujo se "engancha" a la dirección de donde llega el primer
// paquete de cada lado; como pista inicial se usa la IP de señalización + el puerto del SDP.
const dgram = require('dgram');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const rnd = (n = 6) => crypto.randomBytes(n).toString('hex');
const tagDe = (v) => (String(v).match(/;tag=([^;>\s]+)/) || [])[1] || null;

/** Reescribe un SDP: c= a nuestra IP y cada m= al puerto del relay correspondiente. */
function reescribirSdp(sdp, ip, puertos) {
  let i = -1;
  return String(sdp || '').split(/\r?\n/).filter(l => l.length).map((l) => {
    if (l.startsWith('c=')) return `c=IN IP4 ${ip}`;
    if (l.startsWith('o=')) return l.replace(/IN IP4 \S+/, `IN IP4 ${ip}`);
    if (l.startsWith('m=')) { i++; const p = l.split(' '); if (Number(p[1]) > 0 && puertos[i]) p[1] = String(puertos[i]); return p.join(' '); }
    return l;
  }).join('\r\n') + '\r\n';
}
function mediasDe(sdp) {
  const out = []; let cIp = null; let cur = null;
  for (const l of String(sdp || '').split(/\r?\n/)) {
    if (l.startsWith('c=')) { const ip = l.split(' ')[2]; if (cur) cur.ip = ip; else cIp = ip; }
    if (l.startsWith('m=')) { const p = l.slice(2).split(' '); cur = { kind: p[0], port: Number(p[1]), ip: null }; out.push(cur); }
  }
  for (const m of out) m.ip = m.ip || cIp;
  return out;
}

/** Relay UDP de un flujo entre el lado A (controlador) y el lado B (VTS). */
class Relay {
  constructor(port, ladoA, ladoB, log) {
    this.port = port; this.a = { ...ladoA, latched: false }; this.b = { ...ladoB, latched: false }; this.log = log; this.n = { a: 0, b: 0 };
    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (pkt, r) => this._onPkt(pkt, r));
    this.sock.on('error', () => {});
    this.sock.bind(port);
  }
  _lado(r) {
    const es = (l) => l.latched && l.addr === r.address && l.port === r.port;
    if (es(this.a)) return 'a'; if (es(this.b)) return 'b';
    // Enganche: pista exacta (IP de señalización + puerto SDP) primero; luego por IP; luego el que falte.
    const pista = (l) => !l.latched && l.hintAddr === r.address && l.hintPort === r.port;
    if (pista(this.a)) return this._latch('a', r); if (pista(this.b)) return this._latch('b', r);
    const porIp = (l) => !l.latched && l.hintAddr === r.address;
    if (porIp(this.a) && !porIp(this.b)) return this._latch('a', r); if (porIp(this.b) && !porIp(this.a)) return this._latch('b', r);
    if (!this.a.latched && this.b.latched) return this._latch('a', r); if (!this.b.latched && this.a.latched) return this._latch('b', r);
    if (!this.a.latched) return this._latch('a', r);
    return null;
  }
  _latch(k, r) { const l = this[k]; l.latched = true; l.addr = r.address; l.port = r.port; this.log(`relay :${this.port} lado ${k.toUpperCase()} = ${r.address}:${r.port}`); return k; }
  _onPkt(pkt, r) {
    const k = this._lado(r); if (!k) return;
    const dest = k === 'a' ? this.b : this.a;
    const addr = dest.latched ? dest.addr : dest.hintAddr, port = dest.latched ? dest.port : dest.hintPort;
    if (!addr || !port) return;
    this.n[k]++;
    this.sock.send(pkt, port, addr);
  }
  close() { try { this.sock.close(); } catch { /* */ } }
}

/**
 * Instala en la SipUas la llamada hacia estaciones registradas.
 *   uas.llamarEstaciones(call, users, { log }) → EventEmitter: 'ringing'(user), 'answered'(user), 'failed'(motivo), 'ended'(motivo)
 *   métodos: cancelAll(), bye(), relays (estadísticas)
 */
function instalarEstaciones(uas) {
  const o = uas.o;
  uas.llamarEstaciones = (call, users, opts = {}) => {
    const log = opts.log || o.log;
    const ring = new EventEmitter();
    const legs = []; let ganador = null; let terminado = false;
    const mediasCtrl = mediasDe(call.invite.body);
    const cerrar = (motivo) => {
      if (terminado) return; terminado = true;
      for (const l of legs) { if (l.estado === 'contestada' && l === ganador) l.bye(); else if (l.estado !== 'terminada') l.cancel(); }
      if (ganador) { for (const r of ganador.relays) r.close(); for (const p of ganador.puertos) uas.usedRtp.delete(p); }
      ring.emit('ended', motivo);
    };
    for (const user of users) {
      const b = uas.bindings.get(String(user)); if (!b || b.expires < Date.now()) continue;
      const leg = { user, b, callId: `${rnd(8)}@${o.publicIp}`, fromTag: rnd(4), cseq: 1, estado: 'llamando', puertos: [], relays: [], toHeader: null, remoteTarget: null, inviteCseq: 0, branch: null };
      // Puertos de relay: uno por m-line activa del controlador.
      for (const m of mediasCtrl) leg.puertos.push(m.port > 0 ? uas._abrirRtp() : 0);
      const uri = (String(b.contact).match(/<([^>]+)>/) || [])[1] || `sip:${user}@${b.addr}:${b.port}`;
      leg.uri = uri;
      const from = () => `<sip:${call.acc.user}@${o.realm}>;tag=${leg.fromTag}`;
      const req = (method, target, extra = [], body = '', cseq, branch) => {
        const h = [`${method} ${target} SIP/2.0`, `Via: SIP/2.0/UDP ${o.publicIp}:${o.port};branch=${branch};rport`, 'Max-Forwards: 70', `From: ${from()}`,
          `To: ${leg.toHeader || `<sip:${user}@${o.realm}>`}`, `Call-ID: ${leg.callId}`, `CSeq: ${cseq} ${method}`, `Contact: <sip:${call.acc.user}@${o.publicIp}:${o.port}>`, ...extra,
          'User-Agent: PorteriaVirtual-SIP/1.0', `Content-Length: ${Buffer.byteLength(body)}`];
        uas._send(h.join('\r\n') + '\r\n\r\n' + body, b.addr, b.port);
      };
      leg.sdpOferta = reescribirSdp(call.invite.body, o.publicIp, leg.puertos);
      const invitar = () => {
        const cseq = leg.cseq++; leg.inviteCseq = cseq; leg.branch = 'z9hG4bK' + rnd(6);
        uas.tx.set(`${leg.callId}|${cseq}|INVITE`, (m) => {
          if (m.status < 200) { if (m.status >= 180 && leg.estado === 'llamando') { leg.estado = 'sonando'; ring.emit('ringing', user); } return; }
          uas.tx.delete(`${leg.callId}|${cseq}|INVITE`);
          leg.toHeader = m.h('to');
          if (m.status === 200) {
            leg.remoteTarget = (m.h('contact').match(/<([^>]+)>/) || [])[1] || uri;
            req('ACK', leg.remoteTarget, [], '', cseq, 'z9hG4bK' + rnd(6));
            if (ganador || terminado || call.state !== 'ringing') { leg.bye(); return; }
            ganador = leg; leg.estado = 'contestada';
            // Relays: lado A = controlador (pista: IP de señalización + puerto SDP), lado B = VTS.
            const mediasVts = mediasDe(m.body);
            mediasCtrl.forEach((mc, i) => {
              if (!(mc.port > 0) || !leg.puertos[i]) return;
              const mv = mediasVts[i] || {};
              leg.relays.push(new Relay(leg.puertos[i], { hintAddr: call.rinfo.address, hintPort: mc.port }, { hintAddr: b.addr, hintPort: mv.port || 0 }, log));
            });
            // Respuesta al controlador: el SDP del VTS con nuestra IP y nuestros puertos.
            const sdpCtrl = reescribirSdp(m.body, o.publicIp, leg.puertos);
            uas.answerRelay(call, sdpCtrl);
            for (const l of legs) if (l !== leg && l.estado !== 'terminada') l.cancel();
            log(`VTS ${user} contestó la llamada de ${call.acc.deviceName || call.acc.user}`);
            ring.emit('answered', user);
            return;
          }
          if (leg.estado === 'cancelando') { leg._fin(); return; }
          req('ACK', uri, [], '', cseq, leg.branch);
          leg._fin(); log(`VTS ${user} rechazó/no disponible: ${m.status}`);
          if (legs.every(l => l.estado === 'terminada') && !ganador) { ring.emit('failed', `sin respuesta de las estaciones (${m.status})`); cerrar('falló'); }
        });
        req('INVITE', uri, ['Content-Type: application/sdp', 'Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, MESSAGE'], leg.sdpOferta, cseq, leg.branch);
      };
      leg.cancel = () => {
        if (leg.estado !== 'llamando' && leg.estado !== 'sonando') return;
        leg.estado = 'cancelando';
        const h = [`CANCEL ${uri} SIP/2.0`, `Via: SIP/2.0/UDP ${o.publicIp}:${o.port};branch=${leg.branch};rport`, 'Max-Forwards: 70', `From: ${from()}`, `To: <sip:${user}@${o.realm}>`,
          `Call-ID: ${leg.callId}`, `CSeq: ${leg.inviteCseq} CANCEL`, 'Content-Length: 0'];
        uas._send(h.join('\r\n') + '\r\n\r\n', b.addr, b.port);
        setTimeout(() => leg._fin(), 3000);
      };
      leg.bye = () => { if (leg.estado === 'terminada') return; req('BYE', leg.remoteTarget || uri, [], '', leg.cseq++, 'z9hG4bK' + rnd(6)); leg._fin(); };
      // Peticiones dentro del diálogo desde el VTS (BYE, INFO de apertura, re-INVITE…).
      leg.onRequest = (msg, rinfo) => {
        if (msg.method === 'ACK') return;
        if (msg.method === 'BYE') { uas._resp(msg, rinfo, 200, 'OK'); leg._fin(); if (ganador === leg) cerrar('el operador del VTS cortó'); return; }
        if (msg.method === 'INVITE') { uas._resp(msg, rinfo, 200, 'OK', { Contact: `<sip:${call.acc.user}@${o.publicIp}:${o.port}>`, 'Content-Type': 'application/sdp' }, leg.sdpOferta); return; }
        uas._resp(msg, rinfo, 200, 'OK');
        if (msg.method === 'INFO' || msg.method === 'MESSAGE') {
          log(`VTS ${user} → ${msg.method} (${msg.h('content-type') || 'sin tipo'}): ${String(msg.body || '').replace(/\s+/g, ' ').slice(0, 160)}`);
          ring.emit('inrequest', user, msg);
          // Se reenvía tal cual al controlador (así funciona "abrir" desde el VTS con el protocolo Dahua).
          uas.forwardToCall(call, msg);
        }
      };
      leg._fin = () => { if (leg.estado === 'terminada') return; leg.estado = 'terminada'; setTimeout(() => uas.legs.delete(leg.callId), 30000); if (ganador !== leg) for (const p of leg.puertos) if (p) uas.usedRtp.delete(p); };
      uas.legs.set(leg.callId, leg);
      legs.push(leg);
      invitar();
    }
    if (!legs.length) { setTimeout(() => { ring.emit('failed', 'ninguna estación registrada'); cerrar('sin estaciones'); }, 0); }
    ring.cancelAll = () => { for (const l of legs) l.cancel(); if (!ganador) cerrar('cancelada'); };
    ring.bye = () => cerrar('colgada');
    ring.ganador = () => ganador;
    ring.estadisticas = () => (ganador ? ganador.relays.map(r => ({ puerto: r.port, aB: r.n.a, bA: r.n.b, A: r.a.latched ? `${r.a.addr}:${r.a.port}` : '-', B: r.b.latched ? `${r.b.addr}:${r.b.port}` : '-' })) : []);
    return ring;
  };
}

module.exports = { instalarEstaciones, reescribirSdp, mediasDe };
