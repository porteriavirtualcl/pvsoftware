'use strict';
// Cliente de Shelly Cloud para el módulo Iluminación y Alertas.
// Portado de Facturación MB (server/src/shelly/client.ts): misma API v2, mismos límites.
//   - Shelly Cloud admite ~1 petición por segundo por cuenta: los lotes van de 10 en 10
//     con 1,1 s entre ellos y todo el módulo comparte esta cadencia.
//   - Los ids con sufijo "_N" (p. ej. 10061cc9e520_1) son el canal N de un equipo
//     multicanal: el status se pide por el id base y se lee "switch:N".
// Configuración: SHELLY_HOST (p. ej. shelly-73-eu.shelly.cloud) y SHELLY_AUTH_KEY.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cfg() {
  return {
    host: String(process.env.SHELLY_HOST || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
    key:  String(process.env.SHELLY_AUTH_KEY || '').trim(),
  };
}
const configured = () => { const c = cfg(); return !!(c.host && c.key); };

/** "10061cc9e520_1" → { baseId: "10061cc9e520", channel: 1 } */
function splitId(shellyId) {
  const m = /^(.+?)(?:_(\d+))?$/.exec(String(shellyId || ''));
  return { baseId: m ? m[1] : String(shellyId), channel: m && m[2] ? Number(m[2]) : 0 };
}

async function llamar(path, { method = 'GET', json, form } = {}, intentos = 3) {
  const { host, key } = cfg();
  if (!host || !key) throw new Error('Shelly no configurado (SHELLY_HOST / SHELLY_AUTH_KEY)');
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://${host}${path}${sep}auth_key=${encodeURIComponent(key)}`;
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const init = { method, headers: {} };
      if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
      if (form) { init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000); init.signal = ctl.signal;
      const res = await fetch(url, init).finally(() => clearTimeout(t));
      const text = await res.text();
      let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (res.status === 401 || res.status === 403) {
        // 401 también es "Request limit reached!" → esperar y reintentar; auth mala → cortar.
        const msg = JSON.stringify(data?.errors || data || '');
        if (/limit/i.test(msg)) { ultimo = new Error('Shelly: límite de peticiones'); await sleep(1500 * (i + 1)); continue; }
        throw new Error(`Shelly rechazó la autenticación (HTTP ${res.status}). Revisa SHELLY_AUTH_KEY.`);
      }
      if (!res.ok) { ultimo = new Error(`Shelly HTTP ${res.status}: ${text.slice(0, 200)}`); await sleep(1000 * 2 ** i); continue; }
      if (data && data.isok === false) throw new Error(`Shelly: ${JSON.stringify(data.errors || data).slice(0, 300)}`);
      return data;
    } catch (e) {
      if (/autenticación|Shelly:/.test(e.message)) throw e;
      ultimo = e; await sleep(1000 * 2 ** i);
    }
  }
  throw ultimo || new Error('Shelly: sin respuesta');
}

/** Todos los equipos de la cuenta: [{ id, name, type, gen, category, roomId, online, channel, channelsCount }] */
async function listDevices() {
  const data = await llamar('/interface/device/list', { method: 'POST' });
  const devices = Object.values(data?.data?.devices || {});
  return devices.map(d => ({
    id: String(d.id), name: String(d.name || ''), type: String(d.type || ''), gen: Number(d.gen || 0),
    category: String(d.category || ''), roomId: d.room_id != null ? String(d.room_id) : '',
    online: typeof d.cloud_online === 'boolean' ? d.cloud_online : null,
    channel: Number(d.channel || 0), channelsCount: Number(d.channels_count || 1),
  }));
}

/** Salas (pestañas del panel de Shelly): { "15": "Quillay", ... } */
async function listRooms() {
  const data = await llamar('/interface/room/list', { method: 'POST' });
  const out = {};
  for (const [id, r] of Object.entries(data?.data?.rooms || {})) out[String(id)] = String(r?.name || id);
  return out;
}

/**
 * Status crudo de hasta N equipos (por id BASE). Lotes de 10 con 1,1 s entre ellos.
 * Devuelve Map baseId → { online, status } (status null si no vino).
 */
async function getStatuses(baseIds) {
  const ids = [...new Set(baseIds.filter(Boolean).map(String))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 10) {
    const lote = ids.slice(i, i + 10);
    if (i > 0) await sleep(1100);
    const data = await llamar('/v2/devices/api/get', { method: 'POST', json: { ids: lote, select: ['status'] } });
    const items = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data.data ?? data) : []);
    for (const it of items) {
      const id = String(it?.id ?? it?._dev_info?.id ?? '');
      if (!id) continue;
      out.set(id, { online: it.online !== false && it.online !== 0, status: it.status ?? it });
    }
    for (const id of lote) if (!out.has(id)) out.set(id, { online: false, status: null });
  }
  return out;
}

/**
 * Lee el canal de un relé del status crudo (Gen2/3/4: "switch:N"; Gen1: relays[N]+meters[N]).
 * → { on, apower, voltage, current, temperature, energyWh } (null cuando el equipo no lo reporta)
 */
function parseSwitch(status, channel = 0) {
  const out = { on: null, apower: null, voltage: null, current: null, temperature: null, energyWh: null };
  if (!status || typeof status !== 'object') return out;
  const sw = status[`switch:${channel}`] || status[`light:${channel}`];
  if (sw && typeof sw === 'object') {
    if (typeof sw.output === 'boolean') out.on = sw.output;
    if (typeof sw.apower === 'number') out.apower = sw.apower;
    if (typeof sw.voltage === 'number') out.voltage = sw.voltage;
    if (typeof sw.current === 'number') out.current = sw.current;
    if (sw.temperature && typeof sw.temperature.tC === 'number') out.temperature = sw.temperature.tC;
    if (sw.aenergy && typeof sw.aenergy.total === 'number') out.energyWh = sw.aenergy.total;
    return out;
  }
  if (Array.isArray(status.relays) && status.relays[channel]) {
    const r = status.relays[channel];
    if (typeof r.ison === 'boolean') out.on = r.ison;
    const m = Array.isArray(status.meters) ? status.meters[channel] : null;
    if (m && typeof m.power === 'number') out.apower = m.power;
    if (m && typeof m.total === 'number') out.energyWh = m.total / 60;
    if (status.temperature != null && typeof status.temperature === 'number') out.temperature = status.temperature;
  }
  return out;
}

/** Enciende/apaga un canal. Prueba la API v2 y cae a la legacy si el servidor no la tiene. */
async function setSwitch(baseId, channel, on) {
  try {
    return await llamar('/v2/devices/api/set/switch', { method: 'POST', json: { id: String(baseId), channel: Number(channel) || 0, on: !!on } }, 2);
  } catch (e) {
    if (!/HTTP 40[04]|not found/i.test(e.message)) throw e;
    return await llamar('/device/relay/control', { method: 'POST', form: { id: String(baseId), channel: String(channel || 0), turn: on ? 'on' : 'off' } }, 2);
  }
}

module.exports = { configured, splitId, listDevices, listRooms, getStatuses, parseSwitch, setSwitch, sleep };
