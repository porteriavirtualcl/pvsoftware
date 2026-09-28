'use strict';
// Intercomunicador con controladores Dahua a través del MTS del DSS.
//  · Voz HACIA el equipo: sesión "talk" (MTS/Audio/StartTalk) → RTSP sin SDP; se envía RTP PCMA 8 kHz
//    en paquetes de 20 ms por el canal interleaved 0.
//  · Micrófono DEL equipo: stream en vivo (MTS/Video/StartVideo) → pista audio L16 16 kHz (PT 97).
//    Dahua manda L16 en little-endian (el estándar es big-endian).
// La URL del DSS trae dos direcciones separadas por "|" (interna | pública): se usa la pública.
const net = require('net');

const PRIVADA = /^(10|127|172\.(1[6-9]|2\d|3[01])|192\.168)\./;

function linToAlaw(s) {
  let sign = (s >> 8) & 0x80; if (sign) s = -s; if (s > 32635) s = 32635;
  let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1);
  const mant = (s >> (exp === 0 ? 4 : exp + 3)) & 0x0f;
  return ((sign | (exp << 4) | mant) ^ 0xd5) & 0xff;
}

function elegirUrl(url, dssHost) {
  const urls = String(url || '').split('|').map(x => x.trim()).filter(Boolean).map(x => new URL(x));
  const u = urls.find(x => !PRIVADA.test(x.hostname)) || urls[0];
  if (!u) throw new Error('URL RTSP vacía');
  return { u, host: PRIVADA.test(u.hostname) ? dssHost : u.hostname };
}

// Cliente RTSP mínimo sobre TCP con RTP interleaved.
class RtspTcp {
  constructor(name, url, token, dssHost, onRtp, log) {
    const { u, host } = elegirUrl(url, dssHost);
    this.name = name; this.log = log || (() => {});
    this.base = `rtsp://${u.hostname}:${u.port || 9100}${u.pathname}${u.search ? u.search + '&' : '?'}token=${token}`;
    this.sock = net.connect(Number(u.port || 9100), host);
    this.sock.setNoDelay(true);
    this.buf = Buffer.alloc(0); this.cseq = 1; this.session = null; this.pending = null;
    this.closed = false; this.onRtp = onRtp; this.onClose = null;
    this.sock.on('data', (c) => this._data(c));
    this.sock.on('error', (e) => this.log(`[${name}] socket error ${e.message}`));
    this.sock.on('close', () => { this.closed = true; if (this.pending) { const p = this.pending; this.pending = null; p({ head: 'CLOSED', body: '' }); } this.onClose && this.onClose(); });
  }
  req(method, url, extra = {}) {
    return new Promise((resolve) => {
      if (this.closed) return resolve({ head: 'CLOSED', body: '' });
      this.pending = resolve;
      const hdr = { CSeq: this.cseq++, 'User-Agent': 'PorteriaVirtual-Intercom/1.0', ...(this.session ? { Session: this.session } : {}), ...extra };
      this.sock.write(`${method} ${url} RTSP/1.0\r\n` + Object.entries(hdr).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      setTimeout(() => { if (this.pending === resolve) { this.pending = null; resolve({ head: 'TIMEOUT', body: '' }); } }, 25000);
    });
  }
  _data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length && this.buf[0] === 0x24) {
        if (this.buf.length < 4) return;
        const ch = this.buf[1], len = this.buf.readUInt16BE(2);
        if (this.buf.length < 4 + len) return;
        const pkt = this.buf.subarray(4, 4 + len); this.buf = this.buf.subarray(4 + len);
        if (this.onRtp) this.onRtp(ch, pkt);
        continue;
      }
      const end = this.buf.indexOf('\r\n\r\n'); if (end < 0) return;
      const head = this.buf.subarray(0, end).toString();
      const m = head.match(/Content-Length:\s*(\d+)/i); const cl = m ? Number(m[1]) : 0;
      if (this.buf.length < end + 4 + cl) return;
      const body = this.buf.subarray(end + 4, end + 4 + cl).toString(); this.buf = this.buf.subarray(end + 4 + cl);
      const s = head.match(/Session:\s*([^;\r\n]+)/i); if (s) this.session = s[1].trim();
      if (this.pending) { const p = this.pending; this.pending = null; p({ head, body }); }
    }
  }
  async negotiate() {
    let r = await this.req('OPTIONS', this.base);
    if (!/^RTSP\/1\.0 200/.test(r.head)) throw new Error(`[${this.name}] OPTIONS ${r.head.split('\r\n')[0]}`);
    r = await this.req('DESCRIBE', this.base, { Accept: 'application/sdp' });
    if (!/^RTSP\/1\.0 200/.test(r.head)) throw new Error(`[${this.name}] DESCRIBE ${r.head.split('\r\n')[0]}`);
    const sdp = r.body || '';
    const tracks = [...sdp.matchAll(/a=control:(trackID=\d+)/g)].map(x => x[1]);
    const media = [...sdp.matchAll(/m=(\w+) \d+ \S+ (\d+)/g)].map(x => {
      const pt = Number(x[2]); const rm = sdp.match(new RegExp(`a=rtpmap:${pt} ([\\w-]+)/(\\d+)`));
      return { kind: x[1], pt, codec: rm ? rm[1] : null, rate: Number(rm ? rm[2] : 8000) };
    });
    const setups = []; let chan = 0;
    for (const [i, t] of (tracks.length ? tracks : ['trackID=0']).entries()) {
      r = await this.req('SETUP', `${this.base}/${t}`, { Transport: `RTP/AVP/TCP;unicast;interleaved=${chan}-${chan + 1}` });
      if (!/^RTSP\/1\.0 200/.test(r.head)) throw new Error(`[${this.name}] SETUP ${t} ${r.head.split('\r\n')[0]}`);
      setups.push({ chan, ...(media[i] || {}) }); chan += 2;
    }
    r = await this.req('PLAY', this.base, { Range: 'npt=0.000-' });
    if (!/^RTSP\/1\.0 200/.test(r.head)) throw new Error(`[${this.name}] PLAY ${r.head.split('\r\n')[0]}`);
    this.setups = setups;
    this.keep = setInterval(() => { if (!this.closed) this.req('GET_PARAMETER', this.base).catch(() => {}); }, 20000);
    return setups;
  }
  close() {
    clearInterval(this.keep);
    if (this.closed) return;
    try { this.sock.write(`TEARDOWN ${this.base} RTSP/1.0\r\nCSeq: ${this.cseq++}\r\n${this.session ? `Session: ${this.session}\r\n` : ''}\r\n`); } catch { /* */ }
    setTimeout(() => { try { this.sock.destroy(); } catch { /* */ } }, 200);
  }
}

/**
 * Abre una conversación bidireccional con un equipo.
 * deps: { dssPost(path, body) → {body}, dssHost, log }
 * handlers: { onMic(Int16Array 16 kHz), onClose(reason) }
 * Devuelve { sendPcm8k(Int16Array), close(), info }.
 */
async function abrirConversacion(deviceCode, deps, handlers) {
  const { dssPost, dssHost, log } = deps;
  let mic = null, talk = null, talkSession = null, cerrada = false;
  const cerrar = async (reason) => {
    if (cerrada) return; cerrada = true;
    try { mic && mic.close(); } catch { /* */ }
    try { talk && talk.close(); } catch { /* */ }
    if (talkSession) {
      await dssPost('/brms/api/v1.0/MTS/Audio/StopTalk', {
        clientType: 'WINPC_V1', clientMac: '', clientPushId: '', project: 'PSDK', method: 'MTS.Audio.StopTalk',
        data: { optional: '/brms/api/v1.0/MTS/Audio/StopTalk', talkType: '1', deviceCode, session: talkSession, channelSeq: '0' },
      }).catch(() => {});
    }
    handlers.onClose && handlers.onClose(reason);
  };
  try {
    // 1) Micrófono del equipo (audio del stream en vivo).
    const lv = await dssPost('/brms/api/v1.0/MTS/Video/StartVideo', {
      clientType: 'WINPC_V2', clientMac: '', clientPushId: '', project: 'PSDK', method: 'MTS.Video.StartVideo',
      data: { streamType: '2', optional: '/brms/api/v1.0/MTS/Video/StartVideo', trackId: '', extend: '', channelId: `${deviceCode}$1$0$0`,
        keyCode: '', planId: '', dataType: '2', enableRtsps: '0', enableMulticast: '0' },
    });
    if (lv.body?.code !== 1000 || !lv.body.data?.url) throw new Error('StartVideo: ' + JSON.stringify(lv.body).slice(0, 160));
    let micSetups = [];
    mic = new RtspTcp('mic', lv.body.data.url, lv.body.data.token, dssHost, (ch, pkt) => {
      if (ch % 2 !== 0 || pkt.length <= 12) return;
      const s = micSetups.find(x => x.chan === ch); if (!s || s.kind !== 'audio') return;
      const pt = pkt[1] & 0x7f; if (pt !== s.pt) return;
      const cc = pkt[0] & 0x0f; const x = (pkt[0] & 0x10) ? 4 + pkt.readUInt16BE(12 + cc * 4 + 2) * 4 : 0;
      const payload = pkt.subarray(12 + cc * 4 + x);
      if (s.codec === 'L16') {
        const out = new Int16Array(payload.length >> 1);
        for (let i = 0; i < out.length; i++) out[i] = payload.readInt16LE(i * 2);
        handlers.onMic && handlers.onMic(out, s.rate);
      }
    }, log);
    mic.onClose = () => cerrar('mic cerrado');
    micSetups = await mic.negotiate();

    // 2) Voz hacia el equipo.
    const st = await dssPost('/brms/api/v1.0/MTS/Audio/StartTalk', {
      clientType: 'WINPC_V1', clientMac: '', clientPushId: '', project: 'PSDK', method: 'MTS.Audio.StartTalk',
      data: { optional: '/brms/api/v1.0/MTS/Audio/StartTalk', channelSeq: '0', broadcastChannels: '', deviceCode,
        talkType: '1', audioType: '2', talkMode: '', audioBit: '16', sampleRate: '8000', source: '', target: '' },
    });
    if (st.body?.code !== 1000 || !st.body.data?.url) throw new Error('StartTalk: ' + JSON.stringify(st.body).slice(0, 160));
    talkSession = st.body.data.session;
    talk = new RtspTcp('voz', st.body.data.url, st.body.data.token, dssHost, null, log);
    talk.onClose = () => cerrar('voz cerrada');
    const talkSetups = await talk.negotiate();
    const sendCh = talkSetups[0] ? talkSetups[0].chan : 0;

    const ssrc = (Math.random() * 0xffffffff) >>> 0; let seq = 0, ts = 0; let pend = new Int16Array(0);
    const sendPcm8k = (pcm) => {
      if (cerrada || talk.closed) return;
      const all = new Int16Array(pend.length + pcm.length); all.set(pend); all.set(pcm, pend.length);
      let off = 0;
      while (all.length - off >= 160) {
        const pkt = Buffer.alloc(12 + 160);
        pkt[0] = 0x80; pkt[1] = 8; pkt.writeUInt16BE(seq++ & 0xffff, 2); pkt.writeUInt32BE(ts >>> 0, 4); pkt.writeUInt32BE(ssrc, 8); ts += 160;
        for (let i = 0; i < 160; i++) pkt[12 + i] = linToAlaw(all[off + i]);
        off += 160;
        talk.sock.write(Buffer.concat([Buffer.from([0x24, sendCh, pkt.length >> 8, pkt.length & 0xff]), pkt]));
      }
      pend = all.slice(off);
    };
    return { sendPcm8k, close: cerrar, info: { deviceCode, talkSession, micRate: (micSetups.find(s => s.kind === 'audio') || {}).rate || 16000 } };
  } catch (e) {
    await cerrar('error: ' + e.message);
    throw e;
  }
}

module.exports = { abrirConversacion, linToAlaw };
