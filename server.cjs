/**
 * server.cjs — Portería Virtual production gateway
 *
 * Responsibilities:
 *   1. Serve the Vite static build (dist/)
 *   2. Proxy /dahua/* → Dahua DSS Pro (keeps credentials server-side)
 *   3. Health-check endpoint
 *
 * Environment variables required in production (Hostinger → .env or panel):
 *   PORT              optional, defaults to 3002
 *   DAHUA_HOST        e.g. https://vdp.porteriavirtual.cl
 *   DAHUA_USER        DSS username
 *   DAHUA_PASS        DSS password
 *
 * For local dev these are NOT needed here — Vite's dev proxy handles /dahua/.
 */

'use strict';

// Carga variables de entorno: .env primero (local/Hostinger panel), luego .env.production como respaldo
require('dotenv').config();
require('dotenv').config({ path: '.env.production', override: false });

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');
const https      = require('https');
const http       = require('http');
const admin      = require('firebase-admin');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app  = express();
const port = process.env.PORT || 3002;

// El servidor corre detrás de un proxy (nginx termina TLS → node). Confiar en el
// primer hop para que req.ip sea la IP real del cliente (necesario para que el
// rate-limit funcione por usuario y no por la IP del proxy).
app.set('trust proxy', 1);

// ── Firebase Admin ────────────────────────────────────────────────────────────
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require('./serviceAccountKey.json');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  console.log(`✅ Firebase Admin initialized [${serviceAccount.project_id}]`);
} catch (e) {
  console.warn('⚠️  Firebase Admin disabled:', e.message);
}

// ── Middleware ────────────────────────────────────────────────────────────────
// CORS allows the web frontend (same-origin) and the Capacitor Android WebView,
// which hits this server with origin "https://localhost", "http://localhost"
// or "capacitor://localhost" depending on the WebView scheme.
const ALLOWED_ORIGINS = new Set([
  'https://app.porteriavirtual.cl',
  'https://cyan-jackal-138479.hostingersite.com',
  'http://localhost:3000',
  'http://localhost:3002',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
]);
app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (curl, server-to-server, native fetch)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
// El DSS empuja alarmas con fotos en Base64 (varios MB) al callback del Centro de eventos.
app.use('/api/dss/alarm-callback', express.json({ limit: '30mb' }));
app.use(bodyParser.json({
  limit: '2mb',
  // El webhook de WhatsApp Cloud API valida la firma HMAC sobre el cuerpo CRUDO.
  // Se conserva sólo para esa ruta: guardar el buffer de cada request sería gasto inútil.
  verify: (req, _res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/wa/cloud/webhook')) req.rawBody = buf;
  },
}));
app.use(bodyParser.urlencoded({ extended: true }));

// Cabeceras de seguridad (helmet). Desactivamos CSP y las políticas Cross-Origin
// para NO romper Firebase, Google Sign-In (popup), la PWA ni los assets — solo
// sumamos las cabeceras seguras (HSTS, noSniff, frameguard, etc.).
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

// Rate limiting: límite generoso global para /api/* y uno estricto para los
// endpoints sensibles de autenticación/cuentas (anti fuerza bruta y abuso).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un momento.' },
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos, intenta más tarde.' },
});
// set-credentials se llama UNA VEZ POR FILA en los imports masivos de residentes:
// con el límite de 15/min las importaciones grandes devolverían 429 desde la fila 16.
// Límite propio, más holgado pero acotado (el endpoint igual exige token de staff).
const credentialsLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un momento.' },
});
app.use('/api/users/set-credentials', credentialsLimiter);
app.use('/api/users', (req, res, next) =>
  req.path === '/set-credentials' ? next() : authLimiter(req, res, next));
app.use('/api/dahua/login', authLimiter);
app.use('/api/', apiLimiter);

// Allow Firebase Auth popups (Google Sign-In) to communicate with the opener.
// Without this header Firebase's window.closed / window.close calls are blocked
// by the browser's Cross-Origin-Opener-Policy enforcement.
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// ── Autenticación (token Firebase) ────────────────────────────────────────────
// requireAuth: exige un ID token de Firebase válido en "Authorization: Bearer ..".
// Cierra el acceso público a los endpoints sensibles (cualquiera con curl).
async function requireAuth(req, res, next) {
  if (!admin.apps.length) return res.status(503).json({ error: 'Auth no disponible' });
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'No autorizado' });
  }
}

// ── Dahua DSS proxy ───────────────────────────────────────────────────────────
//
// The browser calls /dahua/<path> with X-Subject-Token when logged in.
// This proxy forwards the request to DAHUA_HOST keeping credentials
// server-side so they never appear in the frontend bundle.
//
// In dev the Vite proxy handles /dahua/ — this block is only active in prod.

const DAHUA_HOST = process.env.DAHUA_HOST || '';
const DAHUA_USER = process.env.DAHUA_USER || '';
const DAHUA_PASS = process.env.DAHUA_PASS || '';

// Tokens OPACOS del proxy: el navegador nunca recibe el token real del DSS. /api/dahua/login
// emite uno por usuario (con su rol y condominios) y el proxy lo canjea por la sesión única del
// servidor. Un token desconocido recibe code 7000 → el cliente vuelve a llamar /api/dahua/login.
const _dssProxyTokens = new Map(); // opaque → { uid, email, role, condoId, condoIds, condoScope, ts }
const DSS_PROXY_TOKEN_TTL = 12 * 60 * 60 * 1000;
const DSS_STAFF_ROLES = new Set(['super_admin', 'condo_admin', 'administrador', 'operator', 'technician']);
const dssEsStaff = (p) => !!p && (DSS_STAFF_ROLES.has(p.role) || p.condoScope === 'all');
setInterval(() => { const now = Date.now(); for (const [k, v] of _dssProxyTokens) if (now - v.ts > DSS_PROXY_TOKEN_TTL) _dssProxyTokens.delete(k); }, 60 * 60_000).unref?.();

// Busca el pase de la app que corresponde a un visitorId del DSS dentro de los condominios del
// perfil. Devuelve { condoId, data } o null. (Consulta por colección: no requiere índice de grupo.)
async function buscarPaseDss(perfil, dahuaVisitorId) {
  if (!admin.apps.length || !perfil) return null;
  const condos = [perfil.condoId, ...(Array.isArray(perfil.condoIds) ? perfil.condoIds : [])].filter(Boolean);
  const ids = [String(dahuaVisitorId)]; if (/^\d+$/.test(String(dahuaVisitorId))) ids.push(Number(dahuaVisitorId));
  for (const c of [...new Set(condos)]) {
    const snap = await admin.firestore().collection(`condos/${c}/visitors`).where('dahuaVisitorId', 'in', ids).limit(1).get().catch(() => null);
    if (snap && !snap.empty) return { condoId: c, id: snap.docs[0].id, data: snap.docs[0].data() };
  }
  return null;
}
// ¿Puede este perfil operar (ver/terminar/borrar) el pase DSS indicado? Super/scope all: sí.
// Staff: si el pase está en uno de sus condominios. Residente: sólo si el pase es suyo.
async function puedeOperarPaseDss(perfil, uid, dahuaVisitorId) {
  if (!perfil) return false;
  if (perfil.role === 'super_admin' || perfil.condoScope === 'all') return true;
  const pase = await buscarPaseDss(perfil, dahuaVisitorId);
  if (!pase) return false;
  if (dssEsStaff(perfil)) return true;
  return pase.data.userId === uid;
}
// Rutas del DSS que un residente puede usar a través del proxy (sólo sobre su propio pase).
const DSS_RESIDENT_PATHS = [
  { m: 'GET',  re: /^\/obms\/api\/v1\.0\/visitors\/visitor\/(\d+)$/,        idDe: (mm) => mm[1] },
  { m: 'POST', re: /^\/obms\/api\/v1\.0\/visitors\/visitor\/leave$/,         idDe: (_mm, body) => body?.visitorId },
  { m: 'POST', re: /^\/obms\/api\/v1\.0\/visitors\/visitor\/overdue\/clear$/, idDe: (_mm, body) => Array.isArray(body?.visitorIds) && body.visitorIds.length === 1 ? body.visitorIds[0] : null },
];

if (DAHUA_HOST) {
  const DAHUA_ORIGIN = new URL(DAHUA_HOST).origin;
  app.use('/dahua', apiLimiter);   // rate-limit del proxy (no cae bajo /api/)
  app.all('/dahua/*', async (req, res) => {
    let targetUrl;
    try {
      targetUrl = new URL(
        req.path.replace(/^\/dahua/, '') + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''),
        DAHUA_HOST
      );
    } catch { return res.status(400).json({ error: 'Ruta inválida' }); }

    // Anti-SSRF: solo se permite proxear al host del DSS configurado (bloquea
    // rutas protocol-relative tipo /dahua//host-externo/... que resolverían a otro host).
    if (targetUrl.origin !== DAHUA_ORIGIN) return res.status(400).json({ error: 'Destino no permitido' });

    const dssPath = targetUrl.pathname;
    const opaque = String(req.headers['x-subject-token'] || '');
    // Login directo contra el DSS a través del proxy: nunca (fuerza bruta / sesiones ajenas).
    if (/\/accounts\/authorize$/.test(dssPath)) return res.status(403).json({ code: 403, desc: 'Usar /api/dahua/login' });
    const sess = _dssProxyTokens.get(opaque);
    if (!sess || Date.now() - sess.ts > DSS_PROXY_TOKEN_TTL) {
      if (sess) _dssProxyTokens.delete(opaque);
      // Mismo código que usa el DSS para sesión vencida: DahuaService re-loguea solo.
      return res.status(200).json({ code: 7000, desc: 'Auth failed' });
    }
    // Keepalive / refresco / cierre del token opaco: se resuelven acá, sin tocar la sesión del servidor.
    if (/\/accounts\/(keepalive|updateToken)$/.test(dssPath)) { sess.ts = Date.now(); return res.json({ code: 1000, desc: 'Success', data: { token: opaque, duration: 30 } }); }
    if (/\/accounts\/unauthorize$/.test(dssPath)) { _dssProxyTokens.delete(opaque); return res.json({ code: 1000, desc: 'Success' }); }
    if (!/^\/(brms|obms|ipms)\/api\//.test(dssPath)) return res.status(403).json({ code: 403, desc: 'Ruta no permitida' });
    if (!dssEsStaff(sess)) {
      const regla = DSS_RESIDENT_PATHS.find(r => r.m === req.method && r.re.test(dssPath));
      if (!regla) return res.status(403).json({ code: 403, desc: 'Operación no permitida para este rol' });
      const visitorId = regla.idDe(dssPath.match(regla.re), req.body);
      if (!visitorId || !(await puedeOperarPaseDss(sess, sess.uid, String(visitorId)))) {
        return res.status(403).json({ code: 403, desc: 'Pase no encontrado o no pertenece al usuario' });
      }
    }
    try {
      let token = await ensureReportToken();
      if (!token) return res.status(502).json({ code: 502, desc: 'Sin sesión DSS' });
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? (req.body || {}) : null;
      let r = await dssRequest(req.method, dssPath + targetUrl.search, body, { 'X-Subject-Token': token });
      if (r.body && typeof r.body === 'object' && (r.body.code === 7000 || r.body.code === 2003)) {
        token = await pollerDssLogin();
        if (token) r = await dssRequest(req.method, dssPath + targetUrl.search, body, { 'X-Subject-Token': token });
      }
      sess.ts = Date.now();
      res.status(r.status || 200);
      if (typeof r.body === 'string') return res.type('text/plain').send(r.body);
      return res.json(r.body);
    } catch (err) {
      console.error('[Dahua proxy] request error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'DSS proxy error' });
    }
  });

  console.log(`🔌 Dahua proxy active → ${DAHUA_HOST}`);
} else {
  console.warn('⚠️  DAHUA_HOST not set — /dahua/* proxy disabled');
}

// ── Server-side Dahua login ───────────────────────────────────────────────────
//
// POST /api/dahua/login
// The frontend calls this in production. The server performs the full 2-step
// MD5 login using DAHUA_USER/DAHUA_PASS (server env vars, never in the bundle)
// and returns only the token to the browser.
//
// Formula from DSS HTTP API manual §3.1 — identical to DahuaService.ts client.

const crypto = require('crypto');

function dssmd5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function buildDssSignature(username, password, realm, randomKey) {
  const t1 = dssmd5(password);
  const t2 = dssmd5(username + t1);
  const t3 = dssmd5(t2);
  const t4 = dssmd5(`${username}:${realm}:${t3}`);
  return dssmd5(`${t4}:${randomKey}`);
}

function dssRequest(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    if (!DAHUA_HOST) return reject(new Error('DAHUA_HOST not configured'));
    const targetUrl = new URL(path, DAHUA_HOST);
    const isHttps   = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const payload   = body ? JSON.stringify(body) : null;

    const options = {
      hostname: targetUrl.hostname,
      port:     targetUrl.port || (isHttps ? 443 : 80),
      path:     targetUrl.pathname + targetUrl.search,
      method,
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', ...headers },
    };

    const req = transport.request(options, (res2) => {
      let data = '';
      res2.on('data', chunk => { data += chunk; });
      res2.on('end', () => {
        try { resolve({ status: res2.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res2.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Entrega un token OPACO ligado al usuario (rol + condominios). El token real del DSS nunca sale
// del servidor y no se abre una sesión DSS por navegador: todos comparten la sesión del poller
// (antes cada login del navegador reemplazaba esa sesión y expulsaba a los demás).
app.post('/api/dahua/login', requireAuth, async (req, res) => {
  if (!DAHUA_HOST || !DAHUA_USER || !DAHUA_PASS) {
    return res.status(503).json({ error: 'Dahua credentials not configured on server' });
  }
  try {
    const prof = await callerProfile(req);
    const token = await ensureReportToken();
    if (!token) return res.status(502).json({ error: 'DSS login error' });
    const opaque = 'pv' + require('crypto').randomBytes(24).toString('hex');
    _dssProxyTokens.set(opaque, {
      uid: req.user.uid, email: req.user.email || '', role: prof?.role || 'resident',
      condoId: prof?.condoId || null, condoIds: Array.isArray(prof?.condoIds) ? prof.condoIds : [],
      condoScope: prof?.condoScope || null, ts: Date.now(),
    });
    res.json({ token: opaque, userName: DAHUA_USER });
  } catch (err) {
    console.error('[Dahua login]', err.message);
    res.status(502).json({ error: 'DSS login error' });
  }
});

// Config probe (username only, never password) — sólo con sesión.
app.get('/api/dahua/config', requireAuth, (_req, res) => {
  res.json({ configured: !!DAHUA_HOST, user: DAHUA_USER || null });
});

// ── Reports raw-data endpoint ─────────────────────────────────────────────────
// GET /api/reports/raw-data?startTime=X&endTime=Y
//
// Fetches access records + visitor history from DSS server-side using the
// shared _pollerToken. Time ranges are split into 4-hour chunks to comply
// with the DSS window limit. Chunks are fetched in parallel batches of 3.
// Results are cached in-memory for 5 minutes so switching between report
// types for the same date range is instant (no re-fetch).

const _reportsCache = new Map(); // cacheKey → { accesses, visitors, cachedAt }
const REPORTS_CACHE_TTL = 5 * 60 * 1000;

function parseDssTsSrv(val) {
  if (val === null || val === undefined || val === '' || val === 0 || val === '0') return 0;
  const n = Number(val);
  if (!isNaN(n) && n > 1_000_000_000) return n > 4_102_444_800 ? Math.floor(n / 1000) : n;
  const s = String(val).trim();
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

function reportTimeChunks(startTime, endTime, maxWin = 14400, maxChunks = 42) {
  const chunks = [];
  let t = endTime;
  while (t > startTime && chunks.length < maxChunks) {
    const s = Math.max(startTime, t - maxWin);
    chunks.unshift([s, t]);
    t = s;
  }
  return chunks;
}

async function ensureReportToken() {
  if (_pollerToken) return _pollerToken;
  _pollerToken = await pollerDssLogin();
  return _pollerToken;
}

async function dssAuthed(method, path, body) {
  const token = await ensureReportToken();
  if (!token) throw new Error('No DSS session available');
  let r = await dssRequest(method, path, body, { 'X-Subject-Token': token });
  if (r.body?.code === 7000 || r.body?.code === 2003) {
    _pollerToken = await pollerDssLogin();
    if (!_pollerToken) throw new Error('DSS re-login failed');
    r = await dssRequest(method, path, body, { 'X-Subject-Token': _pollerToken });
  }
  return r;
}

// ── DSS access-channel cache (defends against orphan IDs in Firestore) ───────
// If a channel is deleted in DSS but still stored in a condo's dahuaChannelIds,
// sending it as acsChannelIds returns code 1004 — invalidating the whole visitor.
// We cache the set of currently-valid access channel IDs and filter inbound
// arrays before forwarding to DSS.

let _accessChannelsCache = null;     // { ids: Set<string>, ts: number }
const ACCESS_CHANNELS_TTL = 10 * 60 * 1000;

async function getValidAccessChannelIds(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _accessChannelsCache && (now - _accessChannelsCache.ts) < ACCESS_CHANNELS_TTL) {
    return _accessChannelsCache.ids;
  }
  const r = await dssAuthed('GET', '/brms/api/v1.0/tree/deviceOrg?channelTypes=7&sort=&orgCode=', null);
  if (r.body?.code !== 1000) {
    // If the fetch fails, fall back to whatever we have cached (stale > none)
    if (_accessChannelsCache) return _accessChannelsCache.ids;
    throw new Error('listAccessChannels failed: ' + JSON.stringify(r.body));
  }
  const ids = new Set();
  (function walk(departments) {
    if (!Array.isArray(departments)) return;
    for (const dept of departments) {
      if (Array.isArray(dept.channel)) for (const ch of dept.channel) ids.add(String(ch.id));
      if (Array.isArray(dept.departments)) walk(dept.departments);
    }
  })(r.body?.data?.departments ?? []);
  _accessChannelsCache = { ids, ts: now };
  return ids;
}

async function fetchDssAccessRecords(startTime, endTime) {
  const chunks = reportTimeChunks(startTime, endTime);
  const all = [];
  const BATCH = 2;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const results = await Promise.all(
      chunks.slice(i, i + BATCH).map(([cs, ce]) =>
        dssAuthed('POST', '/obms/api/v1.1/acs/access/record/fetch/page', {
          page: 1, pageSize: 1000, currentPage: 1,
          startTime: String(cs), endTime: String(ce),
          areaCodes: [], eventLevels: ['1', '2', '3'],
          orgCode: '', pointId: '', pointTypes: [], pointName: '',
          personId: '', personName: '', splitId: '', splitTime: '',
        }).catch(() => null)
      )
    );
    for (const r of results) {
      if (!r?.body || r.body.code !== 1000) continue;
      const payload = r.body.data ?? r.body;
      for (const raw of (payload.list ?? payload.pageData ?? [])) {
        const pInfo = raw.personBaseInfo ?? raw.personInfo ?? raw.person ?? {};
        const first = String(raw.firstName ?? pInfo.firstName ?? '').trim();
        const last  = String(raw.lastName  ?? pInfo.lastName  ?? '').trim();
        const name  = (first && last ? `${first} ${last}` : first || last) ||
                      String(raw.personName ?? pInfo.personName ?? raw.name ?? '').trim();
        const dir = String(raw.inOutStatus ?? raw.direction ?? '').toLowerCase();
        all.push({
          id:          String(raw.id ?? raw.recordId ?? ''),
          personId:    String(raw.personId ?? pInfo.personId ?? ''),
          personName:  name,
          channelId:   String(raw.pointId ?? raw.channelId ?? ''),
          channelName: String(raw.pointName ?? raw.channelName ?? ''),
          orgName:     String(raw.orgName ?? raw.zoneName ?? pInfo.orgName ?? ''),
          personGroup: String(raw.personGroupName ?? raw.groupName ?? pInfo.orgName ?? ''),
          accessTime:  parseDssTsSrv(raw.alarmTime ?? raw.accessTime ?? raw.time ?? raw.eventTime ?? raw.happenTime),
          direction:   dir === '0' || dir === 'in'  || dir === 'enter' ? 'in' :
                       dir === '1' || dir === 'out' || dir === 'exit'  ? 'out' : '',
          // Tipo de evento DSS (cómo se abrió): 48=Platform Remote Open, 49=Normal Button
          // Unlock, 900001=VTS Remote Open, 600005=Valid Face Unlock, 51=Valid Swipe, etc.
          eventTypeId:   String(raw.alarmTypeId ?? ''),
          eventTypeName: String(raw.alarmTypeName ?? ''),
        });
      }
    }
    if (i + BATCH < chunks.length) await new Promise(r => setTimeout(r, 400));
  }
  const seen = new Set();
  return all.filter(r => { if (!r.id) return true; if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia de eventos de acceso (Fase 1 — poller incremental)
// Copia los ingresos del DSS a Firestore ya enriquecidos (condominio/unidad/residente)
// para que Registros e Informes lean rápido y filtren por condominio server-side.
// El DSS sigue siendo la fuente de verdad; esto solo sincroniza. Idempotente: el ID del
// doc = ID del evento DSS y el rollup se incrementa solo al crear el evento (transacción).
// ─────────────────────────────────────────────────────────────────────────────
let _accessSyncRunning = false;
const ACCESS_SYNC_OVERLAP = 10 * 60;       // solape de seguridad (s)
const ACCESS_STEP         = 30 * 60;       // avance máx por corrida (s) — el DSS topa ~1000/consulta

// Mapas de enriquecimiento, cacheados unos minutos.
let _accessEnrich = { ts: 0, chMap: null, personMap: null };
const ACCESS_ENRICH_TTL = 5 * 60 * 1000;
async function getAccessEnrichMaps() {
  if (_accessEnrich.chMap && Date.now() - _accessEnrich.ts < ACCESS_ENRICH_TTL) return _accessEnrich;
  const firestore = admin.firestore();
  const chMap = new Map();      // prefijo de canal → { condoId, condoName }
  const condosSnap = await firestore.collection('condos').get();
  condosSnap.forEach(d => {
    const x = d.data(); const condoName = x.name || '';
    (x.dahuaChannelIds || []).forEach(c => chMap.set(String(c).split('$')[0], { condoId: d.id, condoName }));
  });
  const personMap = new Map();  // dahuaPersonId → datos del residente
  const usersSnap = await firestore.collection('users').where('role', 'in', ['resident', 'usuario']).get();
  usersSnap.forEach(d => {
    const x = d.data();
    if (x.dahuaPersonId) personMap.set(String(x.dahuaPersonId), {
      residentUid: d.id, unit: x.unit || '', name: x.name || x.displayName || '',
      condoId: x.condoId || '', condoName: x.condoName || '',
    });
  });
  _accessEnrich = { ts: Date.now(), chMap, personMap };
  return _accessEnrich;
}

const _fmtDay  = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });
const _fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });

async function syncAccessEvents() {
  if (_accessSyncRunning || !DAHUA_HOST || !admin.apps.length) return;
  _accessSyncRunning = true;
  const firestore = admin.firestore();
  const inc = admin.firestore.FieldValue.increment;
  try {
    const stateRef = firestore.doc('config/accessSyncState');
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? stateSnap.data() : {};
    if (state.paused) return;                  // pausado durante el backfill (Fase 2)
    const now = Math.floor(Date.now() / 1000);
    const lastSynced = state.lastSyncedTs || 0;

    // Primera corrida: marcar cursor = ahora (el histórico lo hace el backfill, Fase 2).
    if (!lastSynced) {
      await stateRef.set({ lastSyncedTs: now, lastRunAt: now, note: 'cursor inicial' }, { merge: true });
      return;
    }

    // El DSS no pagina y topa en ~1000 registros por consulta. Para no perder eventos
    // cuando el poller se atrasa, se avanza en pasos chicos (≤30 min, muy por debajo de
    // 1000). En operación normal end=now (ventana de ~13 min, una sola consulta).
    const end = Math.min(now, lastSynced + ACCESS_STEP);
    const start = Math.max(0, lastSynced - ACCESS_SYNC_OVERLAP);
    const records = await fetchDssAccessRecords(start, end);
    const { chMap, personMap } = await getAccessEnrichMaps();

    let written = 0, skipped = 0, maxTs = lastSynced;
    for (const r of records) {
      const ts = Number(r.accessTime) || 0;
      if (ts > maxTs) maxTs = ts;
      if (!r.id || !ts) { skipped++; continue; }

      const person = r.personId ? personMap.get(String(r.personId)) : null;
      const ch = chMap.get(String(r.channelId || '').split('$')[0]);
      const condoId   = ch?.condoId || person?.condoId || '';
      const condoName = ch?.condoName || person?.condoName || '';
      if (!condoId) { skipped++; continue; }   // no atribuible a un condominio → se omite

      const dateObj  = new Date(ts * 1000);
      const date     = _fmtDay.format(dateObj);
      const time     = _fmtTime.format(dateObj);
      const pointName = r.channelName || r.pointName || '';
      const direction = r.direction === 'in' || r.direction === 'out' ? r.direction : '';
      const residentUid = person?.residentUid || '';

      const evRef = firestore.doc(`condos/${condoId}/accessEvents/${r.id}`);
      const dailyRef = firestore.doc(`condos/${condoId}/accessDaily/${date}`);
      try {
        const created = await firestore.runTransaction(async tx => {
          const ev = await tx.get(evRef);
          if (ev.exists) return false;          // ya procesado → no recontar
          tx.set(evRef, {
            ts, date, time, direction, condoId, condoName,
            personId: String(r.personId || ''), personName: r.personName || person?.name || '',
            residentUid, unit: person?.unit || '', channelId: String(r.channelId || ''), pointName,
            isVisitor: !residentUid,
            eventTypeId: r.eventTypeId || '', eventTypeName: r.eventTypeName || '',
          });
          const upd = {
            date, condoId, condoName, total: inc(1), updatedAt: Date.now(),
            byPoint: pointName ? { [pointName]: inc(1) } : {},
          };
          if (direction === 'in') upd.in = inc(1); else if (direction === 'out') upd.out = inc(1);
          if (residentUid) upd.residents = inc(1); else upd.visitors = inc(1);
          tx.set(dailyRef, upd, { merge: true });
          return true;
        });
        if (created) written++;
      } catch (txErr) {
        console.warn('[AccessSync] tx error', r.id, txErr.message);
      }
    }

    // El cursor avanza a 'end' siempre (aunque no haya eventos) para garantizar progreso.
    await stateRef.set({ lastSyncedTs: Math.max(end, maxTs), lastRunAt: now }, { merge: true });
    if (written || skipped) console.log(`[AccessSync] +${written} eventos (${skipped} omitidos) — cursor ${Math.max(end, maxTs)}`);
  } catch (err) {
    console.error('[AccessSync] error:', err.message);
  } finally {
    _accessSyncRunning = false;
  }
}

// Backfill histórico DENTRO del servidor: reusa fetchDssAccessRecords (sesión DSS
// compartida vía dssAuthed → sin contención/storm). Ventanas de 1 h (el DSS no pagina
// y topa ~1000/consulta). Pausa el poller mientras corre y lo reanuda desde T0 al final.
let _accessBackfillRunning = false;
async function backfillAccessRange(months) {
  if (_accessBackfillRunning) return { error: 'backfill ya en curso' };
  if (!DAHUA_HOST || !admin.apps.length) return { error: 'DSS/Firebase no disponible' };
  _accessBackfillRunning = true;
  const firestore = admin.firestore();
  const T0 = Math.floor(Date.now() / 1000);
  const startTs = T0 - Math.min(12, Math.max(1, months)) * 30 * 86400;
  (async () => {
    const stateRef = firestore.doc('config/accessSyncState');
    try {
      await stateRef.set({ paused: true }, { merge: true });
      await new Promise(r => setTimeout(r, 4000));     // dejar terminar corrida en vuelo
      const { chMap, personMap } = await getAccessEnrichMaps();
      const WIN = 3600, rollups = new Map();
      let batch = firestore.batch(), ops = 0, total = 0, curDay = null, win = 0;
      const flushEvents = async () => { if (ops) { await batch.commit(); batch = firestore.batch(); ops = 0; } };
      const flushRollupsBefore = async (beforeDay) => {
        let rb = firestore.batch(), rc = 0;
        for (const [k, ro] of rollups) {
          const sep = k.indexOf('|'), condoId = k.slice(0, sep), date = k.slice(sep + 1);
          if (date >= beforeDay) continue;
          rb.set(firestore.doc(`condos/${condoId}/accessDaily/${date}`), { date, condoId, condoName: ro.condoName, total: ro.total, in: ro.in, out: ro.out, residents: ro.residents, visitors: ro.visitors, byPoint: ro.byPoint, updatedAt: Date.now(), backfilled: true });
          rollups.delete(k); rc++;
          if (rc % 450 === 0) { await rb.commit(); rb = firestore.batch(); }
        }
        if (rc % 450 !== 0) await rb.commit();
      };
      console.log(`[AccessBackfill] inicio ${months}m (${startTs}→${T0})`);
      for (let s = startTs; s < T0; s += WIN) {
        const e = Math.min(T0, s + WIN);
        const records = await fetchDssAccessRecords(s, e);    // sesión compartida
        for (const r of records) {
          const ts = Number(r.accessTime) || 0;
          if (!r.id || !ts) continue;
          const person = r.personId ? personMap.get(String(r.personId)) : null;
          const ch = chMap.get(String(r.channelId || '').split('$')[0]);
          const condoId = ch?.condoId || person?.condoId || '';
          const condoName = ch?.condoName || person?.condoName || '';
          if (!condoId) continue;
          const dObj = new Date(ts * 1000), date = _fmtDay.format(dObj), time = _fmtTime.format(dObj);
          const pointName = r.channelName || r.pointName || '';
          const direction = r.direction === 'in' || r.direction === 'out' ? r.direction : '';
          const residentUid = person?.residentUid || '';
          batch.set(firestore.doc(`condos/${condoId}/accessEvents/${r.id}`), { ts, date, time, direction, condoId, condoName, personId: String(r.personId || ''), personName: r.personName || person?.name || '', residentUid, unit: person?.unit || '', channelId: String(r.channelId || ''), pointName, isVisitor: !residentUid, eventTypeId: r.eventTypeId || '', eventTypeName: r.eventTypeName || '' });
          ops++; total++;
          const k = condoId + '|' + date; let ro = rollups.get(k);
          if (!ro) { ro = { condoName, total: 0, in: 0, out: 0, residents: 0, visitors: 0, byPoint: {} }; rollups.set(k, ro); }
          ro.total++; if (direction) ro[direction]++; if (residentUid) ro.residents++; else ro.visitors++; if (pointName) ro.byPoint[pointName] = (ro.byPoint[pointName] || 0) + 1;
          if (ops >= 450) await flushEvents();
        }
        const wDay = _fmtDay.format(new Date(s * 1000));
        if (curDay && wDay > curDay) { await flushEvents(); await flushRollupsBefore(wDay); }
        curDay = wDay;
        if (++win % 48 === 0) { await flushEvents(); console.log(`[AccessBackfill] ${wDay} eventos=${total}`); }
        await new Promise(r => setTimeout(r, 120));
      }
      await flushEvents();
      await flushRollupsBefore('9999-99-99');               // resto (incl. hoy)
      await stateRef.set({ paused: false, lastSyncedTs: T0, lastRunAt: T0, backfillDone: T0 }, { merge: true });
      console.log(`[AccessBackfill] OK ${total} eventos. Poller reanudado.`);
    } catch (err) {
      console.error('[AccessBackfill] error:', err.message);
      await stateRef.set({ paused: false }, { merge: true }).catch(() => {});
    } finally {
      _accessBackfillRunning = false;
    }
  })();
  return { started: true, months, startTs, endTs: T0 };
}

async function fetchDssVisitorHistory(startTime, endTime) {
  const chunks = reportTimeChunks(startTime, endTime);
  const all = [];
  const BATCH = 2;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const results = await Promise.all(
      chunks.slice(i, i + BATCH).map(([cs, ce]) => {
        const qs = new URLSearchParams({
          page: '1', pageSize: '1000', currentPage: '1',
          startTime: String(cs), endTime: String(ce),
          visitorName: '', visitedName: '', status: '-1',
          splitId: '', cardNo: '', idNo: '', tel: '', email: '', visitedCompany: '',
        }).toString();
        return dssAuthed('GET', `/obms/api/v1.1/visitor/history/record/page?${qs}`, null).catch(() => null);
      })
    );
    for (const r of results) {
      if (!r?.body || r.body.code !== 1000) continue;
      const payload = r.body.data ?? r.body;
      for (const raw of (payload.list ?? payload.pageData ?? [])) {
        all.push({
          id:                String(raw.id ?? raw.visitorId ?? ''),
          visitorName:       String(raw.visitorName ?? '—'),
          visitedName:       String(raw.visitedName ?? '—'),
          arrivalTime:       raw.arrivalTime ? Number(raw.arrivalTime) : undefined,
          leaveTime:         raw.leaveTime   ? Number(raw.leaveTime)   : undefined,
          expectArrivalTime: Number(raw.expectArrivalTime ?? 0),
          expectLeaveTime:   Number(raw.expectLeaveTime   ?? 0),
          plateNo:           raw.plateNo ? String(raw.plateNo) : undefined,
          status:            String(raw.status ?? '0'),
        });
      }
    }
    if (i + BATCH < chunks.length) await new Promise(r => setTimeout(r, 400));
  }
  const seen = new Set();
  return all.filter(r => { if (!r.id) return true; if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

app.get('/api/reports/raw-data', requireAuth, requireRole(['condo_admin', 'administrador', 'operator']), async (req, res) => {
  if (!DAHUA_HOST) return res.status(503).json({ error: 'DAHUA_HOST not configured' });
  const startTime = parseInt(req.query.startTime, 10);
  const endTime   = parseInt(req.query.endTime,   10);
  if (!startTime || !endTime || endTime <= startTime) {
    return res.status(400).json({ error: 'Valid startTime and endTime required' });
  }

  const cacheKey = `${startTime}-${endTime}`;
  const cached = _reportsCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REPORTS_CACHE_TTL) {
    console.log(`[Reports] cache hit ${cacheKey} (${cached.accesses.length} accesses, ${cached.visitors.length} visitors)`);
    return res.json({ accesses: cached.accesses, visitors: cached.visitors, fromCache: true, cachedAt: cached.cachedAt });
  }

  try {
    console.log(`[Reports] fetching DSS data ${new Date(startTime * 1000).toISOString()} → ${new Date(endTime * 1000).toISOString()}`);
    const [accesses, visitors] = await Promise.all([
      fetchDssAccessRecords(startTime, endTime),
      fetchDssVisitorHistory(startTime, endTime),
    ]);
    console.log(`[Reports] fetched ${accesses.length} accesses, ${visitors.length} visitors`);

    const entry = { accesses, visitors, cachedAt: Date.now() };
    _reportsCache.set(cacheKey, entry);
    if (_reportsCache.size > 10) {
      const oldest = [..._reportsCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
      _reportsCache.delete(oldest[0]);
    }
    res.json({ accesses, visitors, fromCache: false, cachedAt: entry.cachedAt });
  } catch (err) {
    console.error('[Reports] raw-data error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/access/records?startTime=&endTime=&condoId=
// Lee los eventos de acceso PERSISTIDOS (Firestore accessEvents) — sin el truncado del DSS
// en vivo, con scope por condominio del usuario. Devuelve el mismo formato que raw-data.accesses.
app.get('/api/access/records', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  const start = Number(req.query.startTime) || 0;
  const end   = Number(req.query.endTime)   || Math.floor(Date.now() / 1000);
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    const isGlobal = prof.role === 'super_admin' || prof.condoScope === 'all';
    let condoIds = [];
    if (isGlobal) {
      condoIds = (await firestore.collection('condos').get()).docs.map(d => d.id);
    } else {
      if (prof.condoId) condoIds.push(prof.condoId);
      (prof.condoIds || []).forEach(id => condoIds.push(id));
      condoIds = [...new Set(condoIds)];
    }
    // Filtro opcional a un condominio (si el usuario tiene acceso).
    if (req.query.condoId && condoIds.includes(String(req.query.condoId))) condoIds = [String(req.query.condoId)];

    // Un condo_admin acotado a una unidad solo ve los accesos de su unidad (no global).
    const unitScope = (!isGlobal && prof.unit) ? String(prof.unit) : '';

    // Resolución de unidad: el `unit` persistido en los eventos suele venir vacío (los
    // que acceden no siempre están vinculados por dahuaPersonId). Cuando hay unitScope,
    // resolvemos la unidad de cada evento por personId (dahuaPersonId) O por nombre
    // (personName → residente), usando los residentes del/los condominio(s).
    const _norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    let pidToUnit = null, nameToUnit = null;
    if (unitScope) {
      pidToUnit = {}; nameToUnit = {};
      const rsnaps = await Promise.all(condoIds.map(cid =>
        firestore.collection('users').where('condoId', '==', cid).where('role', 'in', ['resident', 'usuario']).get()
          .catch(() => ({ forEach() {} }))
      ));
      rsnaps.forEach(rs => rs.forEach(d => {
        const u = d.data(); const unit = String(u.unit || '');
        if (!unit) return;
        if (u.dahuaPersonId) pidToUnit[String(u.dahuaPersonId)] = unit;
        if (u.name)        nameToUnit[_norm(u.name)]        = unit;
        if (u.displayName) nameToUnit[_norm(u.displayName)] = unit;
      }));
    }
    const resolveUnit = (x) => {
      if (x.unit) return String(x.unit);
      if (!pidToUnit) return '';
      return pidToUnit[String(x.personId || '')] || nameToUnit[_norm(x.personName || '')] || '';
    };

    // Con unitScope se filtra por unidad DESPUÉS de leer, así que se necesita una ventana
    // más amplia por condominio para no truncar los eventos de la unidad (es un solo condo).
    const LIMIT_PER_CONDO = unitScope ? 4000 : 800;
    const all = [];
    await Promise.all(condoIds.map(async cid => {
      try {
        const snap = await firestore.collection(`condos/${cid}/accessEvents`)
          .where('ts', '>=', start).where('ts', '<=', end)
          .orderBy('ts', 'desc').limit(LIMIT_PER_CONDO).get();
        snap.forEach(d => {
          const x = d.data();
          const ru = unitScope ? resolveUnit(x) : '';
          if (unitScope && ru !== unitScope) return;   // restricción por unidad (resuelta por id o nombre)
          all.push({
            id: d.id, personId: x.personId || '', personName: x.personName || '',
            channelId: x.channelId || '', channelName: x.pointName || '', orgName: x.condoName || '',
            personGroup: unitScope ? ru : (x.unit || ''), accessTime: x.ts || 0, direction: x.direction || '',
            eventTypeId: x.eventTypeId || '', eventTypeName: x.eventTypeName || '',
          });
        });
      } catch (e) { console.warn('[AccessRecords] condo', cid, e.message); }
    }));
    all.sort((a, b) => b.accessTime - a.accessTime);
    res.json({ accesses: all.slice(0, 5000) });
  } catch (err) {
    console.error('[AccessRecords] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Consentimiento (Ley 21.719) — el titular del hogar acepta por sí y por los
// integrantes de su unidad. Inerte hasta que config/consent.enabled = true.
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/household/members — integrantes de la unidad del usuario autenticado.
app.get('/api/household/members', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    const condoId = prof.condoId || '';
    const unit = String(prof.unit || '');
    const members = [{
      uid: req.user.uid, name: prof.name || prof.displayName || 'Yo',
      dahuaPersonId: prof.dahuaPersonId || null, isSelf: true, hasPhoto: !!prof.photoUrl, source: 'app',
    }];
    const _nn = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    if (condoId && unit) {
      // 1) Integrantes que están en la app (Firestore). Filtro por condoId (índice de
      //    campo único) y afino unidad/rol en memoria, para no requerir índice compuesto.
      const snap = await firestore.collection('users').where('condoId', '==', condoId).get();
      snap.forEach(d => {
        if (d.id === req.user.uid) return;
        const u = d.data();
        if (!['resident', 'usuario'].includes(u.role)) return;
        if (String(u.unit || '') !== unit) return;
        members.push({
          uid: d.id, name: u.name || u.displayName || 'Integrante',
          dahuaPersonId: u.dahuaPersonId || null, isSelf: false, hasPhoto: !!u.photoUrl, source: 'app',
        });
      });

      // 2) Integrantes que SOLO están en el DSS (Person & Vehicle). En la app puede haber
      //    una sola persona por hogar; el resto del hogar vive en el DSS. Se listan por el
      //    orgName real del condominio (vía sus canales, evita el desajuste Firestore↔DSS)
      //    y roomNo == unidad. Se deduplican contra los de la app (por personId o nombre).
      //    CON TIMEOUT: si el DSS está lento (caché frío, sesión caída) se responde igual
      //    con los integrantes de la app — el consentimiento no puede quedar colgado
      //    esperando al DSS (hubo un 499 por esto: el cliente abortó tras la espera).
      try {
        await Promise.race([
          new Promise((_, rej) => setTimeout(() => rej(new Error('DSS lento — se omiten integrantes DSS (timeout 8s)')), 8000)),
          (async () => {
        const condoData = (await firestore.collection('condos').doc(condoId).get()).data() || {};
        const channelIds = (condoData.dahuaChannelIds || []).map(String);
        let orgName = null;
        if (channelIds.length) {
          const doorMap = await getDoorChannelOrgMap();
          for (const ch of channelIds) { const n = doorMap.get(ch); if (n) { orgName = n; break; } }
        }
        if (orgName) {
          const persons = await getDssPersonsCached();
          const tree = await getPersonOrgTree();
          const seenPid = new Set(members.filter(m => m.dahuaPersonId).map(m => String(m.dahuaPersonId)));
          const seenName = new Set(members.map(m => _nn(m.name)));
          const condoKey = normOrgName(orgName);   // nombre del condominio (del árbol de dispositivos)
          const unitKey = normOrgName(unit);        // la unidad suele ser el nombre del grupo de personas

          // Nodo del CONDOMINIO en el árbol de PERSONAS del DSS. Es el acote OBLIGATORIO
          // para no mezclar residentes de otro condominio con la misma numeración de unidad
          // (p.ej. "404" en Holanda y Quillay). Se ancla en orden de confianza:
          //   a) por el orgCode de un integrante de la app que ya tenga dahuaPersonId
          //      (garantiza el condominio exacto, sin depender de nombres).
          //   b) por el nombre del condominio (orgName de dispositivos == nodo top de personas).
          let condoTopCode = null;
          const anchorPid = members.map(m => m.dahuaPersonId).find(Boolean);
          if (anchorPid) {
            const ap = persons.find(p => String(p.personId) === String(anchorPid));
            if (ap) { const t = tree.topCondo(ap.orgCode); if (t) condoTopCode = String(t.orgCode); }
          }
          if (!condoTopCode) {
            const node = tree.topNodes.find(t => normOrgName(t.orgName) === condoKey);
            if (node) condoTopCode = String(node.orgCode);
          }

          if (!condoTopCode) {
            // No se pudo ubicar el condominio en el árbol de personas → FAIL-CLOSED:
            // se omiten los integrantes del DSS para NO arriesgar un cruce entre condominios.
            console.warn(`[Household] condominio "${orgName}" no ubicado en árbol de personas → se omiten integrantes DSS (evita cruce)`);
          } else {
            for (const p of persons) {
              // La unidad puede ser el GRUPO de la persona (orgName == unidad, caso Valenzuela
              // Puelma "VP F") o venir en roomNo (otras estructuras).
              const orgMatch  = normOrgName(p.orgName) === unitKey;
              const roomMatch = p.roomNo && _nn(p.roomNo) === _nn(unit);
              if (!orgMatch && !roomMatch) continue;
              // ACOTE OBLIGATORIO POR CONDOMINIO: la persona debe pertenecer al MISMO nodo top.
              const top = tree.topCondo(p.orgCode);
              if (!top || String(top.orgCode) !== condoTopCode) continue;
              if (p.personId && seenPid.has(String(p.personId))) continue;
              if (seenName.has(_nn(p.name))) continue;
              members.push({
                uid: `dss_${p.personId}`, name: p.name || 'Integrante',
                dahuaPersonId: p.personId || null, isSelf: false, hasPhoto: false, source: 'dss',
              });
              if (p.personId) seenPid.add(String(p.personId));
              seenName.add(_nn(p.name));
            }
          }
        }
          })(),
        ]);
      } catch (e) { console.warn('[Household] DSS merge:', e.message); }
    }
    res.json({ unit, condoId, members });
  } catch (err) {
    console.error('[Household] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consent/accept — registra el consentimiento por integrante del hogar.
app.post('/api/consent/accept', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  const { version, members } = req.body || {};
  if (!Array.isArray(members)) return res.status(400).json({ error: 'members requerido' });
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    const condoId = prof.condoId || '';
    if (!condoId) return res.status(400).json({ error: 'usuario sin condominio' });
    const now = admin.firestore.Timestamp.now();
    const acceptedByName = prof.name || prof.displayName || '';
    const v = Number(version) || 1;
    const batch = firestore.batch();
    const ratifyLinks = [];
    for (const m of members) {
      if (!m || !m.uid) continue;
      const relation = ['self', 'minor', 'adult'].includes(m.relation) ? m.relation : 'adult';
      const basis = relation === 'self' ? 'self' : relation === 'minor' ? 'guardian' : 'declared_by_holder';
      const rec = {
        subjectUid: m.uid, subjectName: m.name || '', subjectDahuaPersonId: m.dahuaPersonId || null,
        unit: String(prof.unit || ''), condoId,
        relation, basis, biometric: !!m.biometric, general: true, version: v,
        acceptedByUid: req.user.uid, acceptedByName, acceptedAt: now,
        ratified: relation !== 'adult',   // self/minor no requieren ratificación de terceros
      };
      if (relation === 'adult') {
        const token = crypto.randomBytes(18).toString('hex');
        rec.ratifyToken = token;
        batch.set(firestore.doc(`ratifyTokens/${token}`),
          { condoId, subjectUid: m.uid, subjectName: m.name || '', createdAt: now });
        ratifyLinks.push({ uid: m.uid, name: m.name || '', token });
      }
      batch.set(firestore.doc(`condos/${condoId}/consents/${m.uid}`), rec, { merge: true });
    }
    // Marca al titular como que completó el flujo (corta el modal en el próximo render).
    batch.set(firestore.collection('users').doc(req.user.uid),
      { consentVersion: v, consentAt: now }, { merge: true });
    await batch.commit();
    res.json({ ok: true, ratifyLinks });
  } catch (err) {
    console.error('[Consent accept] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consent/ratify — un adulto confirma (o rechaza) su propio consentimiento,
// agregando su nombre y RUT. Público: enlace con token de un solo uso.
app.post('/api/consent/ratify', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  const body = req.body || {};
  const token = String(body.token || '');
  const accept = body.accept !== false;
  const name = String(body.name || '').trim();
  const rut = String(body.rut || '').trim();
  if (!token) return res.status(400).json({ error: 'token requerido' });
  if (accept && (!name || !rut)) return res.status(400).json({ error: 'Nombre y RUT son obligatorios' });
  try {
    const tokRef = firestore.doc(`ratifyTokens/${token}`);
    const tok = await tokRef.get();
    if (!tok.exists) return res.status(404).json({ error: 'Enlace inválido o ya utilizado' });
    const { condoId, subjectUid, subjectName, createdAt } = tok.data();
    // TTL: los enlaces vencen a los 30 días (evita que un enlace filtrado sirva por siempre).
    const _createdMs = createdAt && createdAt.toMillis ? createdAt.toMillis() : 0;
    if (_createdMs && Date.now() - _createdMs > 30 * 24 * 3600 * 1000) {
      await tokRef.delete().catch(() => {});
      return res.status(410).json({ error: 'El enlace venció. Solicita uno nuevo al administrador.' });
    }
    const now = admin.firestore.Timestamp.now();
    const upd = accept
      ? { ratified: true, basis: 'ratified', biometric: true, ratifiedAt: now, rut, ratifiedName: name }
      : { biometric: false, ratified: true, basis: 'refused', ratifiedAt: now, rut, ratifiedName: name };
    if (name) upd.subjectName = name;
    await firestore.doc(`condos/${condoId}/consents/${subjectUid}`).set(upd, { merge: true });
    await tokRef.delete().catch(() => {});
    res.json({ ok: true, subjectName: name || subjectName, accepted: accept });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compliance/facial-consent — (super_admin) estado de autorización facial por
// condominio/unidad. Cruza las personas del DSS con facial (faceNum>0) contra los registros
// de consentimiento. Es la vista/exportable para fiscalización.
app.get('/api/compliance/facial-consent', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    if (!(prof.role === 'super_admin' || prof.condoScope === 'all')) return res.status(403).json({ error: 'sin permiso' });
    const _nn = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

    const force = !!req.query.refresh;   // ?refresh=1 → vuelve a leer del DSS sin caché
    const [persons, condosSnap, doorMap, tree] = await Promise.all([
      getDssPersonsCached(force), firestore.collection('condos').get(), getDoorChannelOrgMap(), getPersonOrgTree(force),
    ]);
    // Consentimientos (por subcolección de cada condo — evita índice de collectionGroup).
    // Se indexan por id de doc (=uid o dss_pid), por subjectDahuaPersonId y por nombre.
    const consentDocs = [];
    await Promise.all(condosSnap.docs.map(async c => {
      try { (await firestore.collection(`condos/${c.id}/consents`).get()).forEach(d => consentDocs.push({ id: d.id, ...d.data() })); }
      catch { /* condo sin consents */ }
    }));
    const byId = {}, byPid = {}, byName = {};
    consentDocs.forEach(x => {
      byId[x.id] = x;
      if (x.subjectDahuaPersonId) byPid[String(x.subjectDahuaPersonId)] = x;
      if (x.subjectName) byName[_nn(x.subjectName)] = x;
    });

    // El condominio de cada persona = nodo raíz de su rama en el ÁRBOL DE PERSONAS del DSS
    // (padre == "001"). Esto respeta jerarquías de profundidad variable (Quillay→Acceso→Depto,
    // Don Alberto→Torre A/B→depto, etc.) y elimina el "Sin condominio".
    // Mapeo del orgCode del condominio (nodo top) → condoId de Firestore (para reenvíos):
    //   por nombre (condo.name ≈ nodo top) y por canal del dispositivo → persona → nodo top.
    const topToCondoId = {};
    condosSnap.forEach(c => {
      const cd = c.data();
      const nameKey = normOrgName(cd.name || '');
      const hit = tree.topNodes.find(t => normOrgName(t.orgName) === nameKey);
      if (hit && !topToCondoId[hit.orgCode]) topToCondoId[hit.orgCode] = c.id;
      const chs = (cd.dahuaChannelIds || []).map(String);
      let dOrg = null;
      for (const ch of chs) { const n = doorMap.get(ch); if (n) { dOrg = n; break; } }
      if (dOrg) {
        const dKey = normOrgName(dOrg);
        const p = persons.find(pp => normOrgName(pp.orgName) === dKey);
        const tc = p ? tree.topCondo(p.orgCode) : null;
        if (tc && !topToCondoId[tc.orgCode]) topToCondoId[tc.orgCode] = c.id;
      }
    });
    // condoId (Firestore) → nombre del condominio en el árbol de personas (para ubicar los
    // residentes de la app en el mismo grupo que los del DSS y así deduplicar por condominio).
    const condoIdToName = {};
    for (const [orgCode, cid] of Object.entries(topToCondoId)) {
      const node = tree.topNodes.find(t => t.orgCode === orgCode);
      if (node && !condoIdToName[cid]) condoIdToName[cid] = node.orgName;
    }
    const condoNameById = {};
    condosSnap.forEach(c => { condoNameById[c.id] = c.data().name || ''; });

    const statusOf = (c) => {
      if (!c) return 'none';
      if (c.basis === 'refused' || c.biometric === false) return 'refused';
      if (!c.ratified) return 'pending';
      return 'authorized';
    };
    const tsSec = t => (t && (t._seconds ?? t.seconds)) || null;

    const groups = {};
    const summary = { totPersons: 0, totFacial: 0, totAuth: 0, totPend: 0, totRef: 0, totNone: 0 };
    const seenPid = new Set();          // dedup por personId del DSS
    const seenKey = new Set();          // dedup por condominio|nombre|unidad
    const nk = (condo, name, unit) => `${normOrgName(condo)}|${_nn(name)}|${normOrgName(unit)}`;
    const addPerson = (condoName, condoId, unit, entry) => {
      groups[condoName] = groups[condoName] || { condoId, units: {} };
      if (!groups[condoName].condoId && condoId) groups[condoName].condoId = condoId;
      (groups[condoName].units[unit] = groups[condoName].units[unit] || []).push(entry);
      summary.totPersons++;
      const st = entry.status;
      if (st === 'authorized') summary.totAuth++; else if (st === 'pending') summary.totPend++;
      else if (st === 'refused') summary.totRef++; else summary.totNone++;
    };

    // 1) Personas del DSS con facial.
    for (const p of persons) {
      if (!(p.faceNum > 0)) continue;
      summary.totFacial++;
      const tc = tree.topCondo(p.orgCode);
      const condoName = tc ? tc.orgName : 'Sin condominio';
      const condoId = tc ? (topToCondoId[tc.orgCode] || '') : '';
      const unit = p.orgName || '—';
      const cons = byPid[String(p.personId)] || byName[_nn(p.name)] || null;
      if (p.personId) seenPid.add(String(p.personId));
      seenKey.add(nk(condoName, p.name, unit));
      addPerson(condoName, condoId, unit, {
        name: p.name, dahuaPersonId: p.personId, condoId, unit, status: statusOf(cons),
        source: 'dss', hasFacial: true,
        acceptedByName: cons?.acceptedByName || '', basis: cons?.basis || '', acceptedAt: tsSec(cons?.acceptedAt || cons?.ratifiedAt),
      });
    }

    // 2) Residentes creados en la app (Firestore users), deduplicados contra el DSS
    //    por personId y por (condominio|nombre|unidad).
    try {
      const usersSnap = await firestore.collection('users').where('role', 'in', ['resident', 'usuario']).get();
      usersSnap.forEach(u => {
        const x = u.data();
        const condoName = condoIdToName[x.condoId] || condoNameById[x.condoId] || x.condoName || 'Sin condominio';
        const unit = x.unit || '—';
        if (x.dahuaPersonId && seenPid.has(String(x.dahuaPersonId))) return;  // ya está por el DSS
        if (seenKey.has(nk(condoName, x.name || '', unit))) return;            // ya está por nombre+unidad
        if (x.dahuaPersonId) seenPid.add(String(x.dahuaPersonId));
        seenKey.add(nk(condoName, x.name || '', unit));
        const cons = byId[u.id] || byPid[String(x.dahuaPersonId || '')] || byName[_nn(x.name || '')] || null;
        addPerson(condoName, x.condoId || '', unit, {
          name: x.name || x.displayName || 'Residente', dahuaPersonId: x.dahuaPersonId || null, uid: u.id,
          condoId: x.condoId || '', unit, status: statusOf(cons), source: 'app', hasFacial: false,
          acceptedByName: cons?.acceptedByName || '', basis: cons?.basis || '', acceptedAt: tsSec(cons?.acceptedAt || cons?.ratifiedAt),
        });
      });
    } catch (e) { console.warn('[Compliance] users merge:', e.message); }
    const condos = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([condoName, g]) => ({
      condoName, condoId: g.condoId,
      units: Object.entries(g.units).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([unit, ppl]) => ({ unit, persons: ppl.sort((a, b) => a.name.localeCompare(b.name)) })),
    }));
    res.json({ summary, condos });
  } catch (err) {
    console.error('[Compliance] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consent/resend — (super_admin) genera un nuevo enlace de autorización para una
// persona (aún sin autorizar o para re-autorizar). Devuelve el token del enlace /ratify/:token.
app.post('/api/consent/resend', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  const { condoId, dahuaPersonId, uid, name } = req.body || {};
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    if (!(prof.role === 'super_admin' || prof.condoScope === 'all')) return res.status(403).json({ error: 'sin permiso' });
    // Los residentes creados en la app aún no tienen dahuaPersonId; se identifican por su uid.
    if (!condoId || (!dahuaPersonId && !uid)) return res.status(400).json({ error: 'condoId y (dahuaPersonId o uid) requeridos' });
    const now = admin.firestore.Timestamp.now();
    const token = crypto.randomBytes(18).toString('hex');
    const key = dahuaPersonId ? `dss_${dahuaPersonId}` : String(uid);
    await firestore.doc(`condos/${condoId}/consents/${key}`).set({
      subjectName: name || '',
      subjectDahuaPersonId: dahuaPersonId ? String(dahuaPersonId) : null,
      subjectUid: dahuaPersonId ? null : String(uid),
      condoId, relation: 'adult', basis: 'pending', biometric: false, ratified: false,
      ratifyToken: token, resentByUid: req.user.uid, resentAt: now,
    }, { merge: true });
    await firestore.doc(`ratifyTokens/${token}`).set({ condoId, subjectUid: key, subjectName: name || '', createdAt: now });
    res.json({ ok: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consent/reset — (super_admin) restablece a "sin autorización" borrando el registro
// de consentimiento de la persona (útil si alguien rechazó por error). Luego puede re-autorizar.
app.post('/api/consent/reset', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  const { condoId, dahuaPersonId, uid, name } = req.body || {};
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    if (!(prof.role === 'super_admin' || prof.condoScope === 'all')) return res.status(403).json({ error: 'sin permiso' });
    if (!condoId) return res.status(400).json({ error: 'condoId requerido' });
    const col = firestore.collection(`condos/${condoId}/consents`);
    const toDelete = new Map();
    if (dahuaPersonId) {
      (await col.where('subjectDahuaPersonId', '==', String(dahuaPersonId)).get()).forEach(d => toDelete.set(d.id, d));
      const k = await col.doc(`dss_${dahuaPersonId}`).get(); if (k.exists) toDelete.set(k.id, k);
    }
    if (uid) { const k = await col.doc(String(uid)).get(); if (k.exists) toDelete.set(k.id, k); }
    if (name) (await col.where('subjectName', '==', name).get()).forEach(d => toDelete.set(d.id, d));

    // Usuarios de la app a los que hay que LIMPIAR consentVersion → así el modal de
    // consentimiento vuelve a aparecer la próxima vez que entren a la app.
    const _nn = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    const uidsToReset = new Set();
    // (a) docs de consentimiento cuyo id es un uid de app (no 'dss_...').
    toDelete.forEach(d => { if (!String(d.id).startsWith('dss_')) uidsToReset.add(d.id); });
    // (b) usuarios de la app que coincidan por dahuaPersonId o por nombre en el condominio.
    try {
      const us = await firestore.collection('users').where('condoId', '==', condoId).get();
      us.forEach(u => {
        const x = u.data();
        if ((dahuaPersonId && String(x.dahuaPersonId) === String(dahuaPersonId)) || (name && _nn(x.name) === _nn(name))) {
          uidsToReset.add(u.id);
        }
      });
    } catch { /* no bloquea */ }

    const batch = firestore.batch();
    toDelete.forEach(d => {
      const tok = d.data()?.ratifyToken;
      if (tok) batch.delete(firestore.doc(`ratifyTokens/${tok}`));
      batch.delete(d.ref);
    });
    // consentVersion:0 → menor que la versión vigente → reaparece el modal al reingresar.
    uidsToReset.forEach(uid => batch.set(firestore.collection('users').doc(uid), { consentVersion: 0 }, { merge: true }));
    await batch.commit();
    res.json({ ok: true, deleted: toDelete.size, usersReset: uidsToReset.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Derechos del titular (H-07, Ley 21.719) — acceso, portabilidad, rectificación,
// eliminación, oposición. Todo mediado por el servidor (Admin SDK).
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/me/data — compila los datos personales del solicitante (acceso/portabilidad).
// POST /api/me/migrate — enlaza la ficha pre-registrada (buscada por email) al uid del usuario.
// Reemplaza la migración que hacía el navegador escribiendo users/{uid} directo: las reglas ya no
// permiten que el dueño cree su propia ficha con rol de staff. Misma selección determinista que useAuth.
app.post('/api/me/migrate', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore(); const uid = req.user.uid;
  const emailLc = String(req.user.email || '').trim().toLowerCase();
  try {
    const propio = await firestore.collection('users').doc(uid).get();
    if (propio.exists) return res.json({ ok: true, migrated: false });
    if (!emailLc) return res.status(404).json({ error: 'Sin ficha' });
    const snap = await firestore.collection('users').where('email', '==', emailLc).get();
    if (snap.empty) return res.status(404).json({ error: 'Sin ficha' });
    const nKeys = (d) => Object.keys(d.data() || {}).length;
    const docs = snap.docs;
    const src = [...docs].sort((a, b) =>
      nKeys(b) - nKeys(a) ||
      ((a.data().createdAt?.seconds ?? 0) - (b.data().createdAt?.seconds ?? 0)) ||
      (a.id < b.id ? -1 : 1))[0];
    await firestore.collection('users').doc(uid).set({ ...src.data(), uid, updatedAt: admin.firestore.Timestamp.now() });
    if (docs.length === 1 && src.id !== uid) await src.ref.delete().catch(() => {});
    console.log(`[Auth] ficha enlazada por email → ${uid} (${src.data().role || 'sin rol'})`);
    res.json({ ok: true, migrated: true });
  } catch (err) {
    console.error('[me/migrate]', err.message);
    res.status(500).json({ error: 'No se pudo enlazar la ficha' });
  }
});

app.get('/api/me/data', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore(); const uid = req.user.uid;
  try {
    const prof = (await firestore.collection('users').doc(uid).get()).data() || {};
    const condoId = prof.condoId || '';
    const out = {
      exportadoEl: new Date().toISOString(),
      perfil: {
        nombre: prof.name || prof.displayName || '', rut: prof.rut || '', email: prof.email || '',
        telefono: prof.phone || '', unidad: prof.unit || '', condominio: prof.condoName || '', rol: prof.role || '',
      },
      consentimiento: null, pases: [], reservas: [], accesos: [],
    };
    if (condoId) {
      const cs = await firestore.doc(`condos/${condoId}/consents/${uid}`).get();
      if (cs.exists) out.consentimiento = cs.data();
      const vis = await firestore.collection(`condos/${condoId}/visitors`).where('userId', '==', uid).limit(300).get().catch(() => ({ forEach() {} }));
      vis.forEach(d => { const v = d.data(); out.pases.push({ visitante: v.visitorName, fecha: v.date, estado: v.status, patente: v.licensePlate || '' }); });
      const rv = await firestore.collection(`condos/${condoId}/reservations`).where('userId', '==', uid).limit(300).get().catch(() => ({ forEach() {} }));
      rv.forEach(d => { const r = d.data(); out.reservas.push({ instalacion: r.facilityName, fecha: r.date, horario: `${r.startTime || ''}-${r.endTime || ''}`, estado: r.status }); });
      const ac = await firestore.collection(`condos/${condoId}/accessEvents`).where('residentUid', '==', uid).limit(300).get().catch(() => ({ forEach() {} }));
      ac.forEach(d => { const a = d.data(); out.accesos.push({ fecha: a.date, hora: a.time, direccion: a.direction, punto: a.pointName }); });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/me/rights-request { type, message } — el titular ejerce un derecho.
app.post('/api/me/rights-request', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore(); const uid = req.user.uid;
  const { type, message } = req.body || {};
  const allowed = ['acceso', 'rectificacion', 'eliminacion', 'oposicion', 'portabilidad'];
  if (!allowed.includes(type)) return res.status(400).json({ error: 'tipo inválido' });
  try {
    const prof = (await firestore.collection('users').doc(uid).get()).data() || {};
    const ref = await firestore.collection('rightsRequests').add({
      userId: uid, userName: prof.name || '', email: prof.email || '',
      condoId: prof.condoId || '', condoName: prof.condoName || '', unit: prof.unit || '',
      type, message: String(message || '').slice(0, 2000), status: 'pending',
      createdAt: admin.firestore.Timestamp.now(),
    });
    res.json({ ok: true, id: ref.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/me/requests — solicitudes propias del titular.
app.get('/api/me/requests', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  try {
    const snap = await firestore.collection('rightsRequests').where('userId', '==', req.user.uid).limit(50).get();
    const list = snap.docs.map(d => { const x = d.data(); return { id: d.id, type: x.type, status: x.status, message: x.message, note: x.note || '', createdAt: x.createdAt?._seconds ?? x.createdAt?.seconds ?? null }; });
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ requests: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rights-requests — (super_admin / condo_admin) bandeja de solicitudes.
app.get('/api/rights-requests', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    const isGlobal = prof.role === 'super_admin' || prof.condoScope === 'all';
    if (!isGlobal && !['condo_admin', 'administrador'].includes(prof.role)) return res.status(403).json({ error: 'sin permiso' });
    const snap = await firestore.collection('rightsRequests').get();
    let list = snap.docs.map(d => { const x = d.data(); return { id: d.id, ...x, createdAt: x.createdAt?._seconds ?? x.createdAt?.seconds ?? null, resolvedAt: x.resolvedAt?._seconds ?? x.resolvedAt?.seconds ?? null }; });
    if (!isGlobal) { const ids = new Set([prof.condoId, ...(prof.condoIds || [])].filter(Boolean)); list = list.filter(r => ids.has(r.condoId)); }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ requests: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rights-requests/:id/resolve { status, note } — resolver/rechazar.
app.post('/api/rights-requests/:id/resolve', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    const isGlobal = prof.role === 'super_admin' || prof.condoScope === 'all';
    if (!isGlobal && !['condo_admin', 'administrador'].includes(prof.role)) return res.status(403).json({ error: 'sin permiso' });
    const { status, note } = req.body || {};
    if (!['resolved', 'rejected'].includes(status)) return res.status(400).json({ error: 'estado inválido' });
    await firestore.collection('rightsRequests').doc(req.params.id).set(
      { status, note: String(note || '').slice(0, 1000), resolvedBy: prof.name || '', resolvedAt: admin.firestore.Timestamp.now() }, { merge: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/incidents/breach-notify — notifica una posible BRECHA de datos (Ley 21.719).
// Riesgo alto: notificación en la app a los super_administradores.
app.post('/api/incidents/breach-notify', requireAuth, requireRole(['condo_admin', 'administrador', 'operator', 'technician']), async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  const { title, condoName } = req.body || {};
  try {
    const sa = await firestore.collection('users').where('role', '==', 'super_admin').get();
    await Promise.all(sa.docs.map(d => addNotification(d.id, {
      title: '⚠️ Posible brecha de datos', message: `${condoName || ''}: ${title || ''}`, type: 'incident', link: '/incidents',
    })));
    res.json({ ok: true, notified: sa.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/access?days=30  (solo super_admin)
// Estadísticas de ingresos por hora, día de semana, condominio y tipo
// (QR / operador / residente-automático). Lee de Firestore (no del DSS). Caché 30 min.
const _statsCache = new Map();
const STATS_TTL = 30 * 60 * 1000;
app.get('/api/stats/access', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  try {
    const prof = (await firestore.collection('users').doc(req.user.uid).get()).data() || {};
    const isGlobal = prof.role === 'super_admin' || prof.condoScope === 'all';
    // super_admin / scope 'all' ven todos; condo_admin y administrador solo sus condominios.
    if (!isGlobal && !['condo_admin', 'administrador'].includes(prof.role)) {
      return res.status(403).json({ error: 'sin permiso' });
    }

    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const now = Math.floor(Date.now() / 1000);
    const startTs = now - days * 86400;
    const cutoffDate = new Date(startTs * 1000).toISOString().slice(0, 10);
    const condosSnap = await firestore.collection('condos').get();
    const cnameById = {}; condosSnap.forEach(d => { cnameById[d.id] = d.data().name || d.id; });
    let condoIds;
    if (isGlobal) {
      condoIds = condosSnap.docs.map(d => d.id);
    } else {
      condoIds = [];
      if (prof.condoId) condoIds.push(prof.condoId);
      (prof.condoIds || []).forEach(id => condoIds.push(id));
      condoIds = [...new Set(condoIds)];
    }

    // Caché por alcance (para no mezclar datos entre super_admin y cada administrador).
    const cacheKey = `stats-${days}-${isGlobal ? 'all' : condoIds.slice().sort().join('.')}`;
    const cached = _statsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < STATS_TTL) return res.json({ ...cached.data, fromCache: true });

    const mk = () => ({ qr: 0, operator: 0, resident: 0 });
    const byHour = Array.from({ length: 24 }, mk);
    const byDow  = Array.from({ length: 7 }, mk);   // 0 = domingo
    const byCondo = {};
    const byDate  = {};
    const totals  = mk();
    const dowOf = (dstr) => { const d = new Date(dstr + 'T12:00:00Z'); return isNaN(d) ? 0 : d.getUTCDay(); };
    const add = (cat, hour, dstr, condo) => {
      totals[cat]++;
      if (hour >= 0 && hour < 24) byHour[hour][cat]++;
      const dw = dowOf(dstr); byDow[dw][cat]++;
      const c = byCondo[condo] || (byCondo[condo] = { qr: 0, operator: 0, resident: 0, total: 0 });
      c[cat]++; c.total++;
      const dd = byDate[dstr] || (byDate[dstr] = { qr: 0, operator: 0, resident: 0 });
      dd[cat]++;
    };

    await Promise.all(condoIds.map(async cid => {
      // Accesos automáticos de residentes (accessEvents con residentUid).
      try {
        const snap = await firestore.collection(`condos/${cid}/accessEvents`).where('ts', '>=', startTs).get();
        snap.forEach(d => { const x = d.data(); if (x.residentUid && x.date && x.time) add('resident', parseInt(String(x.time).slice(0, 2), 10), x.date, cnameById[cid] || cid); });
      } catch (e) { /* skip */ }
      // Pases usados: QR (manualEntry=false) u operador (manualEntry=true).
      try {
        const vs = await firestore.collection(`condos/${cid}/visitors`).where('date', '>=', cutoffDate).get();
        vs.forEach(d => { const v = d.data(); if (v.status !== 'entered' && v.status !== 'exited') return; const cat = v.manualEntry ? 'operator' : 'qr'; const hh = parseInt(String(v.entryTime || '12:00').slice(0, 2), 10) || 0; add(cat, hh, v.date, cnameById[cid] || cid); });
      } catch (e) { /* skip */ }
    }));

    const topCondos = Object.entries(byCondo).map(([name, c]) => ({ name, ...c })).sort((a, b) => b.total - a.total);
    const data = { days, totals, byHour, byDow, topCondos, byDate, generatedAt: Date.now() };
    _statsCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    console.error('[Stats] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers de autorización para endpoints admin (rol / condominio) ───────────
async function callerProfile(req) {
  try { return (await admin.firestore().collection('users').doc(req.user.uid).get()).data() || {}; }
  catch { return {}; }
}
function callerIsSuper(p) { return !!p && (p.role === 'super_admin' || p.condoScope === 'all'); }
function callerHasCondo(p, condoId) {
  if (!p) return false;
  if (callerIsSuper(p)) return true;
  if (!condoId) return false;
  return p.condoId === condoId || (Array.isArray(p.condoIds) && p.condoIds.includes(condoId));
}
// Middleware de rol: super_admin (o condoScope='all') siempre pasa; además los roles
// indicados. requireRole([]) = solo super_admin. Usar tras requireAuth.
function requireRole(roles) {
  return async (req, res, next) => {
    try {
      const p = await callerProfile(req);
      if (callerIsSuper(p) || (p.role && roles.includes(p.role))) return next();
    } catch { /* cae a 403 */ }
    return res.status(403).json({ error: 'Sin permiso' });
  };
}

// Mapa canal DSS → condoId (desde condos.dahuaChannelIds). Cacheado 5 min.
let _channelCondoCache = null;
async function getChannelCondoMap() {
  if (_channelCondoCache && Date.now() - _channelCondoCache.ts < 5 * 60 * 1000) return _channelCondoCache.map;
  const map = new Map();
  try {
    const snap = await admin.firestore().collection('condos').get();
    snap.forEach(c => (c.data().dahuaChannelIds || []).forEach(ch => map.set(String(ch), c.id)));
  } catch { if (_channelCondoCache) return _channelCondoCache.map; }
  _channelCondoCache = { ts: Date.now(), map };
  return map;
}
async function userCanUseChannel(prof, channelId) {
  if (callerIsSuper(prof)) return true;
  const condoId = (await getChannelCondoMap()).get(String(channelId));
  return condoId ? callerHasCondo(prof, condoId) : false;
}

// POST /api/users/create  { name, email, password, role, condoId, condoName, ...extras }
// Creates a Firebase Auth user + Firestore profile. Requires Firebase Admin.
app.post('/api/users/create', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { name, email, password, role, condoId, condoName, jobTitle, shift, phone, condoIds, condoScope, unit } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'name, email and password are required' });

  // Autorización: solo super_admin (o condo_admin acotado a su condominio, sin crear admins).
  const _prof = await callerProfile(req);
  const _isSA = callerIsSuper(_prof);
  if (!_isSA && _prof.role !== 'condo_admin') return res.status(403).json({ error: 'Sin permiso' });
  const _newRole = role || 'operator';
  if (!_isSA) {
    if (['super_admin', 'condo_admin'].includes(_newRole) || condoScope === 'all')
      return res.status(403).json({ error: 'No puede crear administradores ni asignar alcance global' });
    if (!callerHasCondo(_prof, condoId)) return res.status(403).json({ error: 'Fuera de su condominio' });
  }

  // Normalizar email a minúsculas: Firebase Auth lo guarda en minúsculas y la migración
  // de perfil busca por email exacto (case-sensitive). Guardar mixto rompía el login.
  const emailLc = String(email).trim().toLowerCase();
  try {
    // La cuenta puede existir en Auth SIN ficha en Firestore: pasa cuando la persona
    // entró alguna vez con "Continuar con Google" — Firebase crea el usuario pero no
    // el perfil. Esa cuenta no aparece en la lista (se arma desde Firestore), así que
    // el admin no la puede editar ni borrar, pero el correo queda tomado y crear el
    // usuario fallaba con "El email ya está en uso" sin salida posible por la interfaz.
    // En ese caso se adopta el uid existente y se le aplica la clave, igual que hace
    // /api/users/set-credentials con los residentes. Si ya hay ficha (bajo ese uid o
    // bajo otro con el mismo email) es un duplicado de verdad y se mantiene el error.
    let userRecord, adopted = false;
    try {
      userRecord = await admin.auth().createUser({ email: emailLc, password, displayName: name });
    } catch (e) {
      if (e.code !== 'auth/email-already-exists') throw e;
      userRecord = await admin.auth().getUserByEmail(emailLc);
      const [porUid, porEmail] = await Promise.all([
        admin.firestore().collection('users').doc(userRecord.uid).get(),
        admin.firestore().collection('users').where('email', '==', emailLc).limit(1).get(),
      ]);
      if (porUid.exists || !porEmail.empty) return res.status(409).json({ error: 'El email ya está en uso' });
      await admin.auth().updateUser(userRecord.uid, { password, displayName: name });
      adopted = true;
      console.log(`[users/create] cuenta huérfana adoptada: ${emailLc} (uid ${userRecord.uid})`);
    }
    const profile = Object.assign(
      { name, email: emailLc, role: role || 'operator', condoId: condoId || '', condoName: condoName || '', status: 'active', createdAt: admin.firestore.Timestamp.now() },
      jobTitle   && { jobTitle },
      shift      && { shift },
      phone      && { phone },
      condoIds   && { condoIds },
      condoScope && { condoScope },
      unit       && { unit },
    );
    await admin.firestore().collection('users').doc(userRecord.uid).set(profile);
    res.json({ uid: userRecord.uid, adopted });
  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/email-already-exists') return res.status(409).json({ error: 'El email ya está en uso' });
    if (code === 'auth/invalid-email')        return res.status(400).json({ error: 'Email inválido' });
    if (code === 'auth/weak-password')        return res.status(400).json({ error: 'Contraseña muy débil (mínimo 6 caracteres)' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/delete  { uid }
app.post('/api/users/delete', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid is required' });
  // Autorización: super_admin, o condo_admin sobre un usuario NO-admin de su condominio.
  const _prof = await callerProfile(req);
  if (!callerIsSuper(_prof)) {
    if (_prof.role !== 'condo_admin') return res.status(403).json({ error: 'Sin permiso' });
    const _t = (await admin.firestore().collection('users').doc(uid).get()).data() || {};
    if (['super_admin', 'condo_admin'].includes(_t.role) || !callerHasCondo(_prof, _t.condoId))
      return res.status(403).json({ error: 'Sin permiso sobre este usuario' });
  }
  try {
    await admin.auth().deleteUser(uid);
    await admin.firestore().collection('users').doc(uid).delete().catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/user-not-found') {
      await admin.firestore().collection('users').doc(uid).delete().catch(() => {});
      return res.json({ ok: true });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/update-password  { uid, password }
app.post('/api/users/update-password', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { uid, password } = req.body || {};
  if (!uid || !password) return res.status(400).json({ error: 'uid and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña muy débil (mínimo 6 caracteres)' });
  // Autorización: super_admin, o condo_admin sobre un usuario NO-admin de su condominio.
  const _prof = await callerProfile(req);
  if (!callerIsSuper(_prof)) {
    if (_prof.role !== 'condo_admin') return res.status(403).json({ error: 'Sin permiso' });
    const _t = (await admin.firestore().collection('users').doc(uid).get()).data() || {};
    if (['super_admin', 'condo_admin'].includes(_t.role) || !callerHasCondo(_prof, _t.condoId))
      return res.status(403).json({ error: 'Sin permiso sobre este usuario' });
  }
  try {
    await admin.auth().updateUser(uid, { password });
    res.json({ ok: true });
  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/user-not-found') return res.status(404).json({ error: 'Usuario no encontrado en Firebase Auth' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/set-credentials  { email, password, name?, condoId? }
// Asigna la clave a la cuenta Auth de un email de RESIDENTE: crea la cuenta si no
// existe, o actualiza la clave si ya existe (p.ej. la persona entró antes con
// Google, o quedó una cuenta de un intento anterior). Reemplaza la creación de
// cuentas desde el navegador en Residentes: allí un "email ya registrado" fallaba
// EN SILENCIO (console.warn) — la ficha se guardaba, el admin veía éxito y la
// clave nunca quedaba aplicada. Devuelve el uid real para sanear fichas sin uid.
app.post('/api/users/set-credentials', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { email, password, name, condoId } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Contraseña muy débil (mínimo 6 caracteres)' });
  const emailLc = String(email).trim().toLowerCase();

  // Autorización: staff que gestiona residentes, acotado a su condominio.
  const _prof = await callerProfile(req);
  const _isSA = callerIsSuper(_prof);
  if (!_isSA && !['condo_admin', 'administrador', 'operator'].includes(_prof.role))
    return res.status(403).json({ error: 'Sin permiso' });

  try {
    // Las fichas existentes con ese email definen el rol y condominio del objetivo.
    const fichas = await admin.firestore().collection('users').where('email', '==', emailLc).get();
    if (!_isSA) {
      const objetivos = fichas.docs.map(d => d.data());
      // Nunca cambiar la clave de una cuenta de administración desde un rol menor.
      if (objetivos.some(t => ['super_admin', 'condo_admin', 'administrador'].includes(t.role)))
        return res.status(403).json({ error: 'Sin permiso sobre este usuario' });
      // El operador solo gestiona residentes (no otros operadores ni técnicos).
      if (_prof.role === 'operator' && objetivos.some(t => !['resident', 'usuario'].includes(t.role)))
        return res.status(403).json({ error: 'Sin permiso sobre este usuario' });
      // Alcance: el condominio de la ficha si existe; si es ficha nueva, el del formulario.
      const scopeOk = objetivos.length
        ? objetivos.some(t => callerHasCondo(_prof, t.condoId))
        : callerHasCondo(_prof, condoId);
      if (!scopeOk) return res.status(403).json({ error: 'Fuera de su condominio' });
    }

    let userRecord, created = false;
    try {
      userRecord = await admin.auth().getUserByEmail(emailLc);
      await admin.auth().updateUser(
        userRecord.uid,
        Object.assign({ password }, name && !userRecord.displayName ? { displayName: name } : {}),
      );
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
      userRecord = await admin.auth().createUser(
        Object.assign({ email: emailLc, password }, name ? { displayName: name } : {}),
      );
      created = true;
    }
    res.json({ uid: userRecord.uid, created });
  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/invalid-email') return res.status(400).json({ error: 'Email inválido' });
    if (code === 'auth/invalid-password' || code === 'auth/weak-password')
      return res.status(400).json({ error: 'Contraseña muy débil (mínimo 6 caracteres)' });
    res.status(500).json({ error: err.message });
  }
});

// ── Sincronización de residentes desde PVCRM (formulario público) ──────────────
const PVCRM_API_KEY = process.env.PVCRM_API_KEY || '';
function requirePvcrmKey(req, res, next) {
  if (!PVCRM_API_KEY || req.headers['x-api-key'] !== PVCRM_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/residents/bulk — crea/ubica el condominio y carga residentes (solo Firestore).
// Los residentes quedan en 'users' (role resident, status pending) para que el operador
// los revise, asocie las puertas reales y cargue las fotos a Dahua. Idempotente.
app.post('/api/residents/bulk', requirePvcrmKey, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const db = admin.firestore();
  const { condoName, unitType, requestId, residents } = req.body || {};
  if (!condoName || !Array.isArray(residents) || residents.length === 0) {
    return res.status(400).json({ error: 'condoName y residents son requeridos' });
  }
  try {
    const condoNameClean = String(condoName).trim();
    const wanted = condoNameClean.toLowerCase();
    const condosSnap = await db.collection('condos').get();
    let condoDoc = condosSnap.docs.find(d => String(d.data().name || '').trim().toLowerCase() === wanted);
    let condoId, condoCreated = false;
    if (condoDoc) {
      condoId = condoDoc.id;
    } else {
      const ref = await db.collection('condos').add({
        name: condoNameClean,
        unitType: unitType || 'DEPTO',
        source: 'pvcrm-resident-form',
        createdAt: admin.firestore.Timestamp.now(),
      });
      condoId = ref.id;
      condoCreated = true;
    }

    let created = 0, skipped = 0;
    for (const r of residents) {
      const nombre = String(r.nombre || '').trim();
      if (!nombre) continue;
      const unit = String(r.unit || '').trim();
      const syncKey = `${requestId || ''}|${unit}|${nombre.toLowerCase()}`;
      const dup = await db.collection('users').where('residentSyncKey', '==', syncKey).limit(1).get();
      if (!dup.empty) { skipped++; continue; }
      const plates = String(r.patentes || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      await db.collection('users').add({
        name: nombre,
        displayName: nombre,
        email: String(r.email || '').trim().toLowerCase(),
        phone: String(r.telefono || '').trim(),
        unit,
        condoId,
        condoName: condoNameClean,
        role: 'resident',
        status: 'Pendiente',
        plates,
        canGenerateQR: r.qrPass === true,
        hasFacilityAccess: true,
        photoUrl: String(r.photoUrl || '').trim(),
        requestedDoors: Array.isArray(r.doors) ? r.doors.map(String) : [],
        extra: r.extra && typeof r.extra === 'object' ? r.extra : {},
        residentSyncKey: syncKey,
        source: 'pvcrm-resident-form',
        createdAt: admin.firestore.Timestamp.now(),
      });
      created++;
    }
    res.json({ ok: true, condoId, condoCreated, created, skipped });
  } catch (err) {
    console.error('[residents/bulk] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/door/open  { channelId: "1000649$7$0$1" }
// Opens a door using the server-managed DSS token (no browser session required).
app.post('/api/door/open', requireAuth, async (req, res) => {
  const { channelId } = req.body || {};
  if (!channelId) return res.status(400).json({ error: 'channelId required' });
  if (!DAHUA_HOST) return res.status(503).json({ error: 'DAHUA_HOST not configured' });

  // Acote por condominio: el canal debe pertenecer a un condominio del usuario (IDOR).
  const _prof = await callerProfile(req);
  if (!(await userCanUseChannel(_prof, channelId))) return res.status(403).json({ error: 'Canal fuera de su condominio' });

  // Ensure we have a valid token
  if (!_pollerToken) {
    _pollerToken = await pollerDssLogin();
    if (!_pollerToken) return res.status(503).json({ error: 'No DSS session available' });
  }

  try {
    const r = await dssRequest('POST', '/obms/api/v1.0/accessControl/door/control',
      { status: '1', channelId }, { 'X-Subject-Token': _pollerToken });

    if (r.body?.code === 2003 || r.body?.code === 401) {
      // Token expired — re-login once and retry
      _pollerToken = await pollerDssLogin();
      if (!_pollerToken) return res.status(503).json({ error: 'DSS re-login failed' });
      const retry = await dssRequest('POST', '/obms/api/v1.0/accessControl/door/control',
        { status: '1', channelId }, { 'X-Subject-Token': _pollerToken });
      if (retry.body?.code !== 1000) return res.status(502).json({ error: 'Door open failed', detail: retry.body });
      return res.json({ ok: true });
    }

    if (r.body?.code !== 1000) return res.status(502).json({ error: 'Door open failed', detail: r.body });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Server-side DSS visitor management ───────────────────────────────────────
// These endpoints handle DSS visitor CRUD entirely server-side, so the browser
// never needs to manage a DSS session token. Avoids session conflicts between
// the browser token and the background poller token.

// Ventana de "settle": segundos que el sistema tarda en distribuir la credencial
// QR a los lectores físicos tras crear el pase. Confirmado empíricamente que un
// escaneo antes de este tiempo puede no abrir (el lector aún no tiene el QR).
const QR_SYNC_SETTLE_SEC = 180;

// POST /api/dahua/visitor/create
app.post('/api/dahua/visitor/create', requireAuth, async (req, res) => {
  if (!DAHUA_HOST) return res.status(503).json({ error: 'Dahua not configured' });
  const { visitorName, hostName = 'Portería Virtual', phone = '', plate = '', startTs, endTs, acsChannelIds, positionIds } = req.body || {};
  if (!visitorName || !Array.isArray(acsChannelIds) || !acsChannelIds.length || !startTs || !endTs) {
    return res.status(400).json({ error: 'visitorName, acsChannelIds, startTs, endTs required' });
  }
  // Acote por condominio: todos los canales del pase deben pertenecer a un condominio
  // del usuario (evita emitir un QR que abre puertas de otro condominio).
  const _prof = await callerProfile(req);
  if (!callerIsSuper(_prof)) {
    const _chMap = await getChannelCondoMap();
    const _ok = acsChannelIds.map(String).every(ch => { const cid = _chMap.get(ch); return cid && callerHasCondo(_prof, cid); });
    if (!_ok) return res.status(403).json({ error: 'Canales fuera de su condominio' });
  }
  try {
    // Drop orphan channel IDs (stored in Firestore but no longer in DSS) — DSS
    // rejects the whole request with code 1004 if even one ID is invalid.
    const valid = await getValidAccessChannelIds().catch(() => null);
    let filteredAcsChannelIds = acsChannelIds.map(String);
    if (valid) {
      const before = filteredAcsChannelIds.length;
      filteredAcsChannelIds = filteredAcsChannelIds.filter(id => valid.has(id));
      const dropped = before - filteredAcsChannelIds.length;
      if (dropped > 0) console.warn(`[DSS visitor/create] filtered ${dropped} orphan channel ID(s)`);
    }
    if (filteredAcsChannelIds.length === 0) {
      return res.status(400).json({ error: 'all provided acsChannelIds are invalid in DSS' });
    }

    // Generate passport
    const p = await dssAuthed('GET', '/obms/api/v1.0/visitors/visitor/passport/generate', null);
    if (p.body?.code !== 1000 || !p.body?.data?.qrcode) {
      throw new Error('generatePassport failed: ' + JSON.stringify(p.body));
    }
    const { qrcode, passportCardNo } = p.body.data;

    // Create visitor appointment
    const body = {
      status: '0', visitorName, visitedName: hostName, visitedEmail: '',
      idType: '0', idNum: '', tel: phone || '', email: '',
      expectArrivalTime: String(dssInicioConTolerancia(startTs)), expectLeaveTime: String(endTs),
      // La patente NO se registra en el visitante (no abre barrera y bloquearía el
      // registro en parking que sí la baja al lector). Se maneja vía persona de parking.
      plateNo: '', reason: 'Invitación', remark: 'vía API',
      authInfo: { qrcode, passportCardNo, facePictures: [], idPicture: '' },
      rightInfo: {
        inheritVisitedAuthority: '0',
        acsChannelIds: filteredAcsChannelIds,
        vtoChannelIds: [],
        // positionIds = puntos de "Entrada/Salida" vehiculares (barreras ANPR).
        // Necesario para que la PATENTE del visitante funcione en esas barreras.
        positionIds: Array.isArray(positionIds) ? positionIds.map(String) : [],
        liftChannels: [],
      },
    };
    let v = await dssAuthed('POST', '/obms/api/v1.0/visitors/visitor', body);

    // Code 1004 after pre-filter → cache may be stale. Refresh and retry once.
    if (v.body?.code === 1004) {
      console.warn('[DSS visitor/create] code 1004 after filter — refreshing channel cache and retrying');
      const fresh = await getValidAccessChannelIds(true).catch(() => null);
      if (fresh) {
        body.rightInfo.acsChannelIds = filteredAcsChannelIds.filter(id => fresh.has(id));
        if (body.rightInfo.acsChannelIds.length === 0) {
          throw new Error('createVisitor failed: all channels invalid after refresh');
        }
        v = await dssAuthed('POST', '/obms/api/v1.0/visitors/visitor', body);
      }
    }
    // Code 10004 → duplicate plate already registered in DSS (previous appointment
    // still active). Retry without the plate so the visitor still gets a QR.
    let plateStripped = false;
    if (v.body?.code === 10004 && body.plateNo) {
      console.warn('[DSS visitor/create] code 10004 — duplicate plate, retrying without plateNo');
      body.plateNo = '';
      v = await dssAuthed('POST', '/obms/api/v1.0/visitors/visitor', body);
      plateStripped = true;
    }
    if (v.body?.code !== 1000) throw new Error('createVisitor failed: ' + JSON.stringify(v.body));

    const { visitorId, personId } = v.body.data ?? {};
    const qrReadyAt = Math.floor(Date.now() / 1000) + QR_SYNC_SETTLE_SEC;
    res.json({ visitorId, personId, qrcode, passportCardNo, qrReadyAt, ...(plateStripped && { plateStripped: true }) });
  } catch (err) {
    console.error('[DSS visitor/create]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/dahua/visitor/delete  { visitorId }
app.post('/api/dahua/visitor/delete', requireAuth, async (req, res) => {
  if (!DAHUA_HOST) return res.status(503).json({ error: 'Dahua not configured' });
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
  try {
    if (!(await puedeOperarPaseDss(await callerProfile(req), req.user.uid, String(visitorId)))) {
      return res.status(403).json({ error: 'Pase no encontrado o sin permiso' });
    }
    const r = await dssAuthed('POST', '/obms/api/v1.0/visitors/visitor/overdue/clear', { visitorIds: [visitorId] });
    if (r.body?.code !== 1000 && r.body?.code !== 1007) {
      throw new Error('deleteVisitor failed: ' + JSON.stringify(r.body));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[DSS visitor/delete]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/dahua/visitor/terminate  { visitorId }
app.post('/api/dahua/visitor/terminate', requireAuth, async (req, res) => {
  if (!DAHUA_HOST) return res.status(503).json({ error: 'Dahua not configured' });
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
  try {
    if (!(await puedeOperarPaseDss(await callerProfile(req), req.user.uid, String(visitorId)))) {
      return res.status(403).json({ error: 'Pase no encontrado o sin permiso' });
    }
    const r = await dssAuthed('POST', '/obms/api/v1.0/visitors/visitor/leave', { visitorId });
    // code 1000 = success; 1007 = not in arrived state (ok to ignore)
    if (r.body?.code !== 1000 && r.body?.code !== 1007) {
      console.info('[DSS visitor/terminate] no-op:', r.body?.code, r.body?.desc);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[DSS visitor/terminate]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/visitors/finalize { condoId, visitorId, notify? }
// Salida manual desde la app (operador o residente). Antes la app sólo marcaba el pase
// en Firestore y llamaba visitor/leave, que NO revoca la credencial: el QR/rostro y la
// patente seguían activos en el DSS hasta que venciera la ventana. Ahora el cierre
// completo se hace aquí, con la misma sesión DSS del poller.
app.post('/api/visitors/finalize', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { condoId, visitorId } = req.body || {};
  if (!condoId || !visitorId) return res.status(400).json({ error: 'condoId y visitorId son obligatorios' });
  try {
    const ref  = admin.firestore().doc(`condos/${condoId}/visitors/${visitorId}`);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Pase no encontrado' });
    const v = snap.data();
    const prof = await callerProfile(req);
    const esDueno = !!v.userId && v.userId === req.user.uid;
    if (!esDueno && !callerHasCondo(prof, condoId)) return res.status(403).json({ error: 'Sin permiso sobre este pase' });
    const yaCerrado = v.status === 'exited';
    const out = await finalizarPaseDss(ref, v, { origen: 'manual', exitedBy: req.user.uid, exitedByName: prof.name || prof.displayName || null });
    if (!yaCerrado && req.body?.notify !== false && v.manualEntry && v.userId) {
      await addNotification(v.userId, {
        title: 'Visita finalizada', message: `${v.visitorName || 'Tu visita'} se ha retirado del condominio.`,
        type: 'visitor', link: '/visitors',
      }).catch(() => {});
    }
    console.log(`[Visitas] pase finalizado a mano: ${v.visitorName} (${condoId}) revoke=${out.revoked} patente=${out.plateDeleted}`);
    res.json({ ok: true, ...out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/debug/visitors/sweep — corre el barrido ahora y devuelve el resumen (super_admin).
app.post('/api/debug/visitors/sweep', requireAuth, requireRole([]), async (_req, res) => {
  if (_jobStats.sweep.running) return res.status(409).json({ error: 'Ya hay un barrido en curso', stats: _jobStats.sweep });
  await sweepVisitorCredentials();
  res.json(_jobStats.sweep);
});

// Debug: fetch raw DSS visitor object — use to confirm status field name
// GET /api/debug/visitor/:visitorId
// Los endpoints de debug exponen datos de todos los condominios (IDs Dahua, visitas,
// direcciones): restringidos a super_admin.
app.use('/api/debug', requireAuth, requireRole([]));

// POST /api/debug/dss { method, path, body } — consulta de solo lectura al DSS reutilizando la
// sesión del poller. Sólo GET, o POST a rutas de consulta paginada (fetch/page, /page, /list).
// Nunca acciones (login, control de puertas, personas, visitantes).
app.post('/api/debug/dss', requireAuth, requireRole([]), async (req, res) => {
  const { method = 'GET', path, body } = req.body || {};
  const m = String(method).toUpperCase();
  if (!/^\/(brms|obms|ipms)\/api\//.test(String(path || ''))) return res.status(400).json({ error: 'Ruta fuera de /brms|/obms|/ipms' });
  if (m !== 'GET' && !(m === 'POST' && /(fetch\/page|\/page|\/list|\/query)(\?|$)/.test(path))) {
    return res.status(400).json({ error: 'Sólo lectura: GET, o POST a rutas de consulta (page/list/query)' });
  }
  try {
    const r = await dssAuthed(m, path, body || null);
    res.status(200).json({ status: r.status, body: r.body });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.get('/api/debug/visitor/:visitorId', requireAuth, async (req, res) => {
  if (!_pollerToken) return res.status(503).json({ error: 'No DSS session — log in to the app first' });
  try {
    const r = await dssRequest('GET', `/obms/api/v1.0/visitors/visitor/${req.params.visitorId}`,
      null, { 'X-Subject-Token': _pollerToken });
    res.json(r.body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Debug: auto-picks the first synced visitor from Firestore and fetches it from DSS
// GET /api/debug/visitor-sample
app.get('/api/debug/visitor-sample', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  if (!_pollerToken) return res.status(503).json({ error: 'No DSS session — log in to the app first' });
  try {
    const firestore = admin.firestore();
    const condosSnap = await firestore.collection('condos').get();
    let sample = null;
    for (const condoDoc of condosSnap.docs) {
      const snap = await firestore.collection(`condos/${condoDoc.id}/visitors`)
        .where('dahuaVisitorId', '>', '').limit(1).get();
      if (!snap.empty) { sample = snap.docs[0].data(); break; }
    }
    if (!sample) return res.status(404).json({ error: 'No synced visitors found in Firestore' });

    const r = await dssRequest('GET', `/obms/api/v1.0/visitors/visitor/${sample.dahuaVisitorId}`,
      null, { 'X-Subject-Token': _pollerToken });
    res.json({ firestoreVisitor: { visitorName: sample.visitorName, dahuaVisitorId: sample.dahuaVisitorId }, dssRawResponse: r.body });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── DSS Visitor Status Poller ─────────────────────────────────────────────────
//
// Runs every 30 s server-side. Reads active visitors from Firestore, fetches
// their current status from DSS Pro, and on state transitions writes a
// notification to /notifications/{id} so the resident is notified in real time.
//
// Tracked transitions:
//   0 → 1   Appointment  → In visit       "Nombre ha ingresado"
//   1 → 2   In visit     → Pass expired   "Pase vencido…"
//   1 → 3   In visit     → Overtime       "Pase vencido…"
//   1 → 4   In visit     → Visitor left   "Tu visita ya se fue"

let _pollerToken = null;
let _pollerCredential = null; // credencial del 2º login: se usa como ?token= para bajar imágenes del DSS (manual 3.3.6)

// ── Job telemetry (exposed via /api/status) ───────────────────────────────────
const _jobStats = {
  poller:   { lastRun: null, lastError: null, notifsSent: 0 },
  syncRetry: { lastRun: null, lastError: null, synced: 0, porCondo: {} },
  sweep:    { lastRun: null, lastError: null, revocados: 0, vencidos: 0, patentes: 0, errores: 0, running: false },
  shelly:   { lastPoll: null, lastError: null, lastSync: null, devices: 0, alerts: 0, running: false },
  events:   { lastSync: null, lastError: null, leidas: 0, nuevas: 0, agrupadas: 0, running: false },
};

/** Log de errores de sincronización por condominio, con anti-spam de 30 min. */
const _ERR_SYNC_REPETIR_MS = 30 * 60 * 1000;
function registrarErrorSync(condoId, condoName, visitorName, mensaje) {
  const previo = _jobStats.syncRetry.porCondo[condoId];
  const ahora = Date.now();
  const cambio = !previo || previo.mensaje !== mensaje;
  _jobStats.syncRetry.porCondo[condoId] = {
    condo: condoName || condoId, mensaje, visitante: visitorName,
    desde: cambio ? new Date(ahora).toISOString() : previo.desde,
    fallos: cambio ? 1 : (previo.fallos || 0) + 1,
    _ultimoLog: previo?._ultimoLog ?? 0,
  };
  const e = _jobStats.syncRetry.porCondo[condoId];
  if (cambio || ahora - e._ultimoLog > _ERR_SYNC_REPETIR_MS) {
    e._ultimoLog = ahora;
    console.error(`[DSS Sync] ⚠ ${e.condo}: no se pudo sincronizar "${visitorName}" — ${mensaje} (fallos: ${e.fallos})`);
  }
}


/**
 * Adds a notification to Firestore and sends an FCM push to the user's device.
 * Falls back gracefully if the user has no FCM token.
 */
async function addNotification(userId, { title, message, type = 'info', link = null }) {
  const firestore = admin.firestore();
  await firestore.collection('notifications').add({
    userId, title, message, type, link, read: false,
    createdAt: admin.firestore.Timestamp.now(),
  });
  try {
    const userSnap = await firestore.collection('users').doc(userId).get();
    const fcmToken = userSnap.data()?.fcmToken;
    if (fcmToken) {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body: message },
        data: { link: link || '/' },
        android: { notification: { icon: 'ic_notification', sound: 'default' } },
        webpush: {
          notification: { icon: '/icon-192.png', badge: '/icon-192.png' },
          fcmOptions: { link: link || '/' },
        },
      });
    }
  } catch (err) {
    console.warn('[FCM] push failed for', userId, ':', err.message);
  }
}

/** DSS status code → notification factory */
const DSS_VISIT_NOTIFS = {
  '0:1': (name) => ({ title: 'Visita ingresó',  message: `${name} ha ingresado` }),
  '0:2': (name) => ({ title: 'Pase vencido',    message: `El pase de ${name} venció sin ser utilizado` }),
  '0:3': (name) => ({ title: 'Pase vencido',    message: `El pase de ${name} venció sin ser utilizado` }),
  '1:2': ()     => ({ title: 'Pase vencido',    message: 'Tu visita tiene el pase vencido, modifica el horario de salida para que no tenga problemas al salir' }),
  '1:3': ()     => ({ title: 'Pase vencido',    message: 'Tu visita tiene el pase vencido, modifica el horario de salida para que no tenga problemas al salir' }),
  '1:4': ()     => ({ title: 'Visita se fue',   message: 'Tu visita ya se fue' }),
};

async function pollerDssLogin(isRetry = false) {
  if (!DAHUA_HOST || !DAHUA_USER || !DAHUA_PASS) return null;
  try {
    const step1 = await dssRequest('POST', '/brms/api/v1.0/accounts/authorize',
      { userName: DAHUA_USER, ipAddress: '', clientType: 'API' }, {});
    const { realm, randomKey } = step1.body;
    if (!realm || !randomKey) return null;

    const signature = buildDssSignature(DAHUA_USER, DAHUA_PASS, realm, randomKey);
    const step2 = await dssRequest('POST', '/brms/api/v1.0/accounts/authorize', {
      mac: '00:DE:AD:BE:EF:02', signature, userName: DAHUA_USER, randomKey,
      publicKey:
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LwTBkqEyS0qpahbp5HlSc+tttuJUuPftmMo' +
        '+QSSsZ+fbNou3W/fFzyPhcCbInIXp1UxGr2qwbkfSd7GPUKO36QpFSHDKJHenjedEWTfaZsCltmjMKtx' +
        '2j5M/L+Ij2T31t2XNITlo22TFdWMNyUHFMTEvi6hXFsWlPBr7yTrACGrgDk24oLxzZNgp/ZGa7jv828' +
        'Lbsi0SXgkTOWRkXF6rlER7aP9tSvsXk0UF4T2HUe5kayc4329y4p2LjASWA+72BHQ3XUvVK9+VnkJ6Y' +
        'n61PfJ2Ex9h/OWE07CBHpc6p+7Og5ShJOGXZ9L38OGPXQZbEpqIzvkR1qx3aCu307KMQIDAQAB',
      encryptType: 'MD5', ipAddress: '', clientType: 'API', userType: '0',
    }, {});

    const code = step2.body?.code ?? step2.body?.data?.code;
    if (code === 2004) {
      if (isRetry) {
        console.warn('[DSS Poller] code 2004 persists after unauthorize — giving up');
        return null;
      }
      // Stale session blocking login — clear it and retry once (same pattern as /api/dahua/login).
      // The browser client re-authenticates automatically on token expiry (code 7000).
      console.warn('[DSS Poller] code 2004 — clearing stale session and retrying');
      await dssRequest('POST', '/brms/api/v1.0/accounts/unauthorize', { userName: DAHUA_USER }, {}).catch(() => {});
      return pollerDssLogin(true);
    }

    const token = step2.body?.token ?? step2.body?.data?.token;
    _pollerToken = token || null;
    _pollerCredential = step2.body?.credential ?? step2.body?.data?.credential ?? null;
    return _pollerToken;
  } catch (err) {
    console.warn('[DSS Poller] login error:', err.message);
    return null;
  }
}

function _mapDoorRecord(raw) {
  const dir = String(raw.inOutStatus ?? raw.direction ?? raw.accessType ?? '').toLowerCase();
  return {
    channelId:   String(raw.channelId ?? raw.pointId  ?? raw.doorId    ?? ''),
    channelName: String(raw.channelName ?? raw.pointName ?? raw.doorName ?? ''),
    accessTime:  parseDssTsSrv(
      raw.accessTime ?? raw.alarmTime ?? raw.time ?? raw.eventTime ?? raw.happenTime
    ),
    direction: dir === '0' || dir === 'in'  || dir === 'enter' || dir === 'entry' ? 'in' :
               dir === '1' || dir === 'out' || dir === 'exit'                      ? 'out' : '',
  };
}

// Visitor QR accesses are recorded in the visitor history endpoint, not the
// standard access-record endpoint (which only tracks card/PIN residents).
async function fetchVisitorAccessedDoors(visitorId, visitorName, startTime, endTime, condoChannelIds) {
  const allow = Array.isArray(condoChannelIds) && condoChannelIds.length
    ? new Set(condoChannelIds.map(String)) : null;
  const mapAndFilter = (list) =>
    (list ?? []).map(_mapDoorRecord).filter(r => r.channelId || r.channelName);

  // Strategy 1: visitor history records via GET (DSS logs QR scans here, not in access records)
  try {
    const qs = new URLSearchParams({
      page: '1', pageSize: '100', currentPage: '1',
      startTime: String(startTime), endTime: String(endTime),
      visitorId: String(visitorId),
    }).toString();
    const r = await dssRequest(
      'GET', `/obms/api/v1.1/visitor/history/record/page?${qs}`,
      null,
      { 'X-Subject-Token': _pollerToken }
    );
    if (r?.body?.code === 1000) {
      const payload = r.body.data ?? r.body;
      const rows = mapAndFilter(payload.list ?? payload.pageData ?? payload.records);
      if (rows.length > 0) {
        console.log(`[Doors] visitorHistory returned ${rows.length} records for ${visitorName}`);
        return rows;
      }
    } else {
      console.log(`[Doors] visitorHistory code=${r?.body?.code} for ${visitorName}`);
    }
  } catch (e) {
    console.log(`[Doors] visitorHistory error: ${e.message}`);
  }

  // Strategy 2: access records filtered by personName (visitor name)
  if (visitorName) {
    try {
      const r = await dssRequest(
        'POST', '/obms/api/v1.1/acs/access/record/fetch/page',
        {
          page: 1, pageSize: 100, currentPage: 1,
          startTime: String(startTime), endTime: String(endTime),
          areaCodes: [], eventLevels: ['1', '2', '3'],
          orgCode: '', pointId: '', pointTypes: [], pointName: '',
          personId: '', personName: String(visitorName), splitId: '', splitTime: '',
        },
        { 'X-Subject-Token': _pollerToken }
      );
      if (r?.body?.code === 1000) {
        const payload = r.body.data ?? r.body;
        // OJO: el filtro por personName es GLOBAL en DSS — hay homónimos en otros
        // condominios (un "Prueba" devolvía 100 puertas ajenas). Nos quedamos solo
        // con las puertas de este condominio; si no queda nada, cae a la estrategia 3.
        const rows = mapAndFilter(payload.list ?? payload.pageData)
          .filter(r => !allow || allow.has(r.channelId));
        if (rows.length > 0) {
          console.log(`[Doors] accessRecord(personName) returned ${rows.length} records for ${visitorName}`);
          return rows;
        }
      }
    } catch { /* ignore */ }
  }

  // Strategy 3: access records filtered by personId (last resort)
  try {
    const r = await dssRequest(
      'POST', '/obms/api/v1.1/acs/access/record/fetch/page',
      {
        page: 1, pageSize: 100, currentPage: 1,
        startTime: String(startTime), endTime: String(endTime),
        areaCodes: [], eventLevels: ['1', '2', '3'],
        orgCode: '', pointId: '', pointTypes: [], pointName: '',
        personId: String(visitorId), personName: '', splitId: '', splitTime: '',
      },
      { 'X-Subject-Token': _pollerToken }
    );
    if (r?.body?.code === 1000) {
      const payload = r.body.data ?? r.body;
      return mapAndFilter(payload.list ?? payload.pageData);
    }
  } catch { /* ignore */ }

  return [];
}

async function pollVisitorStatuses() {
  if (!DAHUA_HOST || !admin.apps.length) return;
  _jobStats.poller.lastRun = new Date().toISOString();

  // Ensure we have a valid token
  if (!_pollerToken) {
    _pollerToken = await pollerDssLogin();
    if (!_pollerToken) return;
  }

  const firestore = admin.firestore();

  try {
    // Only look at visitors from the last 2 days to keep the query cheap
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 2);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const condosSnap = await firestore.collection('condos').get();

    for (const condoDoc of condosSnap.docs) {
      let visitorsSnap;
      try {
        visitorsSnap = await firestore
          .collection(`condos/${condoDoc.id}/visitors`)
          .where('date', '>=', cutoffStr)
          .get();
      } catch { continue; }

      // Config de parking del condominio (lazy, cacheada) — para detectar el ingreso
      // por barrera ANPR (por patente) cuando no aparece por personId.
      let _parking, _parkingDone = false;
      const getParking = async () => {
        if (!_parkingDone) { _parkingDone = true; try { _parking = await resolveCondoParking(condoDoc.data(), condoDoc.ref); } catch { _parking = null; } }
        return _parking;
      };

      for (const docSnap of visitorsSnap.docs) {
        const v = docSnap.data();

        // Skip visitors not synced with DSS or already in terminal state
        if (!v.dahuaVisitorId || !v.userId) continue;
        if (v.dssStatus === '4') continue;

        const startTs = v.startTs ?? Math.floor(new Date(`${v.date}T${v.entryTime || '00:00'}:00-04:00`).getTime() / 1000);
        const nowTs = Math.floor(Date.now() / 1000);
        let endTs = v.endTs;
        if (!endTs && v.date) {
          const toTs = (date, time) => Math.floor(new Date(`${date}T${time || '00:00'}:00-04:00`).getTime() / 1000);
          let e = toTs(v.date, v.exitTime); const s = toTs(v.date, v.entryTime);
          if (e <= s) e += 86400; endTs = e;
        }
        const prev = String(v.dssStatus ?? '0');

        // Finaliza el pase: marca salida, borra la persona-patente del lector y guarda
        // las puertas accedidas. notifKey = clave en DSS_VISIT_NOTIFS o null (sin notif).
        const finalizeExit = async (notifKey, meta) => {
          const upd = { dssStatus: '4', status: 'exited', ...(meta || {}) };
          const doors = await fetchVisitorAccessedDoors(
            v.dahuaVisitorId, v.visitorName, startTs, nowTs, condoDoc.data().dahuaChannelIds);
          if (doors.length > 0) upd.accessedDoors = doors;
          // Pase de un solo uso: al SALIR se revoca la credencial en el DSS (rostro/QR +
          // puertas) para impedir el reingreso dentro de la ventana horaria. (Antes solo se
          // borraba la persona-patente; el QR/rostro seguía autorizando la reentrada.)
          await serverDssRevokeVisitorAccess(_pollerToken, v.dahuaVisitorId);
          upd.accessRevoked = true;
          if (v.dahuaPlatePersonId) {
            await serverDssDeletePlateVehicle(_pollerToken, v.dahuaPlatePersonId);
            upd.dahuaPlatePersonId = null;
          }
          await docSnap.ref.update(upd);
          if (notifKey && DSS_VISIT_NOTIFS[notifKey]) {
            const n = DSS_VISIT_NOTIFS[notifKey](v.visitorName || 'Tu visitante');
            await addNotification(v.userId, { title: n.title, message: n.message, type: 'visitor', link: '/visitors' });
            _jobStats.poller.notifsSent++;
          }
        };

        // 1) Movimiento real por access records (ingreso/salida), del visitante Y de la
        //    persona-patente. DSS NO refleja la salida en el visitStatus del módulo de
        //    visitas; el último evento de acceso es la fuente de verdad del estado.
        let latestIn = 0, latestOut = 0, marks = [];
        try {
          // Desde 10 min antes del inicio: el DSS autoriza con esa tolerancia (dssInicioConTolerancia)
          // y la visita puede haber entrado antes del minuto exacto del pase.
          const mv = await fetchVisitorMovement([v.dahuaPersonId || v.dahuaVisitorId, v.dahuaPlatePersonId], startTs - 600, nowTs);
          latestIn = mv.latestIn; latestOut = mv.latestOut; marks = mv.marks || [];
        } catch { /* transitorio — usa el módulo de visitas abajo */ }

        // Respaldo: ingreso por barrera ANPR (por PATENTE). El lector abre la barrera y
        // registra el ingreso en el log de parking; si la persona-patente no quedó
        // vinculada (conflicto), no aparece por personId → lo detectamos por patente.
        if (!latestIn && v.licensePlate && (v.status === 'pending' || prev === '0')) {
          try {
            const parking = await getParking();
            if (parking) {
              const pe = await fetchPlateEntry(v.licensePlate, parking, startTs, nowTs);
              if (pe && pe > latestOut) latestIn = pe;
            }
          } catch { /* transitorio */ }
        }

        // Bloqueo del pase (un solo uso). Antes se cerraba solo cuando el ÚLTIMO
        // evento era una salida, así que alternando ingreso/salida el QR seguía vivo
        // indefinidamente. Ahora, cuando el lector identifica la dirección por nombre:
        //   · ventana de ingreso de 5 min desde la primera marca (tolera varios tótems
        //     de entrada); un ingreso posterior = reingreso → bloquear.
        //   · máximo 2 marcas de salida → bloquear.
        //   · con 1 sola marca de salida, bloquear tras 2 min sin más movimiento.
        // Si ninguna marca es identificable se mantiene la regla antigua.
        const sureMarks  = marks.filter(m => m.sure);
        const entryMarks = sureMarks.filter(m => m.dir === 'in');
        const exitMarks  = sureMarks.filter(m => m.dir === 'out');
        const firstEntry = entryMarks.length ? entryMarks[0].ts : 0;
        const lastMark   = sureMarks.length ? sureMarks[sureMarks.length - 1].ts : 0;
        const lateEntry  = entryMarks.length
          ? entryMarks.find(m => m.ts > entryMarks[0].ts + ENTRY_GRACE_S)
          : null;

        let block = null;
        if (sureMarks.length) {
          if (exitMarks.length >= MAX_EXIT_MARKS) {
            block = `${exitMarks.length} marcas de salida (tope ${MAX_EXIT_MARKS})`;
          } else if (lateEntry) {
            block = `reingreso ${Math.round((lateEntry.ts - firstEntry) / 60)} min después de la primera marca (ventana ${ENTRY_GRACE_S / 60} min)`;
          } else if (exitMarks.length === 1 && nowTs - lastMark > EXIT_SETTLE_S) {
            block = 'salió (1 marca de salida, sin más movimiento)';
          }
        } else if (latestOut && latestOut >= latestIn) {
          block = 'salió (último evento de acceso)';
        }

        if (block) {
          if (prev !== '4') {
            await finalizeExit(prev === '0' ? null : '1:4', {
              blockReason: block,
              entryMarkCount: entryMarks.length,
              exitMarkCount: exitMarks.length,
              firstEntryTs: firstEntry || null,
            });
            console.log(`[DSS Poller] ${v.visitorName} → QR bloqueado: ${block}`);
          }
          continue;
        }
        // Entrada: el último evento es un ingreso y el pase estaba pendiente → "en sitio".
        if (latestIn && prev === '0') {
          await docSnap.ref.update({ dssStatus: '1', status: 'entered' });
          const n = DSS_VISIT_NOTIFS['0:1'](v.visitorName || 'Tu visitante');
          await addNotification(v.userId, { title: n.title, message: n.message, type: 'visitor', link: '/visitors' });
          _jobStats.poller.notifsSent++;
          console.log(`[DSS Poller] ${v.visitorName} ingresó (access record) → entered`);
          continue;
        }

        // 2) Sin movimiento de acceso → consultar el módulo de visitas (respaldo de
        //    entrada por visitStatus y manejo de purga/expiración del registro).
        let r;
        try {
          r = await dssRequest('GET', `/obms/api/v1.0/visitors/visitor/${v.dahuaVisitorId}`, null, { 'X-Subject-Token': _pollerToken });
        } catch { continue; }
        if (r.body?.code === 2003 || r.body?.code === 401) { _pollerToken = null; return; }

        // 2144 = registro purgado por DSS (salida manual o expiración).
        if (r.body?.code === 2144) {
          if (endTs && endTs < nowTs) {
            // Ventana cerrada → finalizar (incluye borrar la patente). "se fue" si estaba
            // adentro; "venció sin usar" si nunca ingresó.
            await finalizeExit(v.status === 'entered' ? '1:4' : '0:2');
            console.warn(`[DSS Poller] ${v.visitorName} purgado/vencido → exited`);
          } else if (v.status === 'pending' || prev === '0') {
            // Visita futura purgada (p.ej. admin la borró) → resync reutilizando el QR.
            await docSnap.ref.update({ dahuaVisitorId: null, dahuaPersonId: null });
            console.warn(`[DSS Poller] ${v.visitorName} purgado sin ingresar → limpiando para resync`);
          }
          continue;
        }
        if (r.body?.code !== 1000) continue;
        const d = r.body?.data ?? {};

        // Salud: marcar dssAuthVerified cuando el visitante tiene permisos de puerta.
        if (!v.dssAuthVerified && Array.isArray(d.rightInfo?.acsChannels) && d.rightInfo.acsChannels.length > 0) {
          await docSnap.ref.update({ dssAuthVerified: true });
          v.dssAuthVerified = true;
        }

        // Respaldo de entrada/fin por el visitStatus del módulo de visitas (cuando no
        // hubo access records). 1=ingresó, 2=vencido, 4=salido, 3=overtime (sigue adentro).
        const rawStatus = d.visitStatus ?? d.visitedStatus ?? d.visitState ?? d.status ?? d.state;
        const newStatus = rawStatus != null ? String(rawStatus) : '';
        if (newStatus === '1' && prev === '0') {
          await docSnap.ref.update({ dssStatus: '1', status: 'entered' });
          const n = DSS_VISIT_NOTIFS['0:1'](v.visitorName || 'Tu visitante');
          await addNotification(v.userId, { title: n.title, message: n.message, type: 'visitor', link: '/visitors' });
          _jobStats.poller.notifsSent++;
          console.log(`[DSS Poller] ${v.visitorName} ingresó (visitStatus) → entered`);
        } else if ((newStatus === '2' || newStatus === '4') && prev !== '4') {
          await finalizeExit(prev === '0' ? '0:2' : '1:4');
          console.warn(`[DSS Poller] ${v.visitorName} visitStatus ${newStatus} → exited`);
        } else if (prev === '1' && endTs && nowTs > endTs + 43200) {
          // Red de seguridad: entró y pasaron +12h del fin de ventana sin salida
          // registrada (DSS no marcó la salida). Finalizar para no dejarlo "en sitio".
          await finalizeExit('1:4');
          console.warn(`[DSS Poller] ${v.visitorName} sin salida +12h post-ventana → exited`);
        }
      }
    }
  } catch (err) {
    _jobStats.poller.lastError = err.message;
    console.warn('[DSS Poller] poll error:', err.message);
    _pollerToken = null;
  }
}

// ── DSS Visitor Sync Retry Job ────────────────────────────────────────────────
//
// Runs every 60 s. Scans Firestore for visitors without dahuaVisitorId
// (sync failed or browser was closed before completing) and retries the
// DSS Pro registration automatically. Covers the last 7 days.

async function serverDssGeneratePassport(token) {
  const r = await dssRequest('GET', '/obms/api/v1.0/visitors/visitor/passport/generate', null,
    { 'X-Subject-Token': token });
  if (r.body?.code !== 1000 || !r.body?.data?.qrcode)
    throw new Error('[DSS Sync] generatePassport failed: ' + JSON.stringify(r.body));
  return { qrcode: r.body.data.qrcode, passportCardNo: r.body.data.passportCardNo };
}

// Tolerancia de reloj para el DSS: el residente crea el pase "ahora" (minuto redondeado en su
// celular) y la visita escanea al instante, pero los lectores suelen ir 1-3 min atrasados y
// rechazan con "Validity Error" (13104). Un pase que empieza entre hace 10 min y dentro de 15 min
// se autoriza en el DSS desde 10 min antes. El startTs guardado en la app no cambia.
function dssInicioConTolerancia(startTs) {
  const s = Number(startTs) || 0; const now = Math.floor(Date.now() / 1000);
  return (s > now - 600 && s < now + 900) ? now - 600 : s;
}

async function serverDssCreateVisitor(token, { visitorName, hostName, plate, startTs, endTs, acsChannelIds, positionIds, reusePassport, visitStatus, reason }) {
  // Pre-filter orphan IDs (same defense as /api/dahua/visitor/create).
  const valid = await getValidAccessChannelIds().catch(() => null);
  let filteredIds = acsChannelIds.map(String);
  if (valid) {
    const before = filteredIds.length;
    filteredIds = filteredIds.filter(id => valid.has(id));
    if (before - filteredIds.length > 0) {
      console.warn(`[DSS Sync] filtered ${before - filteredIds.length} orphan channel ID(s)`);
    }
  }
  if (filteredIds.length === 0) {
    throw new Error('[DSS Sync] createVisitor: all channels invalid in DSS');
  }

  // En un resync reutilizamos el QR previo (qrcode+passportCardNo) para que el
  // código del visitante NO cambie entre purgas de DSS. Si no hay uno para
  // reusar, generamos uno nuevo (comportamiento normal).
  const canReuse = !!(reusePassport && reusePassport.qrcode && reusePassport.passportCardNo);
  let passport = canReuse
    ? { qrcode: reusePassport.qrcode, passportCardNo: reusePassport.passportCardNo }
    : await serverDssGeneratePassport(token);
  // status DSS del visitante: '0' = cita (por defecto), '1' = visitando/en sitio.
  // Un ingreso manual (operador) se crea directamente como '1' para que en DSS
  // quede "en sitio" (no como cita futura). Si DSS lo rechaza, se reintenta con '0'.
  const wantStatus = visitStatus === '1' ? '1' : '0';
  const body = {
    status: wantStatus,
    visitorName,
    visitedName: hostName || 'Portería Virtual',
    visitedEmail: '', idType: '0', idNum: '',
    tel: '', email: '',
    expectArrivalTime: String(dssInicioConTolerancia(startTs)),
    expectLeaveTime:   String(endTs),
    // La patente NO se registra en el visitante (ahí no abre la barrera y bloquearía,
    // por "carNo already exists", el registro en parking que sí la baja al lector).
    plateNo: '',
    reason: (reason && String(reason).trim()) || 'Invitación', remark: 'vía API',
    authInfo: {
      qrcode: passport.qrcode,
      passportCardNo: passport.passportCardNo,
      facePictures: [], idPicture: '',
    },
    rightInfo: {
      inheritVisitedAuthority: '0',
      acsChannelIds: filteredIds,
      vtoChannelIds: [],
      positionIds: Array.isArray(positionIds) ? positionIds.map(String) : [],
      liftChannels: [],
    },
  };
  let r = await dssRequest('POST', '/obms/api/v1.0/visitors/visitor', body,
    { 'X-Subject-Token': token });

  // Cache may be stale — refresh once and retry on 1004.
  if (r.body?.code === 1004) {
    const fresh = await getValidAccessChannelIds(true).catch(() => null);
    if (fresh) {
      body.rightInfo.acsChannelIds = filteredIds.filter(id => fresh.has(id));
      if (body.rightInfo.acsChannelIds.length === 0) {
        throw new Error('[DSS Sync] createVisitor: all channels invalid after cache refresh');
      }
      r = await dssRequest('POST', '/obms/api/v1.0/visitors/visitor', body,
        { 'X-Subject-Token': token });
    }
  }

  // Si reutilizábamos un QR previo y DSS lo rechazó (p.ej. ya no admite ese
  // passport), generamos uno nuevo y reintentamos una vez. Garantiza que, en el
  // peor caso, el resultado sea idéntico al comportamiento anterior (sin reuso).
  if (r.body?.code !== 1000 && canReuse) {
    console.warn('[DSS Sync] reuso de QR rechazado (' + r.body?.code + '), generando QR nuevo');
    passport = await serverDssGeneratePassport(token);
    body.authInfo.qrcode = passport.qrcode;
    body.authInfo.passportCardNo = passport.passportCardNo;
    r = await dssRequest('POST', '/obms/api/v1.0/visitors/visitor', body, { 'X-Subject-Token': token });
  }

  // Fallback: si pedimos crear "en sitio" (status '1') y DSS lo rechaza, reintentar
  // como cita ('0') para no perder el registro (peor caso = comportamiento anterior).
  if (r.body?.code !== 1000 && wantStatus === '1') {
    console.warn('[DSS Sync] status "1" (en sitio) rechazado (' + r.body?.code + '), reintentando como cita "0"');
    body.status = '0';
    r = await dssRequest('POST', '/obms/api/v1.0/visitors/visitor', body, { 'X-Subject-Token': token });
  }

  if (r.body?.code !== 1000)
    throw new Error('[DSS Sync] createVisitor failed: ' + JSON.stringify(r.body));
  const qrReadyAt = Math.floor(Date.now() / 1000) + QR_SYNC_SETTLE_SEC;
  return { visitorId: r.body.data?.visitorId, personId: r.body.data?.personId, qrcode: passport.qrcode, passportCardNo: passport.passportCardNo, qrReadyAt };
}

// ── Patente del visitante → barrera vehicular (ANPR) ──────────────────────────
// El módulo de visitas NO empuja la patente al lector LPR; solo lo hace el de
// "Person & Vehicle Info" (parking). Por eso, para que la barrera abra por
// reconocimiento de patente, registramos la patente como una persona+vehículo
// temporal en el grupo de entrada "General" del parking del condominio. DSS la
// baja a la lista blanca del lector. Se borra al salir/expirar el pase.
function normalizePlate(p) {
  return String(p || '').toUpperCase().replace(/[\s-]/g, '').trim();
}

// Crea persona + vehículo (patente) en el grupo de entrada del parking.
// Devuelve { personId } o null (patente vacía o ya existente en DSS).
const MAX_PLATE_ATTEMPTS = 5;   // tope de reintentos por pase ante errores duros

async function serverDssCreatePlateVehicle(token, { plateNo, visitorName, orgCode, personOrgCode, parkingLotId, entranceGroupId, startTs, endTs }) {
  const plate = normalizePlate(plateNo);
  if (!plate) return null;
  const H = { 'X-Subject-Token': token };
  const personId = String(Math.floor(10000000 + Math.random() * 89999999)); // 8 dígitos
  // OJO: el DSS tiene DOS árboles con numeración distinta. `orgCode` es el del parking
  // (IPMS, /entrance-group/list) y sirve para el paso 2. La persona del paso 1 vive en el
  // árbol ACS (/acs/person-group/list), cuyo código es otro: sin personOrgCode la persona
  // queda en el condominio equivocado, o falla con 140016 si ese código no existe allí.
  const pOrg = personOrgCode || orgCode;

  // 1) Crear persona (registro ACS, separado del de visitas)
  const personBody = {
    baseInfo: { personId, lastName: '', firstName: `VISITA ${visitorName || ''} ${plate}`.trim().slice(0, 60),
      gender: '1', orgCode: pOrg, orgCodes: [pOrg], email: '', tel: '', remark: 'pase visita (patente)',
      source: '0', sourceType: '1', sourceId: '', associateId: '', facePictures: [] },
    extensionInfo: { nickName: '', address: '', idType: '0', idNo: '', nationalityId: '9999', birthday: '', companyName: '', department: '', position: '' },
    userDefineFields: [],
    residentInfo: { houseHolder: '0', sipId: '', vdpUser: '0' },
    authenticationInfo: { combinationPassword: '', cards: [], fingerprints: [], startTime: String(startTs), endTime: String(endTs) },
    accessInfo: { accessType: '0', guestUseTimes: '200', passageRuleIds: [] },
    faceComparisonInfo: { enableFaceComparisonGroup: '0', faceComparisonGroupId: '' },
    entranceInfo: { enableEntranceGroup: '0', enableParkingSpace: '0', parkingSpaceNum: '0', vehicles: [] },
  };
  const pr = await dssRequest('POST', '/obms/api/v1.1/acs/person', personBody, H);
  if (pr.body?.code === 10004) { // patente ya existe en DSS (otro pase/residente)
    console.warn(`[DSS Plate] ${plate} ya existe en DSS — conflicto`);
    return { conflict: true };
  }
  if (pr.body?.code !== 1000) throw new Error('person create failed: ' + JSON.stringify(pr.body));

  // 2) Atar la patente al grupo de entrada (esto la baja al lector LPR).
  //    La estructura ANIDADA entranceGroups (con parkingLotId) es obligatoria;
  //    sin ella DSS devuelve Success pero no bindea el grupo.
  const vehBody = {
    enableSurveyGroup: '0', enableEntranceGroup: '1',
    person: { personId, companyName: '', parkingSpaceQuota: '0', enableParkingSpaceQuota: '0', tel: '', enableParkingSpace: '0', email: '', remark: '' },
    vehicles: [{ id: '', plateNo: plate, vehicleColor: '0', vehicleBrand: '-1', remark: '',
      entranceGroupIds: [String(entranceGroupId)],
      entranceGroups: [{ plateNo: plate, parkingLotId: String(parkingLotId), entranceGroupIds: [String(entranceGroupId)],
        entranceLongTerm: '0', entranceStartTime: String(dssInicioConTolerancia(startTs)), entranceEndTime: String(endTs) }],
      surveyGroupIds: [], surveyLongTerm: '0', surveyStartTime: '-1', surveyEndTime: '-1',
      orgCode, orgCodes: [orgCode] }],
  };
  const vr = await dssRequest('POST', '/ipms/api/v1.1/vehicle/save/batch', vehBody, H);
  if (vr.body?.code !== 1000) {
    // rollback de la persona para no dejar registros huérfanos
    await dssRequest('POST', '/obms/api/v1.1/acs/person/delete/batch', { personIds: [personId], mode: '1' }, H).catch(() => {});
    if (vr.body?.code === 10004) { // patente duplicada en DSS (otro visitante/residente)
      console.warn(`[DSS Plate] ${plate} ya existe en DSS (conflicto) — no se registra en parking`);
      return { conflict: true };
    }
    throw new Error('vehicle save failed: ' + JSON.stringify(vr.body));
  }
  return { personId };
}

// Borra la persona+patente creada para un pase (al salir/expirar). Best-effort.
async function serverDssDeletePlateVehicle(token, personId) {
  if (!personId) return;
  await dssRequest('POST', '/obms/api/v1.1/acs/person/delete/batch',
    { personIds: [String(personId)], mode: '1' }, { 'X-Subject-Token': token })
    .catch((e) => console.warn('[DSS Plate] delete person failed:', e.message));
}

// Revoca la credencial de una visita en el DSS al SALIR (pase de un solo uso). Purga el
// registro de visita con overdue/clear, lo que elimina a la persona ACS y sus permisos
// (rostro/QR + puertas) → sin reingreso dentro de la ventana horaria. Verificado en prod:
// el visitante pasa de code 1000 (acsChannels activos) a 2144 (purgado). Es la misma
// llamada que usa POST /api/dahua/visitor/delete. Best-effort: no interrumpe el cierre.
async function serverDssRevokeVisitorAccess(token, visitorId) {
  if (!visitorId) return;
  const r = await dssRequest('POST', '/obms/api/v1.0/visitors/visitor/overdue/clear',
    { visitorIds: [String(visitorId)] }, { 'X-Subject-Token': token })
    .catch((e) => { console.warn('[DSS Revoke] overdue/clear failed:', e.message); return null; });
  if (r && r.body?.code !== 1000 && r.body?.code !== 1007) {
    console.info('[DSS Revoke] overdue/clear no-op:', r.body?.code, r.body?.desc);
  }
}

// Cierre COMPLETO de un pase, idempotente: revoca la credencial en el DSS (overdue/clear
// → QR/rostro + puertas), borra la persona-patente y deja el doc en exited/4 con
// accessRevoked. Usa dssAuthed (reintenta login si la sesión venció). Si el DSS no
// responde, NO marca accessRevoked para que el barrido lo reintente.
async function finalizarPaseDss(ref, v, meta = {}) {
  const out = { revoked: false, plateDeleted: false };
  const upd = { status: 'exited', dssStatus: '4', updatedAt: admin.firestore.Timestamp.now() };
  if (v.dahuaVisitorId && !v.accessRevoked) {
    const r = await dssAuthed('POST', '/obms/api/v1.0/visitors/visitor/overdue/clear', { visitorIds: [String(v.dahuaVisitorId)] })
      .catch((e) => { console.warn('[DSS Revoke] overdue/clear failed:', e.message); return null; });
    if (r) { out.revoked = true; upd.accessRevoked = true; upd.revokeCode = r.body?.code ?? null; }
  } else if (v.accessRevoked) { out.revoked = true; }
  if (v.dahuaPlatePersonId) {
    const r = await dssAuthed('POST', '/obms/api/v1.1/acs/person/delete/batch', { personIds: [String(v.dahuaPlatePersonId)], mode: '1' })
      .catch((e) => { console.warn('[DSS Plate] delete person failed:', e.message); return null; });
    if (r) { out.plateDeleted = true; upd.dahuaPlatePersonId = null; }
  }
  if (v.status !== 'exited') {
    const now = new Date();
    upd.exitedAt = admin.firestore.Timestamp.fromDate(now);
    upd.exitTime = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  }
  if (meta.origen)       upd.finalizedBy = meta.origen;
  if (meta.exitedBy)     upd.exitedBy = meta.exitedBy;
  if (meta.exitedByName) upd.exitedByName = meta.exitedByName;
  if (meta.blockReason && !v.blockReason) upd.blockReason = meta.blockReason;
  await ref.update(upd);
  return out;
}

// Barrido de credenciales: cada 6 h (y 1 min después de arrancar) recorre los pases de
// los últimos SWEEP_DAYS días y cierra en el DSS lo que quedó abierto por otros caminos:
//   · pases ya terminados (exited/4) cuya credencial o patente nunca se revocó
//     (salidas manuales antiguas desde la app);
//   · pases pending/entered con la ventana vencida hace +12 h que el poller ya no mira
//     (sólo revisa 2 días hacia atrás).
// Ritmo suave (150 ms entre pases) para no cargar el DSS. Idempotente.
const SWEEP_DAYS = 45;
async function sweepVisitorCredentials() {
  if (!DAHUA_HOST || !admin.apps.length || _jobStats.sweep.running) return;
  const st = _jobStats.sweep;
  st.running = true; st.lastRun = new Date().toISOString(); st.lastError = null;
  let revocados = 0, vencidos = 0, patentes = 0, errores = 0, revisados = 0;
  try {
    const db = admin.firestore();
    const desde = admin.firestore.Timestamp.fromMillis(Date.now() - SWEEP_DAYS * 864e5);
    const nowTs = Math.floor(Date.now() / 1000);
    for (const c of (await db.collection('condos').get()).docs) {
      const snap = await db.collection(`condos/${c.id}/visitors`).where('createdAt', '>=', desde).get().catch(() => null);
      if (!snap) continue;
      for (const d of snap.docs) {
        const v = d.data();
        if (!v.dahuaVisitorId) continue;
        revisados++;
        const terminado = v.status === 'exited' || v.dssStatus === '4';
        const pendienteRevocar = terminado && (!v.accessRevoked || v.dahuaPlatePersonId);
        const vencido = !terminado && v.endTs && nowTs > Number(v.endTs) + 12 * 3600;
        if (!pendienteRevocar && !vencido) continue;
        try {
          const out = await finalizarPaseDss(d.ref, v, vencido
            ? { origen: 'sweep', blockReason: 'ventana vencida sin cierre (barrido)' }
            : { origen: 'sweep' });
          if (vencido) vencidos++; else if (out.revoked && !v.accessRevoked) revocados++;
          if (out.plateDeleted) patentes++;
        } catch (e) { errores++; console.warn(`[Barrido] ${v.visitorName}: ${e.message}`); }
        await new Promise(r => setTimeout(r, 150));
      }
    }
    Object.assign(st, { revocados, vencidos, patentes, errores });
    if (revocados || vencidos || patentes || errores) {
      console.log(`[Barrido] ${revisados} pases revisados · ${revocados} credenciales revocadas · ${vencidos} vencidos cerrados · ${patentes} patentes borradas · ${errores} errores`);
    }
  } catch (err) {
    st.lastError = err.message;
    console.warn('[Barrido] error:', err.message);
  } finally { st.running = false; }
}

// Tolerancias del pase de un solo uso (reglas de bloqueo en pollVisitorStatuses).
const ENTRY_GRACE_S  = 5 * 60; // ingreso válido solo 5 min desde la primera marca
const MAX_EXIT_MARKS = 2;      // marcas de salida toleradas antes de bloquear el QR
const EXIT_SETTLE_S  = 2 * 60; // con UNA sola marca de salida, cerrar tras esta calma
const MARK_DEDUPE_S  = 10;     // relecturas del MISMO lector dentro de esto = 1 marca

// Detecta el ÚLTIMO ingreso y la ÚLTIMA salida del visitante por los access records,
// consultando tanto el personId del visitante como el de la persona-patente (cubre
// ingreso peatonal por QR y vehicular por barrera). Devuelve { latestIn, latestOut }
// y además `marks`: TODAS las marcas deduplicadas ({ ts, dir, sure, point, channel }),
// que es lo que alimenta los topes de ingreso/salida. DSS NO refleja la salida en el
// visitStatus del módulo de visitas, por eso el último evento de acceso manda.
// Entrada/salida se distingue por el pointName ("Ingreso"/"Salida"); el campo
// direction es poco fiable (suele venir "0" en ambos).
async function fetchVisitorMovement(personIds, startTs, endTs) {
  let latestIn = 0, latestOut = 0;
  const raw = [];
  for (const pid of personIds) {
    if (!pid) continue;
    let r;
    try {
      r = await dssAuthed('POST', '/obms/api/v1.1/acs/access/record/fetch/page', {
        page: 1, pageSize: 100, currentPage: 1,
        startTime: String(startTs), endTime: String(endTs),
        areaCodes: [], eventLevels: ['1', '2', '3'], orgCode: '',
        pointId: '', pointTypes: [], pointName: '',
        personId: String(pid), personName: '', splitId: '', splitTime: '',
      });
    } catch { continue; }
    if (r.body?.code !== 1000) continue;
    const p = r.body.data ?? {};
    for (const x of (p.pageData ?? p.list ?? [])) {
      const pt = String(x.pointName ?? '');
      const t = Number(x.alarmTime ?? 0);
      if (!t) continue;
      // Sólo aperturas reales: un intento RECHAZADO por el lector (Validity Error, Stranger,
      // etc.) también queda en los access records con el personId y antes contaba como
      // ingreso → "en sitio" sin haber entrado.
      if (/error|stranger|invalid|fail|denied|refus|desconocid|inv[aá]lid/i.test(String(x.alarmTypeName ?? ''))) continue;
      // `sure`: el nombre del lector dice explícitamente ingreso/salida. Solo esas
      // marcas cuentan para los topes; con las ambiguas (p.ej. "Estacionamiento",
      // barreras ANPR con nombre libre) se cae a la dirección del propio registro,
      // que es poco fiable, y se mantiene la regla antigua.
      let dir = '', sure = false;
      if (/salida/i.test(pt))               { dir = 'out'; sure = true; }
      else if (/ingreso|entrada/i.test(pt)) { dir = 'in';  sure = true; }
      else {
        const d = String(x.inOutStatus ?? x.direction ?? '').toLowerCase();
        if (d === '1' || d === 'out' || d === 'exit')      dir = 'out';
        else if (d === '0' || d === 'in' || d === 'enter') dir = 'in';
      }
      if (!dir) continue;
      if (dir === 'out') { if (t > latestOut) latestOut = t; }
      else               { if (t > latestIn)  latestIn  = t; }
      raw.push({ ts: t, dir, sure, point: pt, channel: String(x.channelId ?? x.pointId ?? pt) });
    }
  }
  // Quien insiste en el MISMO tótem genera varios registros seguidos: se colapsan
  // en una sola marca para no gatillar el tope de salidas por una sola pasada.
  raw.sort((a, b) => a.ts - b.ts);
  const marks = [];
  const lastSeen = new Map();
  for (const m of raw) {
    const key = `${m.channel}|${m.dir}`;
    const prev = lastSeen.get(key);
    lastSeen.set(key, m.ts);
    if (prev !== undefined && m.ts - prev <= MARK_DEDUPE_S) continue;
    marks.push(m);
  }
  return { latestIn, latestOut, marks };
}

// Detecta el ÚLTIMO ingreso por barrera ANPR de una PATENTE (log de parking, distinto
// del de access records ACS). Cubre el caso en que la persona-patente no quedó vinculada
// (patente ya existente en DSS = conflicto) y por tanto el ingreso no aparece por personId.
async function fetchPlateEntry(plateNo, parking, startTs, endTs) {
  if (!plateNo || !parking?.entranceGroupId) return 0;
  try {
    // NOTA: NO enviar vehicleBrand/vehicleModel/vehicleColor. Al mandarlos como '0'
    // el DSS los interpreta como filtro por marca/modelo id 0 y EXCLUYE los registros
    // reales (verificado: con esos campos la barrera devuelve 0 aunque el ingreso exista).
    const r = await dssAuthed('POST', '/ipms/api/v1.1/entrance/vehicle-enter/record/fetch/page', {
      page: '1', pageSize: '20', currentPage: '1',
      plateNo: normalizePlate(plateNo), personName: '', cardPersonName: '',
      plateNoMatchMode: '1',
      status: '0', orgCode: parking.orgCode || '', cardPersonId: '', company: '', cardNo: '',
      positionIds: [], splitTime: '0', splitId: '',
      startTime: String(startTs), endTime: String(endTs),
      entranceGroupId: parking.entranceGroupId, parkingLotId: parking.parkingLotId || '',
    });
    if (r.body?.code !== 1000) return 0;
    const p = r.body.data ?? {};
    let latest = 0;
    for (const x of (p.list ?? p.pageData ?? [])) {
      const ts = parseDssTsSrv(x.enterTime ?? x.captureTime ?? x.alarmTime ?? x.showTime);
      if (ts > latest) latest = ts;
    }
    return latest;
  } catch { return 0; }
}

// ── Auto-descubrimiento de la config de parking por condominio ────────────────
// Para que un condominio NUEVO (con cámara lectora) quede activo automáticamente,
// resolvemos {orgCode, parkingLotId, entranceGroupId} sin depender de nombres de
// Firestore: el canal de puerta del condo pertenece a un orgName en DSS, y el grupo
// de entrada "General" del parking de ese mismo orgName nos da los IDs. El resultado
// se persiste en el doc del condominio (queda fijo y self-healing).
const _PARKING_MAP_TTL = 30 * 60 * 1000;
let _parkingByOrgNameCache = null;   // { ts, map: Map<normOrgName, {orgCode,parkingLotId,entranceGroupId}> }
let _doorChannelOrgCache = null;     // { ts, map: Map<channelId, orgName> }

function normOrgName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// Mapa orgName(normalizado) → grupo "General" del parking (activo, orgCode != '001').
async function getParkingByOrgName() {
  if (_parkingByOrgNameCache && Date.now() - _parkingByOrgNameCache.ts < _PARKING_MAP_TTL) return _parkingByOrgNameCache.map;
  const eg = await dssAuthed('GET', '/ipms/api/v1.1/entrance-group/list', null);
  const groups = eg.body?.data?.results ?? [];
  const map = new Map();
  for (const g of groups) {
    if (g.groupName !== 'General') continue;
    if (String(g.orgCode) === '001') continue; // descartar lotes legacy (Current Site)
    map.set(normOrgName(g.orgName), { orgCode: String(g.orgCode), parkingLotId: String(g.parkingLotId), entranceGroupId: String(g.groupId) });
  }
  _parkingByOrgNameCache = { ts: Date.now(), map };
  return map;
}

// Mapa channelId → orgName, desde el árbol de canales de puerta (channelTypes=7).
async function getDoorChannelOrgMap() {
  if (_doorChannelOrgCache && Date.now() - _doorChannelOrgCache.ts < _PARKING_MAP_TTL) return _doorChannelOrgCache.map;
  const r = await dssAuthed('GET', '/brms/api/v1.0/tree/deviceOrg?channelTypes=7&sort=&orgCode=', null);
  const map = new Map();
  (function walk(deps) {
    if (!Array.isArray(deps)) return;
    for (const d of deps) {
      if (Array.isArray(d.channel)) for (const c of d.channel) map.set(String(c.id), d.name);
      if (Array.isArray(d.departments)) walk(d.departments);
    }
  })(r.body?.data?.departments ?? []);
  _doorChannelOrgCache = { ts: Date.now(), map };
  return map;
}

// Lista (cacheada) de personas del DSS con su condominio (orgName) y unidad (roomNo).
// Sirve para incluir en el consentimiento a los integrantes del hogar que solo existen
// en el DSS (Person & Vehicle) y no en la app. TTL 10 min (las personas cambian poco).
let _dssPersonsCache = null;
const _DSS_PERSONS_TTL = 10 * 60 * 1000;
async function getDssPersonsCached(force) {
  if (!force && _dssPersonsCache && Date.now() - _dssPersonsCache.ts < _DSS_PERSONS_TTL) return _dssPersonsCache.list;
  const list = [];
  for (let page = 1; page <= 60; page++) {
    const qs = `page=${page}&pageSize=100&orgCode=001&keyword=&containChild=1&accessGroupId=&personId=&liftGroupId=&cardNo=&personName=`;
    let r;
    try { r = await dssAuthed('GET', `/obms/api/v1.1/acs/person/page?${qs}`); }
    catch { break; }
    if (r.body?.code !== 1000) break;
    const payload = r.body.data ?? r.body;
    const pageData = payload.list ?? payload.pageData ?? [];
    for (const raw of pageData) {
      const base = raw.baseInfo ?? raw;
      const resi = raw.residentInfo ?? {};
      const first = String(base.firstName ?? '').trim();
      const last  = String(base.lastName ?? '').trim();
      const name  = (last ? `${first} ${last}` : first) || String(raw.personName ?? '').trim();
      const roomNo = String(base.roomNo ?? raw.roomNo ?? resi.sipId ?? base.personCode ?? raw.personCode ?? '').trim();
      list.push({
        personId: String(base.personId ?? raw.personId ?? raw.id ?? ''),
        name, orgName: String(base.orgName ?? raw.orgName ?? ''),
        orgCode: String(base.orgCode ?? raw.orgCode ?? ''), roomNo,
        faceNum: Number(raw.authenticationInfo?.faceNum ?? base.faceNum ?? 0) || 0,
      });
    }
    // OJO: DSS devuelve `total` falsy (0/undefined) y el conteo real en `totalCount`.
    // Usar `||` (no `??`) para que un `total:0` caiga a totalCount y NO corte en 1 página.
    const total = payload.totalCount || payload.total || pageData.length;
    if (pageData.length === 0 || list.length >= total) break;
  }
  // Dedup por personId (por si el DSS devuelve páginas solapadas → evita filas duplicadas).
  const seen = new Set();
  const deduped = list.filter(p => {
    if (!p.personId) return true;
    if (seen.has(p.personId)) return false;
    seen.add(p.personId); return true;
  });
  _dssPersonsCache = { ts: Date.now(), list: deduped };
  return deduped;
}

// Árbol de organización de PERSONAS del DSS (el "Grupo de personas y vehículos").
// results = lista plana de nodos {orgCode, parentOrgCode, orgName}. El condominio de una
// persona es el nodo ancestro cuyo padre es la raíz "001". Cacheado (TTL 10 min).
let _personOrgTreeCache = null;
async function getPersonOrgTree(force) {
  if (!force && _personOrgTreeCache && Date.now() - _personOrgTreeCache.ts < _DSS_PERSONS_TTL) return _personOrgTreeCache.data;
  let nodes = [];
  try { const r = await dssAuthed('GET', '/obms/api/v1.1/acs/person-group/list'); nodes = r.body?.data?.results ?? []; }
  catch { nodes = []; }
  const ROOT = '001';
  const byCode = new Map();
  for (const n of nodes) byCode.set(String(n.orgCode), { orgName: n.orgName || '', parent: n.parentOrgCode ? String(n.parentOrgCode) : null });
  // topCondo(orgCode): sube hasta el nodo cuyo padre es la raíz = el condominio.
  const topCondo = (orgCode) => {
    let code = String(orgCode || ''); let node = byCode.get(code); let guard = 0;
    if (!node) return null;
    while (node && node.parent && node.parent !== ROOT && guard++ < 20) { code = node.parent; node = byCode.get(code); }
    return node ? { orgCode: code, orgName: node.orgName } : null;
  };
  const topNodes = [];
  for (const [code, n] of byCode) if (n.parent === ROOT) topNodes.push({ orgCode: code, orgName: n.orgName });
  const data = { byCode, topCondo, topNodes };
  _personOrgTreeCache = { ts: Date.now(), data };
  return data;
}

// Devuelve {orgCode, parkingLotId, entranceGroupId} para un condo, o null si no tiene
// parking. 1) usa campos explícitos del doc; 2) auto-descubre por orgName y persiste.
async function resolveCondoParking(condoData, condoRef) {
  if (condoData.dahuaParkingOrgCode && condoData.dahuaParkingLotId && condoData.dahuaEntranceGroupId) {
    return { orgCode: condoData.dahuaParkingOrgCode, parkingLotId: condoData.dahuaParkingLotId, entranceGroupId: condoData.dahuaEntranceGroupId, personOrgCode: condoData.dahuaPersonOrgCode || null };
  }
  const channelIds = condoData.dahuaChannelIds ?? [];
  if (!channelIds.length) return null;
  try {
    const doorMap = await getDoorChannelOrgMap();
    let orgName = null;
    for (const ch of channelIds) { const n = doorMap.get(String(ch)); if (n) { orgName = n; break; } }
    if (!orgName) return null;
    const hit = (await getParkingByOrgName()).get(normOrgName(orgName));
    if (!hit) return null;
    if (condoRef) condoRef.update({
      dahuaParkingOrgCode: hit.orgCode, dahuaParkingLotId: hit.parkingLotId, dahuaEntranceGroupId: hit.entranceGroupId,
    }).catch(() => {});
    console.log(`[DSS Plate] auto-config parking ${condoData.name}: org ${hit.orgCode} lot ${hit.parkingLotId} grupo ${hit.entranceGroupId}`);
    return { ...hit, personOrgCode: condoData.dahuaPersonOrgCode || null };
  } catch (e) {
    console.warn('[DSS Plate] resolveCondoParking error:', e.message);
    return null;
  }
}

async function syncPendingVisitors() {
  if (!DAHUA_HOST || !admin.apps.length) return;
  _jobStats.syncRetry.lastRun = new Date().toISOString();

  if (!_pollerToken) {
    _pollerToken = await pollerDssLogin();
    if (!_pollerToken) return;
  }

  const firestore = admin.firestore();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  try {
    const condosSnap = await firestore.collection('condos').get();

    for (const condoDoc of condosSnap.docs) {
      const condoData = condoDoc.data();
      const channelIds = condoData.dahuaChannelIds ?? [];
      const condoPositionIds = condoData.dahuaPositionIds ?? [];
      if (!channelIds.length) continue;

      // Config de parking del condominio (para empujar la patente al lector LPR).
      // Auto-descubre y persiste si el condominio no la tiene seteada (condos nuevos).
      const parking = await resolveCondoParking(condoData, condoDoc.ref);
      const parkOrg = parking?.orgCode, parkLot = parking?.parkingLotId, parkGrp = parking?.entranceGroupId;
      const parkPersonOrg = parking?.personOrgCode || null;

      let visitorsSnap;
      try {
        visitorsSnap = await firestore
          .collection(`condos/${condoDoc.id}/visitors`)
          .where('date', '>=', cutoffStr)
          .get();
      } catch { continue; }

      // Timestamps locales (Chile -04:00). Usa los pre-calculados por el navegador;
      // si no, los calcula con offset explícito (pases antiguos sin startTs/endTs).
      const toTsLocal = (date, time) =>
        Math.floor(new Date(`${date}T${time || '00:00'}:00-04:00`).getTime() / 1000);
      const toEndTsLocal = (date, entryTime, exitTime) => {
        const s = toTsLocal(date, entryTime);
        let e   = toTsLocal(date, exitTime);
        if (e <= s) e += 86400; // exit is next day (past midnight)
        return e;
      };

      for (const docSnap of visitorsSnap.docs) {
        const v = docSnap.data();

        // 1) Crear el visitante (QR + puertas) en DSS si aún no está sincronizado.
        if (!v.dahuaVisitorId) {
          try {
            const result = await serverDssCreateVisitor(_pollerToken, {
              visitorName: v.visitorName || 'Visitante',
              hostName:    v.hostName    || 'Portería Virtual',
              plate:       v.licensePlate || undefined,
              startTs:     v.startTs ?? toTsLocal(v.date, v.entryTime),
              endTs:       v.endTs   ?? toEndTsLocal(v.date, v.entryTime, v.exitTime),
              acsChannelIds: channelIds,
              positionIds: condoPositionIds,
              // Ingreso manual (operador): crear directamente "en sitio" en DSS.
              visitStatus: (v.manualEntry || v.status === 'entered') ? '1' : '0',
              reason: v.visitReason || undefined,
              // Resync: si el pase ya tenía un QR, reutilizarlo para que no cambie
              // (rompe el loop purga↔resync con QR distinto cada vez).
              reusePassport: (v.dahuaQrCode && v.dahuaPassportCardNo)
                ? { qrcode: v.dahuaQrCode, passportCardNo: v.dahuaPassportCardNo }
                : undefined,
            });

            await docSnap.ref.update({
              dahuaVisitorId:       result.visitorId,
              dahuaPersonId:        result.personId ?? null,
              dahuaQrCode:          result.qrcode,
              dahuaPassportCardNo:  result.passportCardNo ?? null,
              qrReadyAt:            result.qrReadyAt ?? null,
            });
            _jobStats.syncRetry.synced++;
            console.log(`[DSS Sync] ✅ ${v.visitorName} → ${result.visitorId}`);
          } catch (err) {
            if (err.message?.includes('2003') || err.message?.includes('401')) {
              _pollerToken = null; return; // session expired — retry next cycle
            }
            // Antes esto no logueaba nada y un condominio podía quedar días sin emitir
            // QR sin que nadie se enterara. Se registra el motivo por condominio y se
            // repite en el log cada 30 min (o si cambia el error) para no inundarlo.
            registrarErrorSync(condoDoc.id, condoData.name, v.visitorName, err.message);
          }
        }

        // 2) Patente → barrera vehicular (ANPR). Independiente del visitante: registra
        //    la patente en el grupo de parking para que el lector LPR abra la barrera.
        //    Solo si el condominio tiene parking configurado y el pase sigue vigente.
        if (v.licensePlate && parkOrg && parkLot && parkGrp && !v.dahuaPlatePersonId
            && !v.dahuaPlateConflict && v.status !== 'exited' && v.dssStatus !== '4'
            && (v.dahuaPlateAttempts ?? 0) < MAX_PLATE_ATTEMPTS) {
          try {
            const plateRes = await serverDssCreatePlateVehicle(_pollerToken, {
              plateNo: v.licensePlate, visitorName: v.visitorName,
              orgCode: parkOrg, personOrgCode: parkPersonOrg, parkingLotId: parkLot, entranceGroupId: parkGrp,
              startTs: v.startTs ?? toTsLocal(v.date, v.entryTime),
              endTs:   v.endTs   ?? toEndTsLocal(v.date, v.entryTime, v.exitTime),
            });
            if (plateRes?.personId) {
              await docSnap.ref.update({ dahuaPlatePersonId: plateRes.personId });
              console.log(`[DSS Plate] ✅ ${v.visitorName} patente ${normalizePlate(v.licensePlate)} → persona ${plateRes.personId}`);
            } else if (plateRes?.conflict) {
              // La patente ya existe en DSS (visitante anterior con plateNo, o residente).
              // Marcamos el pase para no reintentar cada ciclo (evita spam de logs).
              await docSnap.ref.update({ dahuaPlateConflict: true });
              console.warn(`[DSS Plate] ${v.visitorName} patente ${normalizePlate(v.licensePlate)} en conflicto → marcado, no se reintenta`);
            }
          } catch (err) {
            // 7000 = sesión caída: transitorio, se reintenta con token nuevo y NO gasta intento.
            if (err.message?.includes('2003') || err.message?.includes('401') || err.message?.includes('7000')) {
              _pollerToken = null; return;
            }
            // Error duro (config del DSS, patente inválida…): contamos el intento y
            // dejamos de reintentar al llegar al tope, para no golpear el DSS cada ciclo
            // ni llenar el log. El error queda en el doc para poder diagnosticarlo.
            const intentos = (v.dahuaPlateAttempts ?? 0) + 1;
            await docSnap.ref.update({
              dahuaPlateAttempts: intentos,
              dahuaPlateLastError: String(err.message || '').slice(0, 300),
            }).catch(() => {});
            console.warn(`[DSS Plate] error patente ${v.licensePlate} (intento ${intentos}/${MAX_PLATE_ATTEMPTS}${intentos >= MAX_PLATE_ATTEMPTS ? ' — no se reintenta más' : ''}):`, err.message);
          }
        }
      }
    }
  } catch (err) {
    _jobStats.syncRetry.lastError = err.message;
    console.warn('[DSS Sync] error:', err.message);
    _pollerToken = null;
  }
}

// ── Visitor debug endpoint ────────────────────────────────────────────────────
// GET /api/debug/visitor?name=xxx — looks up visitor DSS fields across all condos.
app.get('/api/debug/visitor', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const name = (req.query.name || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const firestore = admin.firestore();
    const condosSnap = await firestore.collection('condos').get();
    const found = [];
    for (const condoDoc of condosSnap.docs) {
      const snap = await firestore
        .collection(`condos/${condoDoc.id}/visitors`)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      for (const d of snap.docs) {
        const v = d.data();
        if ((v.visitorName || '').toLowerCase().includes(name)) {
          found.push({
            id: d.id,
            condoId: condoDoc.id,
            visitorName: v.visitorName,
            date: v.date,
            entryTime: v.entryTime,
            exitTime: v.exitTime,
            startTs: v.startTs,
            endTs: v.endTs,
            status: v.status,
            dssStatus: v.dssStatus,
            dahuaVisitorId: v.dahuaVisitorId ?? null,
            dahuaPersonId:  v.dahuaPersonId  ?? null,
            dahuaQrCode:    v.dahuaQrCode ? '[present]' : null,
            accessedDoors:  v.accessedDoors  ?? null,
            createdAt: v.createdAt?.toDate?.()?.toISOString() ?? null,
          });
        }
      }
    }
    res.json({ count: found.length, visitors: found });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/debug/qr-health?days=7 — salud de los QR de visita por condominio.
// Recorre Firestore y reporta, por condominio: pases creados, cuántos quedaron
// sincronizados/verificados (dssAuthVerified), cuántos se usaron (ingreso real),
// y los "en riesgo": creados hace > settle y aún sin verificar (posible fallo de
// sincronización en el sistema). Sirve para vigilar todos los condominios.
app.get('/api/debug/qr-health', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  try {
    const firestore = admin.firestore();
    const condosSnap = await firestore.collection('condos').get();
    const condoName = {};
    condosSnap.docs.forEach(c => { condoName[c.id] = c.data().name || c.id; });

    const byCondo = {};
    const atRisk = [];
    for (const condoDoc of condosSnap.docs) {
      let snap;
      try {
        snap = await firestore.collection(`condos/${condoDoc.id}/visitors`)
          .where('date', '>=', cutoffStr).get();
      } catch { continue; }
      for (const d of snap.docs) {
        const v = d.data();
        if (!v.dahuaVisitorId) continue; // solo pases sincronizados con el sistema
        const c = byCondo[condoDoc.id] ||= { condo: condoName[condoDoc.id], synced: 0, verified: 0, used: 0, atRisk: 0 };
        c.synced++;
        if (v.dssAuthVerified) c.verified++;
        if (['1', '3', '4'].includes(String(v.dssStatus ?? ''))) c.used++;
        // En riesgo: ya pasó la ventana de settle y no se verificó ni se usó.
        const ready = v.qrReadyAt || 0;
        if (!v.dssAuthVerified && !['1', '3', '4'].includes(String(v.dssStatus ?? '')) && ready && nowSec > ready + 120) {
          c.atRisk++;
          atRisk.push({ condo: condoName[condoDoc.id], visitorName: v.visitorName, id: d.id, dahuaVisitorId: v.dahuaVisitorId, date: v.date });
        }
      }
    }
    const condos = Object.values(byCondo).sort((a, b) => b.synced - a.synced);
    const totals = condos.reduce((t, c) => ({
      synced: t.synced + c.synced, verified: t.verified + c.verified, used: t.used + c.used, atRisk: t.atRisk + c.atRisk,
    }), { synced: 0, verified: 0, used: 0, atRisk: 0 });
    res.json({ days, totals, condos, atRisk });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/debug/condos — lista los condominios y si tienen dirección cargada
// (para los mensajes de pase de visita).
app.get('/api/debug/condos', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const snap = await admin.firestore().collection('condos').get();
    const condos = snap.docs.map(d => {
      const c = d.data();
      const address = (c.address || '').toString().trim();
      return {
        id: d.id,
        name: c.name || '(sin nombre)',
        address,
        hasAddress: !!address,
        channels: (c.dahuaChannelIds || []).length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      count: condos.length,
      withAddress: condos.filter(c => c.hasAddress).length,
      withoutAddress: condos.filter(c => !c.hasAddress).map(c => c.name),
      condos,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/access-backfill?months=N  (header x-admin-key)
// Dispara el backfill histórico de eventos de acceso (en segundo plano, sesión DSS
// compartida — sin contención). Pausa el poller mientras corre y lo reanuda al final.
app.post('/api/admin/access-backfill', (req, res) => {
  if (!DAHUA_PASS || req.headers['x-admin-key'] !== DAHUA_PASS) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const months = Number(req.query.months || req.body?.months || 6);
  const result = backfillAccessRange(months);
  res.json(result);
});

// GET /api/admin/access-backfill/status  (header x-admin-key)
app.get('/api/admin/access-backfill/status', async (req, res) => {
  if (!DAHUA_PASS || req.headers['x-admin-key'] !== DAHUA_PASS) {
    return res.status(403).json({ error: 'forbidden' });
  }
  let state = null;
  try { state = (await admin.firestore().doc('config/accessSyncState').get()).data(); } catch {}
  res.json({ running: _accessBackfillRunning, state });
});

// POST /api/admin/condo-positions  { condoId, positionIds:[...] }  (header x-admin-key)
// Setea los IDs de barreras vehiculares (puntos de entrada/salida ANPR) de un
// condominio, para que los pases con patente autoricen la barrera correcta.
app.post('/api/admin/condo-positions', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  if (!DAHUA_PASS || req.headers['x-admin-key'] !== DAHUA_PASS) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { condoId, positionIds } = req.body || {};
  if (!condoId || !Array.isArray(positionIds)) {
    return res.status(400).json({ error: 'condoId and positionIds[] required' });
  }
  try {
    const ids = positionIds.map(String);
    await admin.firestore().collection('condos').doc(condoId).update({ dahuaPositionIds: ids });
    res.json({ ok: true, condoId, dahuaPositionIds: ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/condo-parking  { condoId, orgCode, parkingLotId, entranceGroupId }  (header x-admin-key)
// Override manual de la config de parking de un condominio (orgCode + parking lot +
// grupo de entrada "General"), para que los pases con patente bajen al lector LPR.
// Normalmente se auto-descubre (resolveCondoParking); esto es para casos en que el
// orgName del DSS no calza (p.ej. La Torcaza) o para forzar un valor.
app.post('/api/admin/condo-parking', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  if (!DAHUA_PASS || req.headers['x-admin-key'] !== DAHUA_PASS) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { condoId, orgCode, parkingLotId, entranceGroupId } = req.body || {};
  if (!condoId || !orgCode || !parkingLotId || !entranceGroupId) {
    return res.status(400).json({ error: 'condoId, orgCode, parkingLotId, entranceGroupId required' });
  }
  try {
    const cfg = {
      dahuaParkingOrgCode: String(orgCode),
      dahuaParkingLotId: String(parkingLotId),
      dahuaEntranceGroupId: String(entranceGroupId),
    };
    await admin.firestore().collection('condos').doc(condoId).update(cfg);
    res.json({ ok: true, condoId, ...cfg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/debug/doors?name=xxx — calls all three door-fetch strategies and
// returns raw results from each so we can confirm which endpoint works.
app.get('/api/debug/doors', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const name = (req.query.name || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'name required' });

  // Find the visitor in Firestore
  const firestore = admin.firestore();
  let visitor = null;
  const condosSnap = await firestore.collection('condos').get();
  outer: for (const condoDoc of condosSnap.docs) {
    const snap = await firestore.collection(`condos/${condoDoc.id}/visitors`)
      .orderBy('createdAt', 'desc').limit(50).get();
    for (const d of snap.docs) {
      const v = d.data();
      if ((v.visitorName || '').toLowerCase().includes(name)) {
        visitor = { ...v, _id: d.id, _condoId: condoDoc.id };
        break outer;
      }
    }
  }
  if (!visitor) return res.status(404).json({ error: 'visitor not found' });

  // Ensure poller token
  if (!_pollerToken) _pollerToken = await pollerDssLogin();
  if (!_pollerToken) return res.status(503).json({ error: 'DSS login failed' });

  const startTs = visitor.startTs ?? Math.floor(new Date(`${visitor.date}T${visitor.entryTime || '00:00'}:00-04:00`).getTime() / 1000);
  const endTs = Math.floor(Date.now() / 1000);
  const visitorId = visitor.dahuaVisitorId;
  const visitorName = visitor.visitorName;

  // Probe A: full visitor object from DSS (check if door data is embedded)
  let probeA = null, probeAErr = null;
  try {
    const r = await dssRequest('GET', `/obms/api/v1.0/visitors/visitor/${visitorId}`, null, { 'X-Subject-Token': _pollerToken });
    probeA = r?.body;
  } catch (e) { probeAErr = e.message; }

  // Probe B: visitor history GET v1.1
  let probeB = null, probeBErr = null;
  try {
    const qs = new URLSearchParams({ page: '1', pageSize: '100', currentPage: '1', startTime: String(startTs), endTime: String(endTs), visitorId: String(visitorId) }).toString();
    const r = await dssRequest('GET', `/obms/api/v1.1/visitor/history/record/page?${qs}`, null, { 'X-Subject-Token': _pollerToken });
    probeB = r?.body;
  } catch (e) { probeBErr = e.message; }

  // Probe C: visitor history POST v1.0
  let probeC = null, probeCErr = null;
  try {
    const r = await dssRequest('POST', '/obms/api/v1.0/visitor/history/record/page',
      { page: 1, pageSize: 100, currentPage: 1, startTime: String(startTs), endTime: String(endTs), visitorId: String(visitorId) },
      { 'X-Subject-Token': _pollerToken });
    probeC = r?.body;
  } catch (e) { probeCErr = e.message; }

  // Probe D: visitor access records (alternate path)
  let probeD = null, probeDErr = null;
  try {
    const r = await dssRequest('POST', '/obms/api/v1.1/visitor/access/record/page',
      { page: 1, pageSize: 100, currentPage: 1, startTime: String(startTs), endTime: String(endTs), visitorId: String(visitorId) },
      { 'X-Subject-Token': _pollerToken });
    probeD = r?.body;
  } catch (e) { probeDErr = e.message; }

  // Probe E: access records by personId = dahuaVisitorId
  let probeE = null, probeEErr = null;
  try {
    const r = await dssRequest('POST', '/obms/api/v1.1/acs/access/record/fetch/page',
      { page: 1, pageSize: 100, currentPage: 1, startTime: String(startTs), endTime: String(endTs),
        areaCodes: [], eventLevels: ['1', '2', '3'], orgCode: '', pointId: '', pointTypes: [], pointName: '',
        personId: String(visitorId), personName: '', splitId: '', splitTime: '' },
      { 'X-Subject-Token': _pollerToken });
    probeE = r?.body;
  } catch (e) { probeEErr = e.message; }

  res.json({
    visitor: { id: visitor._id, condoId: visitor._condoId, visitorName, visitorId, startTs, endTs },
    probeA_visitorGet:           { error: probeAErr, body: probeA },
    probeB_historyGet_v11:       { error: probeBErr, body: probeB },
    probeC_historyPost_v10:      { error: probeCErr, body: probeC },
    probeD_accessRecordAlt:      { error: probeDErr, body: probeD },
    probeE_accessByVisitorId:    { error: probeEErr, body: probeE },
  });
});

// GET /api/debug/positions — descubre los IDs de las barreras vehiculares
// (entrada/salida ANPR) que se setean en un condominio vía /api/admin/condo-positions.
// Prueba varios endpoints IPMS en paralelo y devuelve la respuesta cruda de cada uno
// para ver cuál lista las "positions" (carriles/barreras) con su id y nombre.
app.get('/api/debug/positions', requireAuth, async (req, res) => {
  if (!DAHUA_HOST) return res.status(503).json({ error: 'Dahua not configured' });

  // Cada probe: [etiqueta, método, path, body|null]
  const probes = [
    ['parkingLotList',      'GET',  '/ipms/api/v1.1/parking-lot/list', null],
    ['entranceGroupList',   'GET',  '/ipms/api/v1.1/entrance-group/list', null],
    ['positionList_v11',    'GET',  '/ipms/api/v1.1/entrance/position/list', null],
    ['positionPage_v11',    'POST', '/ipms/api/v1.1/entrance/position/page',
      { page: 1, pageSize: 200, currentPage: 1 }],
    ['positionList_v10',    'GET',  '/ipms/api/v1.0/entrance/position/list', null],
    ['deviceOrg_anpr',      'GET',  '/brms/api/v1.0/tree/deviceOrg?channelTypes=3&sort=&orgCode=', null],
  ];

  const results = {};
  await Promise.all(probes.map(async ([label, method, path, body]) => {
    try {
      const r = await dssAuthed(method, path, body);
      results[label] = { path, code: r.body?.code, body: r.body };
    } catch (e) {
      results[label] = { path, error: e.message };
    }
  }));

  res.json(results);
});

// ── Status endpoint ───────────────────────────────────────────────────────────
// GET /api/status — returns health of background jobs and DSS connection.
// Protected: only super_admin emails can call it (checked via Firebase Admin).
app.get('/api/status', requireAuth, requireRole([]), async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });

  res.json({
    server:    { uptime: Math.floor(process.uptime()), ts: new Date().toISOString() },
    firebase:  { admin: admin.apps.length > 0 },
    dahua:     { configured: !!DAHUA_HOST, host: DAHUA_HOST || null, sessionActive: !!_pollerToken },
    jobs: {
      statusPoller: {
        interval: '30s',
        lastRun:    _jobStats.poller.lastRun,
        lastError:  _jobStats.poller.lastError,
        notifsSent: _jobStats.poller.notifsSent,
      },
      syncRetry: {
        interval: '60s',
        lastRun:   _jobStats.syncRetry.lastRun,
        lastError: _jobStats.syncRetry.lastError,
        synced:    _jobStats.syncRetry.synced,
        // Condominios que no están logrando sincronizar y por qué (ej: todos sus
        // canales de puerta quedaron huérfanos porque se recrearon en el DSS).
        porCondo: Object.values(_jobStats.syncRetry.porCondo)
          .map(({ _ultimoLog, ...resto }) => resto),
      },
    },
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── WhatsApp Integration ──────────────────────────────────────────────────────
//
// Uses whatsapp-web.js (Puppeteer-based). Requires Chrome installed.
// Chrome path: WA_CHROME_PATH env var, defaults to system Chrome.
// Sessions persist in ./wa_sessions/ (one subfolder per WA number).
// All state is stored in Firestore (waNumbers, waConversations, messages subcollection).
// Frontend reads Firestore via onSnapshot for real-time updates.

function _findChromePath() {
  if (process.env.WA_CHROME_PATH) return process.env.WA_CHROME_PATH;
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const fs = require('fs');
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/local/bin/chromium',
  ];
  const found = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (found) { console.log('[WA] Chrome found at:', found); return found; }
  // No system Chrome — let Puppeteer use its bundled Chromium (whatsapp-web.js ships full puppeteer)
  console.log('[WA] No system Chrome found — will use Puppeteer bundled Chromium');
  return null;
}
const WA_CHROME_PATH = _findChromePath();

// In-memory map: numberId → { client, status }
const _waClients = new Map();
// Debounce timers for auto-evaluation: conversationId → setTimeout handle
const _evalDebounce = new Map();
const EVAL_INACTIVITY_MS = 20 * 60 * 1000; // 20 min of silence → auto-evaluate
// Evita inicializaciones simultáneas del mismo número (colisión de userDataDir).
const _waInitLocks = new Set();
// Números desconectados intencionalmente — no deben auto-reconectar.
const _waIntentionalDisconnects = new Set();
// Timers y contadores de reconexión por número.
const _waReconnectTimers = new Map();
const _waReconnectAttempts = new Map();
// Fallos consecutivos de keepalive por número (requiere >=2 para disparar reconexión).
const _waKeepAliveFailures = new Map();

const WA_MAX_RECONNECT = 20;
const WA_RECONNECT_BASE_MS = 5000;
const WA_RECONNECT_MAX_MS = 60000;

// Reconexión con backoff exponencial + jitter para evitar thundering-herd.
function scheduleWaReconnect(numberId) {
  if (_waIntentionalDisconnects.has(numberId)) return;
  if (_waReconnectTimers.has(numberId)) return;
  const attempts = (_waReconnectAttempts.get(numberId) ?? 0) + 1;
  if (attempts > WA_MAX_RECONNECT) {
    console.error(`[WA] ${numberId}: máximo de reintentos alcanzado (${WA_MAX_RECONNECT})`);
    _waReconnectAttempts.delete(numberId);
    return;
  }
  _waReconnectAttempts.set(numberId, attempts);
  const base = Math.min(WA_RECONNECT_BASE_MS * 2 ** (attempts - 1), WA_RECONNECT_MAX_MS);
  const jitter = Math.floor(Math.random() * 3000);
  const delay = base + jitter;
  console.log(`[WA] ${numberId}: reconexión #${attempts} en ${Math.round(delay / 1000)}s`);
  const timer = setTimeout(() => {
    _waReconnectTimers.delete(numberId);
    if (_waIntentionalDisconnects.has(numberId)) return;
    initWaClient(numberId).catch(e => console.error(`[WA] ${numberId} reconnect:`, e.message));
  }, delay);
  _waReconnectTimers.set(numberId, timer);
}

// Keep-alive: verifica cada 90s que los clientes ready siguen vivos.
// Requiere 2 fallos consecutivos antes de reconectar para evitar falsos positivos.
let _waKeepAliveStarted = false;
function startWaKeepAlive() {
  if (_waKeepAliveStarted) return;
  _waKeepAliveStarted = true;
  setInterval(async () => {
    for (const [numberId, entry] of _waClients.entries()) {
      if (_waIntentionalDisconnects.has(numberId)) continue;
      if (entry.status === 'ready' && entry.client) {
        try {
          const s = await entry.client.getState();
          if (s === 'CONNECTED') {
            _waKeepAliveFailures.delete(numberId);
          } else {
            const fails = (_waKeepAliveFailures.get(numberId) ?? 0) + 1;
            _waKeepAliveFailures.set(numberId, fails);
            console.log(`[WA] ${numberId} keepalive: estado ${s} (fallo consecutivo #${fails})`);
            if (fails >= 2) {
              _waKeepAliveFailures.delete(numberId);
              console.log(`[WA] ${numberId} keepalive: 2 fallos, reconectando…`);
              entry.status = 'disconnected';
              scheduleWaReconnect(numberId);
            }
          }
        } catch {
          const fails = (_waKeepAliveFailures.get(numberId) ?? 0) + 1;
          _waKeepAliveFailures.set(numberId, fails);
          if (fails >= 2) {
            _waKeepAliveFailures.delete(numberId);
            entry.status = 'disconnected';
            scheduleWaReconnect(numberId);
          }
        }
      }
    }
  }, 90_000);
}

// Mata cualquier Chromium que siga usando el userDataDir de esta sesión.
// Usa /proc scan (sin depender de pkill) y también pkill con el bracket trick
// `[s]ession-` que evita que pkill se mate a sí mismo al buscar su propio cmdline.
const WA_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function killWaSessionChrome(numberId) {
  if (process.platform === 'win32') return;
  if (!WA_ID_RE.test(String(numberId))) return; // nunca construir patrones con ids no saneados
  const pattern = `session-${numberId}`;
  let killed = 0;
  let found = 0;

  // 1 — /proc scan con logging explícito para diagnosticar permisos en Hostinger
  try {
    const fs2 = require('fs');
    const pids = fs2.readdirSync('/proc').filter(f => /^\d+$/.test(f));
    for (const pid of pids) {
      try {
        const cmdline = fs2.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
        if (cmdline.includes(pattern)) {
          found++;
          try {
            process.kill(parseInt(pid, 10), 9);
            killed++;
          } catch (ke) {
            console.warn(`[WA] kill pid ${pid} falló: ${ke.message}`);
          }
        }
      } catch {}
    }
    console.log(`[WA] /proc scan: encontrados=${found} matados=${killed} para session-${numberId}`);
  } catch (e) {
    console.warn(`[WA] /proc scan falló: ${e.message}`);
  }

  // 2 — pkill como respaldo
  const { execFileSync } = require('child_process');
  for (const bin of ['/usr/bin/pkill', '/bin/pkill', 'pkill']) {
    try { execFileSync(bin, ['-9', '-f', `[s]ession-${numberId}`], { stdio: 'ignore' }); break; } catch {}
  }
}

// Borra todos los archivos de lock que Chromium deja en la sesión.
function clearWaSessionLock(numberId) {
  if (!WA_ID_RE.test(String(numberId))) return;
  const nodePath = require('path');
  const fs2 = require('fs');
  const dir = nodePath.join('./wa_sessions', `session-${numberId}`);
  const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort', '.org.chromium.Chromium.*'];
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
    const full = nodePath.join(dir, f);
    const existed = fs2.existsSync(full);
    try { fs2.rmSync(full, { force: true }); } catch {}
    if (existed) console.log(`[WA] lock eliminado: ${full}`);
  }
  // También borra cualquier archivo .org.chromium que Chrome deja como socket
  try {
    const files = fs2.readdirSync(dir);
    for (const f of files) {
      if (f.startsWith('.org.chromium') || f.startsWith('Singleton')) {
        try { fs2.rmSync(nodePath.join(dir, f), { force: true }); } catch {}
        console.log(`[WA] lock extra eliminado: ${f}`);
      }
    }
  } catch {}
}

// Limpia locks de TODOS los sessions al arrancar (antes de que cualquier Chrome inicie).
function clearAllWaSessionLocks() {
  if (process.platform === 'win32') return;
  const nodePath = require('path');
  const fs2 = require('fs');
  const base = nodePath.resolve('./wa_sessions');
  try {
    if (!fs2.existsSync(base)) return;
    const dirs = fs2.readdirSync(base).filter(d => d.startsWith('session-'));
    for (const d of dirs) {
      const numberId = d.replace('session-', '');
      clearWaSessionLock(numberId);
    }
    if (dirs.length > 0) console.log(`[WA] Locks limpiados al arrancar: ${dirs.length} sesión(es)`);

    // También mata cualquier Chrome que use wa_sessions (orphans de restart anterior)
    let killed = 0;
    const pids = fs2.readdirSync('/proc').filter(f => /^\d+$/.test(f));
    for (const pid of pids) {
      try {
        const cmdline = fs2.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
        if (cmdline.includes('wa_sessions')) {
          try { process.kill(parseInt(pid, 10), 9); killed++; } catch {}
        }
      } catch {}
    }
    if (killed > 0) console.log(`[WA] Startup: ${killed} Chrome(s) huérfano(s) eliminado(s)`);
  } catch (e) {
    console.warn(`[WA] clearAllWaSessionLocks error: ${e.message}`);
  }
}

// Cierra el cliente y garantiza que el Chromium de la sesión quede muerto.
async function destroyWaClient(numberId, client) {
  if (client) { try { await client.destroy(); } catch {} }
  killWaSessionChrome(numberId);
  clearWaSessionLock(numberId);
}

let _waLib = undefined; // undefined = not tried, false = failed, object = ok

function loadWaLib() {
  if (_waLib !== undefined) return _waLib;
  try {
    const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
    const qrcodeLib = require('qrcode');
    _waLib = { Client, LocalAuth, MessageMedia, qrcode: qrcodeLib };
    console.log('📱 whatsapp-web.js loaded');
  } catch (e) {
    console.warn('⚠️  whatsapp-web.js not available:', e.message);
    _waLib = false;
  }
  return _waLib;
}

let _puppeteerChromeReady = false;
let _chromeInstallPromise = null; // shared promise so concurrent calls wait for same download
let _chromeInstallLog    = [];   // log lines for /api/wa/debug

async function _doInstallPuppeteerChrome() {
  const fs2 = require('fs');
  // executablePath() returns the expected path without checking the file exists — must verify with existsSync
  let existingPath = null;
  try { existingPath = require('puppeteer').executablePath(); } catch {}
  if (existingPath && fs2.existsSync(existingPath)) {
    _puppeteerChromeReady = true;
    console.log('[WA-Install] Chrome already present at:', existingPath);
    return;
  }
  console.log('[WA-Install] Chrome not found at:', existingPath, '— proceeding with download');

  _chromeInstallLog = [];
  const log = msg => { console.log(msg); _chromeInstallLog.push(msg); };

  log('[WA-Install] Starting Chrome download via @puppeteer/browsers...');
  const os = require('os');
  const { install, Browser, detectBrowserPlatform } = require('@puppeteer/browsers');

  const cacheDir = process.env.PUPPETEER_CACHE_DIR ||
    path.join(os.homedir(), '.cache', 'puppeteer');
  const platform = detectBrowserPlatform();
  // Use the exact buildId that puppeteer v24.38.0 ships with (from error: 146.0.7680.31)
  const buildId   = '146.0.7680.31';
  log(`[WA-Install] platform=${platform}  buildId=${buildId}  cacheDir=${cacheDir}`);

  await install({
    browser: Browser.CHROME,
    cacheDir,
    buildId,
    downloadProgressCallback: (dl, total) => {
      if (total > 0 && dl % Math.floor(total / 10) < 1024 * 512) {
        log(`[WA-Install] ${Math.round(dl / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB`);
      }
    },
  });

  // Verify the binary actually exists on disk
  const installedPath = require('puppeteer').executablePath();
  if (!fs2.existsSync(installedPath)) throw new Error(`Chrome download failed — binary missing at ${installedPath}`);
  _puppeteerChromeReady = true;
  log('[WA-Install] Chrome installed and verified OK at: ' + installedPath);
}

function installPuppeteerChrome() {
  if (_chromeInstallPromise) return _chromeInstallPromise;
  _chromeInstallPromise = _doInstallPuppeteerChrome().catch(err => {
    _chromeInstallLog.push(`[WA-Install] FAILED: ${err.message}`);
    console.error('[WA-Install] Failed:', err.message);
    _chromeInstallPromise = null; // allow retry
    throw err;
  });
  return _chromeInstallPromise;
}

async function ensurePuppeteerChrome(db, numberId) {
  if (_puppeteerChromeReady || WA_CHROME_PATH) return;
  await db.collection('waNumbers').doc(numberId)
    .update({ lastError: 'Descargando Chrome por primera vez (~2 min)…' }).catch(() => {});
  await installPuppeteerChrome();
}

// ── WA contact sync ───────────────────────────────────────────────────────────
// Reads all existing chats from the connected WA client and upserts them as
// waConversations in Firestore so operators can see previous conversations
// without waiting for a new incoming message.

async function syncWaContacts(numberId, client) {
  const db = admin.firestore();
  console.log(`[WA] ${numberId} syncing contacts…`);

  const chats = await client.getChats();
  // Only individual chats — skip groups, broadcasts, and status updates
  const individual = chats.filter(c =>
    !c.isGroup &&
    !c.id._serialized.endsWith('@g.us') &&
    !c.id._serialized.endsWith('@broadcast') &&
    c.id._serialized.match(/@(c\.us|lid)$/)
  );

  // Pre-load residents from Firestore to enrich contacts with displayName, condo, and unit
  const usersSnap = await db.collection('users').where('role', 'in', ['resident', 'usuario']).get();
  const phoneMap = new Map(); // last-9-digits → {displayName, condoName, unit}
  for (const ud of usersSnap.docs) {
    const u = ud.data();
    const raw = String(u.phone || u.phoneNumber || '').replace(/\D/g, '');
    const key = raw.slice(-9);
    if (key.length >= 8 && u.displayName) {
      phoneMap.set(key, { displayName: u.displayName, condoName: u.condoName || '', unit: u.unit || '' });
    }
  }
  console.log(`[WA] ${numberId} loaded ${phoneMap.size} residents for phone matching`);

  let created = 0;
  let updated = 0;

  // Process in chunks to stay within Firestore batch limit (500 ops)
  const CHUNK = 200;
  for (let i = 0; i < individual.length; i += CHUNK) {
    const batch = db.batch();
    const slice = individual.slice(i, i + CHUNK);

    for (const chat of slice) {
      const contactId = chat.id._serialized;
      // @lid contacts: id.user is an internal device ID, not a real phone number.
      // getContact().number always returns the real phone regardless of JID type.
      let contactPhone = chat.id.user || contactId.replace(/@(c\.us|lid)$/, '');
      if (contactId.endsWith('@lid')) {
        try {
          const ct = await chat.getContact();
          if (ct?.number) contactPhone = ct.number;
        } catch {}
      }
      const waName = chat.name || contactPhone;
      const lastMsg      = chat.lastMessage;
      const lastMessage  = lastMsg?.body || '';
      const lastMessageAt = lastMsg?.timestamp
        ? admin.firestore.Timestamp.fromMillis(lastMsg.timestamp * 1000)
        : admin.firestore.Timestamp.now();

      // Match with resident by normalized phone (last 9 digits)
      const normKey  = String(contactPhone).replace(/\D/g, '').slice(-9);
      const resident = phoneMap.get(normKey);
      // Replace name only if the WA name looks like a phone number (no letters)
      const looksLikePhone = /^[\d\s\+\-\(\)]+$/.test(String(waName).trim());
      const contactName = (resident?.displayName && looksLikePhone) ? resident.displayName : waName;
      const condoName   = resident?.condoName || '';
      const unit        = resident?.unit || '';

      // Check existing conversation
      const snap = await db.collection('waConversations')
        .where('waNumberId', '==', numberId)
        .where('contactId', '==', contactId)
        .limit(1).get();

      if (snap.empty) {
        const ref = db.collection('waConversations').doc();
        batch.set(ref, {
          waNumberId: numberId, contactId, contactPhone, contactName,
          condoName, unit, lastMessage, lastMessageAt,
          unreadCount: chat.unreadCount || 0,
          createdAt: admin.firestore.Timestamp.now(),
        });
        created++;
      } else {
        const existing = snap.docs[0].data();
        const existingTs = existing.lastMessageAt?.seconds ?? 0;
        const updates = {};
        if (lastMsg?.timestamp > existingTs) {
          updates.contactName = contactName;
          updates.lastMessage = lastMessage;
          updates.lastMessageAt = lastMessageAt;
          updated++;
        }
        // Always patch condoName/unit when we have a resident match and the field is missing
        if (condoName && !existing.condoName) updates.condoName = condoName;
        if (unit      && !existing.unit)      updates.unit      = unit;
        if (Object.keys(updates).length > 0) batch.update(snap.docs[0].ref, updates);
      }
    }
    await batch.commit();
  }

  await db.collection('waNumbers').doc(numberId).update({
    contactsSyncing: false,
    contactsSyncedAt: admin.firestore.Timestamp.now(),
    contactsCount: individual.length,
  }).catch(() => {});

  console.log(`[WA] ${numberId} sync done — ${created} created, ${updated} updated, ${individual.length} total chats`);
  return { created, updated, total: individual.length };
}

// ── WA message history backup ─────────────────────────────────────────────────
// After syncWaContacts, fetches the last MSG_BACKUP_LIMIT messages from each
// conversation and writes them to waConversations/{id}/messages in Firestore.
// Uses waMessageId as document ID so repeated runs are idempotent (no duplicates).
// Skips conversations that already have >= MSG_BACKUP_LIMIT messages saved.

const MSG_BACKUP_LIMIT = 50;

async function syncWaMessages(numberId, client) {
  const db = admin.firestore();
  console.log(`[WA] ${numberId} starting message backup (last ${MSG_BACKUP_LIMIT} per chat)…`);

  const convSnap = await db.collection('waConversations')
    .where('waNumberId', '==', numberId)
    .get();
  if (convSnap.empty) return;

  // Build contactId → conversation doc map
  const convByContactId = new Map();
  for (const doc of convSnap.docs) convByContactId.set(doc.data().contactId, doc);

  // Load all WA chats once
  const chats = await client.getChats();

  let totalSaved = 0;
  let totalSkipped = 0;

  for (const chat of chats) {
    const convDoc = convByContactId.get(chat.id._serialized);
    if (!convDoc) continue;

    // Skip if already has enough messages saved
    const existingCount = (await convDoc.ref.collection('messages').count().get()).data().count;
    if (existingCount >= MSG_BACKUP_LIMIT) { totalSkipped++; continue; }

    try {
      const messages = await chat.fetchMessages({ limit: MSG_BACKUP_LIMIT });
      const conv = convDoc.data();
      const batch = db.batch();
      let count = 0;

      for (const msg of messages) {
        if (!msg.body && !msg.hasMedia) continue;
        const ts = admin.firestore.Timestamp.fromMillis((msg.timestamp || Date.now() / 1000) * 1000);
        // Use waMessageId as doc ID — idempotent across multiple syncs
        const docId = msg.id?.id || `${msg.timestamp}_${Buffer.from(msg.body || '').toString('base64').slice(0, 12)}`;
        batch.set(convDoc.ref.collection('messages').doc(docId), {
          body: msg.body || '',
          fromMe: msg.fromMe || false,
          senderUserId: null,
          senderName: msg.fromMe ? null : (conv.contactName || conv.contactPhone),
          timestamp: ts,
          waMessageId: msg.id?.id || '',
          createdAt: admin.firestore.Timestamp.now(),
        });
        count++;
      }

      if (count > 0) { await batch.commit(); totalSaved += count; }
    } catch (e) {
      console.warn(`[WA] ${numberId} message backup error for ${chat.id._serialized}: ${e.message}`);
    }
  }

  console.log(`[WA] ${numberId} message backup done — ${totalSaved} saved, ${totalSkipped} chats already had history`);
  await db.collection('waNumbers').doc(numberId)
    .update({ messagesSyncedAt: admin.firestore.Timestamp.now() }).catch(() => {});
}

async function initWaClient(numberId) {
  const lib = loadWaLib();
  if (!lib || !admin.apps.length) return;
  const db = admin.firestore();

  // Evita inicializaciones concurrentes del mismo número (colisión de userDataDir).
  if (_waInitLocks.has(numberId)) { console.warn(`[WA] ${numberId} init ya en curso, se omite`); return; }
  _waInitLocks.add(numberId);
  let lockHeld = true;
  const releaseLock = () => { if (lockHeld) { lockHeld = false; _waInitLocks.delete(numberId); } };

  try {
    // Destruye cliente previo + mata Chrome huérfano + limpia lock antes de relanzar.
    const existing = _waClients.get(numberId);
    if (existing) _waClients.delete(numberId);
    await destroyWaClient(numberId, existing?.client ?? null);

    await db.collection('waNumbers').doc(numberId)
      .update({ status: 'connecting', qrDataUrl: null, lastError: null }).catch(() => {});

    await ensurePuppeteerChrome(db, numberId);

    startWaKeepAlive();
    _waIntentionalDisconnects.delete(numberId);

    // Resolve Chrome path at init time (after potential install), not at module load.
    // WA_CHROME_PATH = system Chrome or env override; fallback = puppeteer bundled (now installed).
    let resolvedChromePath = WA_CHROME_PATH;
    if (!resolvedChromePath) {
      try {
        const p = require('puppeteer').executablePath();
        if (require('fs').existsSync(p)) { resolvedChromePath = p; console.log('[WA] Using bundled Chrome at:', p); }
      } catch {}
    }

    const { Client, LocalAuth, qrcode } = lib;
    // --single-process: runs GPU/renderer/browser in one process instead of 4+.
    // Critical for Hostinger shared hosting where 2 WA numbers × 4 Chrome processes = 8 procs
    // which exceeds the memory/process limit. Orphan cleanup at startup handles the
    // SingletonLock issue that --single-process used to cause.
    const puppeteerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--single-process',
      '--renderer-process-limit=1',
      '--disable-software-rasterizer',
      '--disable-breakpad',
    ];
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: numberId, dataPath: './wa_sessions' }),
      puppeteer: {
        ...(resolvedChromePath ? { executablePath: resolvedChromePath } : {}),
        args: puppeteerArgs,
        headless: true,
        timeout: 60000,
      },
    });

    _waClients.set(numberId, { client, status: 'connecting' });

    client.on('qr', async (qr) => {
      const url = await qrcode.toDataURL(qr).catch(() => null);
      if (!url) return;
      if (_waClients.has(numberId)) _waClients.get(numberId).status = 'qr';
      await db.collection('waNumbers').doc(numberId)
        .update({ status: 'qr', qrDataUrl: url }).catch(() => {});
    });

    client.on('authenticated', () => {
      if (_waClients.has(numberId)) _waClients.get(numberId).status = 'authenticated';
    });

    client.on('ready', async () => {
      if (_waClients.has(numberId)) _waClients.get(numberId).status = 'ready';
      // Conexión exitosa — resetear contadores de reconexión y keepalive.
      _waReconnectAttempts.delete(numberId);
      _waKeepAliveFailures.delete(numberId);
      const phone = client.info?.wid?.user || '';
      await db.collection('waNumbers').doc(numberId)
        .update({ status: 'ready', phone, qrDataUrl: null, contactsSyncing: true, lastError: null }).catch(() => {});
      console.log(`[WA] ${numberId} ready — phone: ${phone}`);
      syncWaContacts(numberId, client)
        .then(() => syncWaMessages(numberId, client)
          .catch(e => console.error(`[WA] ${numberId} message backup error:`, e.message)))
        .catch(err => console.error(`[WA] ${numberId} contacts sync error:`, err.message));
    });

    client.on('disconnected', async (reason) => {
      console.log(`[WA] ${numberId} disconnected:`, reason);
      _waClients.delete(numberId);
      _waKeepAliveFailures.delete(numberId);
      // CONFLICT / UNPAIRED / LOGOUT = sesión revocada, el usuario debe reconectar manualmente.
      const terminalReasons = ['LOGOUT', 'CONFLICT', 'UNPAIRED', 'UNLINKING_FROM_PRIMARY'];
      if (terminalReasons.includes(reason)) {
        let lastError = null;
        if (reason === 'CONFLICT') lastError = 'Otra instancia de WhatsApp está activa. Reconecte manualmente.';
        else if (reason === 'UNPAIRED') lastError = 'Sesión desvinculada. Escanee el QR nuevamente.';
        await db.collection('waNumbers').doc(numberId)
          .update({ status: 'disconnected', phone: '', qrDataUrl: null, shouldAutoReconnect: false, ...(lastError ? { lastError } : {}) }).catch(() => {});
      } else {
        await db.collection('waNumbers').doc(numberId)
          .update({ status: 'disconnected', phone: '', qrDataUrl: null }).catch(() => {});
        scheduleWaReconnect(numberId);
      }
    });

    client.on('auth_failure', async (msg) => {
      console.log(`[WA] ${numberId} auth_failure:`, msg);
      _waClients.delete(numberId);
      _waKeepAliveFailures.delete(numberId);
      await db.collection('waNumbers').doc(numberId)
        .update({ status: 'disconnected', qrDataUrl: null }).catch(() => {});
      // Reintenta con backoff — los fallos de auth pueden ser transitorios.
      scheduleWaReconnect(numberId);
    });

    client.on('message', async (msg) => {
      if (msg.from.endsWith('@g.us')) return;
      if (msg.from.endsWith('@broadcast')) return;
      if (!msg.from.match(/@(c\.us|lid)$/)) return;
      try { await handleWaMessage(numberId, msg); } catch (e) {
        console.error('[WA] handleWaMessage error:', e.message);
      }
    });

    // QR timeout: if Chrome doesn't produce a QR in 90s, clean up and surface the error.
    const qrTimeout = setTimeout(async () => {
      const entry = _waClients.get(numberId);
      if (entry && entry.status === 'connecting') {
        console.warn(`[WA] ${numberId} QR timeout — Chrome may have failed to launch`);
        _waClients.delete(numberId);
        await destroyWaClient(numberId, client);
        await db.collection('waNumbers').doc(numberId)
          .update({ status: 'disconnected', lastError: `Timeout: Chrome no pudo iniciarse. Ruta: ${resolvedChromePath}` }).catch(() => {});
      }
    }, 90_000);

    // initialize() es fire-and-forget: liberamos el lock en .finally() en cuanto
    // resuelve o falla, igual que en CRMPV manager.ts. Si falla con "already running"
    // se reintenta automáticamente tras limpiar el lock (evita requerir click manual).
    client.initialize()
      .then(() => { clearTimeout(qrTimeout); })
      .catch(async (err) => {
        clearTimeout(qrTimeout);
        const msg = err.message || String(err);
        console.error(`[WA] ${numberId} initialize error:`, msg);
        _waClients.delete(numberId);
        await destroyWaClient(numberId, client);
        const isBrowserLock = /already running|SingletonLock|ProcessSingleton/i.test(msg);
        await db.collection('waNumbers').doc(numberId)
          .update({ status: 'disconnected', lastError: isBrowserLock ? null : msg }).catch(() => {});
        // Reintenta con backoff exponencial (hasta 10 veces, igual que CRMPV).
        scheduleWaReconnect(numberId);
      })
      .finally(() => releaseLock());

  } catch (err) {
    releaseLock();
    console.error(`[WA] ${numberId} (init setup):`, err.message);
    await admin.firestore().collection('waNumbers').doc(numberId)
      .update({ status: 'disconnected', lastError: err.message }).catch(() => {});
  }
}

// ── Persistencia común de mensajes entrantes (whatsapp-web.js y Cloud API) ────
// Los dos proveedores desembocan aquí con el mismo objeto plano, así que la
// conversación, la ficha del residente, el contador de no leídos y la
// auto-evaluación se comportan igual venga de donde venga el mensaje.
//   m = { contactId, contactPhone, waName, body, ts (Timestamp), hasMedia,
//         mediaBase64, mediaType, waMessageId }
// Busca al residente por teléfono (en todas sus variantes de formato) para mostrar
// nombre, condominio y unidad junto al contacto de WhatsApp.
async function enrichWaContact(contactPhone) {
  const out = { displayName: '', condoName: '', unit: '' };
  const digits = String(contactPhone || '').replace(/\D/g, '');
  const normKey = digits.slice(-9);
  if (normKey.length < 8) return out;
  const possiblePhones = [...new Set([
    digits, `+${digits}`, normKey, `56${normKey}`, `+56${normKey}`,
  ])].slice(0, 10);
  const uSnap = await admin.firestore().collection('users').where('phone', 'in', possiblePhones).limit(1).get().catch(() => null);
  if (uSnap && !uSnap.empty) {
    const u = uSnap.docs[0].data();
    out.displayName = u.displayName || '';
    out.condoName   = u.condoName || '';
    out.unit        = u.unit || '';
  }
  return out;
}

async function persistIncomingWaMessage(numberId, m) {
  const db = admin.firestore();
  const contactId = m.contactId;
  const contactPhone = String(m.contactPhone || '').replace(/\D/g, '') || String(m.contactId || '');
  const body = m.body || '';
  const ts = m.ts;

  // Enrich with Firestore resident data using normalized phone number
  const enr = await enrichWaContact(contactPhone);
  const contactName = enr.displayName || m.waName || contactPhone;
  const condoName = enr.condoName;
  const unit = enr.unit;

  // Buscar la conversación: primero por contactId exacto; si no, por teléfono.
  // El respaldo por teléfono es lo que une el historial cuando un número pasa de
  // whatsapp-web.js (contactId tipo '569…@c.us') a Cloud API (contactId '569…').
  let existing = await db.collection('waConversations')
    .where('waNumberId', '==', numberId).where('contactId', '==', contactId).limit(1).get();
  if (existing.empty && contactPhone) {
    existing = await db.collection('waConversations')
      .where('waNumberId', '==', numberId).where('contactPhone', '==', contactPhone).limit(1).get();
  }

  // Idempotencia: Meta reintenta el webhook si no respondemos a tiempo, y
  // whatsapp-web.js puede re-emitir un mensaje tras reconectar. Mismo id → nada.
  if (m.waMessageId && !existing.empty) {
    const dup = await existing.docs[0].ref.collection('messages')
      .where('waMessageId', '==', m.waMessageId).limit(1).get().catch(() => null);
    if (dup && !dup.empty) return existing.docs[0].ref;
  }

  let convRef;
  if (existing.empty) {
    convRef = db.collection('waConversations').doc();
    await convRef.set({
      waNumberId: numberId, contactId, contactPhone, contactName,
      condoName, unit, lastMessage: body, lastMessageAt: ts, unreadCount: 1,
      lastIncomingAt: ts, respondedToLast: false,
      createdAt: admin.firestore.Timestamp.now(),
    });
  } else {
    convRef = existing.docs[0].ref;
    await convRef.update({
      contactId, contactPhone, contactName, condoName, unit, lastMessage: body, lastMessageAt: ts,
      unreadCount: admin.firestore.FieldValue.increment(1),
      lastIncomingAt: ts, respondedToLast: false,
    });
  }

  await convRef.collection('messages').add({
    body, fromMe: false, senderUserId: null, senderName: null,
    hasMedia:    !!m.hasMedia,
    mediaBase64: m.mediaBase64 || null,
    mediaType:   m.mediaType || null,
    timestamp: ts, waMessageId: m.waMessageId || '',
    createdAt: admin.firestore.Timestamp.now(),
  });

  // Auto-evaluate after 20 min of inactivity (reset on every new message)
  const convId = convRef.id;
  if (_evalDebounce.has(convId)) clearTimeout(_evalDebounce.get(convId));
  _evalDebounce.set(convId, setTimeout(() => {
    _evalDebounce.delete(convId);
    _evaluateConversation(convId)
      .catch(e => console.error('[Eval] auto-eval error:', e.message));
  }, EVAL_INACTIVITY_MS));
  return convRef;
}

// Adaptador whatsapp-web.js → objeto plano común.
async function handleWaMessage(numberId, msg) {
  // contactId is the full JID used for sending (e.g. '5491234@c.us' or '54924092141804@lid')
  const contactId = msg.from;
  const contact = await msg.getContact().catch(() => null);
  // For @lid contacts, msg.from is a device ID, not the real phone number.
  // contact.number always gives the real phone number regardless of JID type.
  const contactPhone = contact?.number || msg.from.replace(/@(c\.us|lid)$/, '');
  const waName = contact?.pushname || contact?.name || contactPhone;
  const ts = admin.firestore.Timestamp.fromMillis((msg.timestamp || Date.now() / 1000) * 1000);

  // Detect incoming media; download images and stickers for inline display
  const isIncomingMedia = msg.hasMedia || false;
  const waMediaType = msg.type || null; // WA type: 'image','sticker','video','audio','ptt','document'
  let incomingThumb = null;
  let incomingMimeType = isIncomingMedia ? waMediaType : null; // fallback to WA type
  if (isIncomingMedia && (waMediaType === 'image' || waMediaType === 'sticker')) {
    try {
      const media = await msg.downloadMedia();
      if (media?.data) {
        incomingMimeType = media.mimetype || 'image/jpeg'; // e.g. 'image/jpeg', 'image/webp'
        // Skip storing if too large to avoid Firestore 1MB doc limit (~540KB binary = 720KB base64)
        if (media.data.length < 720_000) incomingThumb = media.data;
      }
    } catch {}
  }

  await persistIncomingWaMessage(numberId, {
    contactId, contactPhone, waName, body: msg.body || '', ts,
    hasMedia: isIncomingMedia, mediaBase64: incomingThumb, mediaType: incomingMimeType,
    waMessageId: msg.id?.id || '',
  });
}

// ── WhatsApp Cloud API (Meta) ──────────────────────────────────────────────────
// Segundo proveedor de transporte. Un número es 'web' (whatsapp-web.js: Chrome,
// sesión, QR) o 'cloud' (API oficial: sin Chrome ni sesión; Meta entrega los
// mensajes por webhook y se envía por Graph API). Ambos escriben la MISMA
// estructura en Firestore, así que la pantalla de chat no distingue el origen.
//
// Configuración por variables de entorno (nunca en Firestore):
//   WA_CLOUD_TOKEN         token permanente del System User (Meta Business)
//   WA_CLOUD_APP_SECRET    App Secret de la app de Meta — firma de los webhooks
//   WA_CLOUD_VERIFY_TOKEN  cadena inventada por nosotros; Meta la repite al verificar
//   WA_CLOUD_API_VERSION   opcional, por defecto v21.0
// Por número, en waNumbers/{id}: provider:'cloud', cloud:{ phoneNumberId, wabaId, displayPhone }.
// Mientras ningún número tenga provider:'cloud', todo este bloque es inerte.
const waCloud = require('./lib/waCloud.cjs');
const WA_CLOUD_GRAPH = () => `https://graph.facebook.com/${process.env.WA_CLOUD_API_VERSION || 'v21.0'}`;
const waCloudCfg = () => ({
  token:       process.env.WA_CLOUD_TOKEN || '',
  appSecret:   process.env.WA_CLOUD_APP_SECRET || '',
  verifyToken: process.env.WA_CLOUD_VERIFY_TOKEN || '',
});
const waCloudReady = () => { const c = waCloudCfg(); return !!(c.token && c.appSecret && c.verifyToken); };
const esNumeroCloud = (numData) => !!(numData && numData.provider === 'cloud');

// phoneNumberId (de Meta) → id del doc en waNumbers. Caché de 60 s: el webhook llega seguido.
let _waCloudMapCache = { ts: 0, map: new Map() };
async function waCloudNumberIdFor(phoneNumberId) {
  if (!phoneNumberId) return null;
  if (Date.now() - _waCloudMapCache.ts > 60_000) {
    const snap = await admin.firestore().collection('waNumbers').where('provider', '==', 'cloud').get();
    const map = new Map();
    snap.forEach(d => { const pid = d.data().cloud?.phoneNumberId; if (pid) map.set(String(pid), d.id); });
    _waCloudMapCache = { ts: Date.now(), map };
  }
  return _waCloudMapCache.map.get(String(phoneNumberId)) || null;
}

// Llamada a Graph API con el token. Un error de Meta se lanza YA traducido
// (status HTTP + mensaje para el operador) para que el endpoint sólo lo reenvíe.
async function waCloudGraph(path, init = {}) {
  const { token } = waCloudCfg();
  const res = await fetch(`${WA_CLOUD_GRAPH()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const m = waCloud.mapGraphError(json);
    // El detalle completo de Meta va al log: los mensajes traducidos son para el operador.
    console.warn(`[WA-Cloud] Graph ${init.method || 'GET'} ${path} → HTTP ${res.status}: ${JSON.stringify(json?.error || json).slice(0, 900)}`);
    const err = new Error(m.error); err.status = m.status; err.code = m.code; err.detail = m.detail;
    throw err;
  }
  return json;
}

// Descarga un adjunto entrante (imagen/sticker) a base64 con el mismo tope que
// usa whatsapp-web.js, para que la ficha no supere el límite de 1 MB de Firestore.
async function waCloudFetchMedia(mediaId) {
  try {
    const meta = await waCloudGraph(`/${mediaId}`);
    if (!meta?.url) return null;
    const { token } = waCloudCfg();
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { mimeType: meta.mime_type || 'image/jpeg', base64: base64.length < 720_000 ? base64 : null };
  } catch (e) { console.warn('[WA-Cloud] media download:', e.message); return null; }
}

async function waCloudSendText(phoneNumberId, to, body) {
  const json = await waCloudGraph(`/${phoneNumberId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } }),
  });
  return json?.messages?.[0]?.id || '';
}

async function waCloudSendMedia(phoneNumberId, to, base64, mimeType, filename, caption) {
  // 1) subir el binario → media id (Node 20 trae FormData/Blob/fetch nativos)
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: mimeType }), filename || 'archivo');
  const up = await waCloudGraph(`/${phoneNumberId}/media`, { method: 'POST', body: form });
  const mediaId = up?.id;
  if (!mediaId) throw Object.assign(new Error('No se pudo subir el adjunto a WhatsApp'), { status: 502 });
  // 2) enviar según el tipo
  const kind = mimeType.startsWith('image/') ? 'image'
             : mimeType.startsWith('video/') ? 'video'
             : mimeType.startsWith('audio/') ? 'audio' : 'document';
  const obj = { id: mediaId };
  if (kind !== 'audio' && caption) obj.caption = caption;
  if (kind === 'document' && filename) obj.filename = filename;
  const json = await waCloudGraph(`/${phoneNumberId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: kind, [kind]: obj }),
  });
  return json?.messages?.[0]?.id || '';
}

// ── Llamadas por WhatsApp (Calling API de Meta) ───────────────────────────────
// El audio va por WebRTC directo entre el navegador del operador y Meta; el
// servidor sólo hace la señalización: recibe por webhook la oferta SDP del que
// llama (o la respuesta a nuestra oferta), la deja en waCalls/{id} para que el
// navegador la tome por Firestore, y traduce las acciones del operador
// (contestar/rechazar/colgar/llamar) a POST /{phone-number-id}/calls.
//
// waCalls/{id}  (id = wacid de Meta saneado)
//   direction  'inbound' | 'outbound'
//   status     inbound : ringing → connecting → active → ended | missed | rejected | failed
//              outbound: calling → ringing → connecting → active → ended | unanswered | rejected | cancelled | failed
//   offerSdp/answerSdp, acceptedBy, startedBy, startedAt, endedAt, duration, finalizado
const _waCallAcceptTimers = new Map(); // docId → timer del "accept" de respaldo

const waCallDocId = (wacid) => String(wacid || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 1400) || null;

async function waCloudCallAction(phoneNumberId, body) {
  return waCloudGraph(`/${phoneNumberId}/calls`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
}

// Estado de llamadas del número en Meta. Habilitarlas también activa el
// "callback permission": si un usuario nos llama, podemos devolverle la llamada.
async function waCloudGetCalling(phoneNumberId) {
  const json = await waCloudGraph(`/${phoneNumberId}/settings`);
  const c = json?.calling || {};
  return {
    enabled:            c.status === 'ENABLED',
    status:             c.status || 'NOT_SET',
    iconVisibility:     c.call_icon_visibility || 'NOT_SET',
    callbackPermission: c.callback_permission_status || 'NOT_SET',
  };
}
async function waCloudSetCalling(phoneNumberId, enabled) {
  return waCloudGraph(`/${phoneNumberId}/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calling: enabled
      ? { status: 'ENABLED', call_icon_visibility: 'DEFAULT', callback_permission_status: 'ENABLED' }
      : { status: 'DISABLED' } }),
  });
}

// Conversación del contacto en este número; se crea vacía si es la primera vez
// (p. ej. alguien que llama sin haber escrito nunca).
async function findOrCreateWaConversation(numberId, contactPhone, waName) {
  const db = admin.firestore();
  const phone = String(contactPhone || '').replace(/\D/g, '');
  let snap = await db.collection('waConversations')
    .where('waNumberId', '==', numberId).where('contactPhone', '==', phone).limit(1).get();
  if (snap.empty) {
    snap = await db.collection('waConversations')
      .where('waNumberId', '==', numberId).where('contactId', '==', phone).limit(1).get();
  }
  if (!snap.empty) {
    const d = snap.docs[0].data();
    return { ref: snap.docs[0].ref, contactName: d.contactName || waName || phone, condoName: d.condoName || '', unit: d.unit || '' };
  }
  const enr = await enrichWaContact(phone);
  const contactName = enr.displayName || waName || phone;
  const now = admin.firestore.Timestamp.now();
  const ref = db.collection('waConversations').doc();
  await ref.set({
    waNumberId: numberId, contactId: phone, contactPhone: phone, contactName,
    condoName: enr.condoName, unit: enr.unit, lastMessage: '', lastMessageAt: now, unreadCount: 0,
    createdAt: now,
  });
  return { ref, contactName, condoName: enr.condoName, unit: enr.unit };
}

// Deja constancia de la llamada en el chat como un mensaje de tipo 'call'.
const fmtDurLlamada = (seg) => {
  seg = Math.max(0, Math.round(seg || 0));
  const m = Math.floor(seg / 60), s2 = seg % 60;
  return m ? `${m} min ${String(s2).padStart(2, '0')} s` : `${s2} s`;
};
async function registrarLlamadaEnChat(conversationId, call) {
  if (!conversationId) return;
  const db = admin.firestore();
  const convRef = db.collection('waConversations').doc(conversationId);
  const inbound = call.direction === 'inbound';
  const dur = fmtDurLlamada(call.duration);
  let body, fromMe = !inbound, unread = 0;
  if (call.purpose === 'parcel_notice') {
    body = call.status === 'ended' ? `📦 Aviso de encomienda por llamada · ${dur}`
         : call.status === 'rejected' ? '📦 Aviso de encomienda: el contacto no aceptó la llamada'
         : call.status === 'unanswered' ? '📦 Aviso de encomienda: sin respuesta'
         : call.status === 'cancelled' ? '📦 Aviso de encomienda: cancelado'
         : '📦 Aviso de encomienda: la llamada falló';
  } else switch (call.status) {
    case 'ended':      body = inbound ? `📞 Llamada entrante · ${dur}` : `📞 Llamada saliente · ${dur}`; break;
    case 'missed':     body = '📵 Llamada perdida'; unread = 1; break;
    case 'rejected':   body = inbound ? '📵 Llamada rechazada' : '📵 El contacto no aceptó la llamada'; fromMe = true; break;
    case 'unanswered': body = '📵 Llamada sin respuesta'; break;
    case 'cancelled':  body = '📵 Llamada cancelada'; break;
    default:           body = '⚠️ Llamada fallida'; break;
  }
  const who = inbound ? call.acceptedBy : call.startedBy;
  const ts = call.endedAt || admin.firestore.Timestamp.now();
  await convRef.collection('messages').add({
    body, fromMe, type: 'call',
    call: { direction: call.direction, status: call.status, duration: call.duration || 0, waCallId: call.waCallId || '' },
    senderUserId: who?.uid || null, senderName: who?.name || null,
    hasMedia: false, mediaBase64: null, mediaType: null,
    timestamp: ts, waMessageId: '', createdAt: admin.firestore.Timestamp.now(),
  });
  const upd = { lastMessage: body, lastMessageAt: ts, lastCallAt: ts };
  if (unread) upd.unreadCount = admin.firestore.FieldValue.increment(unread);
  if (who?.uid) { upd.lastOperatorId = who.uid; upd.lastOperatorName = who.name || null; }
  await convRef.update(upd).catch(() => {});
}

// Cierra una llamada UNA sola vez (Meta reintenta webhooks y el operador puede
// colgar al mismo tiempo que llega el terminate). Devuelve el doc final o null.
async function finalizarLlamada(ref, info = {}) {
  const db = admin.firestore();
  let final = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data();
    if (d.finalizado) {
      // Sólo completar la duración oficial de Meta si aún no la teníamos.
      if (info.duration && !d.duration) tx.update(ref, { duration: info.duration });
      return;
    }
    const now = admin.firestore.Timestamp.now();
    let status;
    if (info.rejectedByUser)                                     status = 'rejected';
    else if (info.forcedStatus)                                  status = info.forcedStatus;
    else if (d.status === 'active')                              status = 'ended';
    else if (['rejected', 'cancelled'].includes(d.status))       status = d.status;
    else if (info.endStatus === 'FAILED' && d.status !== 'connecting') status = 'failed';
    else if (d.direction === 'inbound' && d.status === 'ringing') status = 'missed';
    else if (d.status === 'connecting')                          status = info.endStatus === 'FAILED' ? 'failed' : 'ended';
    else if (d.direction === 'outbound')                         status = 'unanswered';
    else                                                         status = 'failed';
    const startedMs = d.startedAt?.toMillis ? d.startedAt.toMillis() : 0;
    const duration = info.duration || (status === 'ended' && startedMs ? Math.round((now.toMillis() - startedMs) / 1000) : 0);
    final = { ...d, status, duration, endedAt: now };
    tx.update(ref, {
      status, duration, endedAt: now, finalizado: true, updatedAt: now,
      endStatus: info.endStatus || null, endedBy: info.endedBy || null,
      ...(info.errors ? { errors: JSON.stringify(info.errors).slice(0, 800) } : {}),
    });
  });
  if (_waCallAcceptTimers.has(ref.id)) { clearTimeout(_waCallAcceptTimers.get(ref.id)); _waCallAcceptTimers.delete(ref.id); }
  if (final) await registrarLlamadaEnChat(final.conversationId, final).catch(e => console.warn('[WA-Call] log chat:', e.message));
  return final;
}

// "accept" definitivo en Meta. Lo dispara el navegador cuando el audio quedó
// conectado (así el usuario no pierde las primeras palabras) o, de respaldo, un
// timer: si el accept no llega en ~30-60 s Meta corta la llamada.
async function confirmarLlamada(docId, origen) {
  const ref = admin.firestore().collection('waCalls').doc(docId);
  let call = null;
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data();
    if (d.direction !== 'inbound' || d.acceptSent || d.status !== 'connecting' || !d.answerSdp) return;
    tx.update(ref, { acceptSent: true, acceptOrigin: origen });
    call = d;
  });
  if (_waCallAcceptTimers.has(docId)) { clearTimeout(_waCallAcceptTimers.get(docId)); _waCallAcceptTimers.delete(docId); }
  if (!call) return false;
  try {
    await waCloudCallAction(call.phoneNumberId, {
      call_id: call.waCallId, action: 'accept',
      session: { sdp_type: 'answer', sdp: call.answerSdp },
      biz_opaque_callback_data: call.conversationId || '',
    });
    await ref.update({ status: 'active', startedAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() });
    return true;
  } catch (e) {
    console.warn(`[WA-Call] accept falló (${origen}): ${e.message}`);
    await finalizarLlamada(ref, { forcedStatus: 'failed', endedBy: 'accept-error', errors: { message: e.message, code: e.code } });
    return false;
  }
}

// Eventos del campo "calls" del webhook.
async function waCloudProcessCalls(ev, numberId) {
  const db = admin.firestore();
  const now = () => admin.firestore.Timestamp.now();
  for (const c of ev.calls || []) {
    const docId = waCallDocId(c.waCallId);
    if (!docId) continue;
    const ref = db.collection('waCalls').doc(docId);
    try {
      if (c.event === 'connect' && c.direction === 'inbound') {
        // Llamada ENTRANTE: la oferta SDP del usuario. Queda en 'ringing' para que
        // los operadores del número la vean sonar en la app.
        const conv = await findOrCreateWaConversation(numberId, c.from, c.name);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (snap.exists && snap.data().status !== 'ringing') return; // reintento tardío
          tx.set(ref, {
            waCallId: c.waCallId, waNumberId: numberId, phoneNumberId: ev.phoneNumberId,
            conversationId: conv.ref.id, contactPhone: String(c.from).replace(/\D/g, ''),
            contactName: conv.contactName, condoName: conv.condoName, unit: conv.unit,
            direction: 'inbound', status: 'ringing',
            offerSdp: c.sdp, offerType: c.sdpType || 'offer',
            acceptedBy: null, startedBy: null, startedAt: null, endedAt: null, duration: 0, finalizado: false,
            createdAt: snap.exists ? snap.data().createdAt : now(), ringingAt: now(), updatedAt: now(),
          }, { merge: true });
        });
        console.log(`[WA-Call] entrante de ${c.from} (${conv.contactName}) → ${docId}`);
      } else if (c.event === 'connect') {
        // Respuesta SDP del usuario a NUESTRA llamada: el navegador la aplica y el
        // audio queda conectado.
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const d = snap.exists ? snap.data() : {};
          if (d.finalizado) return;
          tx.set(ref, {
            waCallId: c.waCallId, waNumberId: numberId, phoneNumberId: ev.phoneNumberId,
            direction: 'outbound', contactPhone: String(c.to || d.contactPhone || '').replace(/\D/g, ''),
            answerSdp: c.sdp, answerType: c.sdpType || 'answer',
            status: d.status === 'active' ? 'active' : 'connecting', updatedAt: now(),
            ...(snap.exists ? {} : { createdAt: now(), finalizado: false }),
          }, { merge: true });
        });
      } else if (c.event === 'terminate') {
        await finalizarLlamada(ref, {
          endStatus: c.status || null, duration: c.duration || 0, endedBy: 'meta',
          errors: ev.errors || null,
        });
      }
    } catch (e) { console.error(`[WA-Call] evento ${c.event}:`, e.message); }
  }
  for (const st of ev.callStatuses || []) {
    const docId = waCallDocId(st.waCallId);
    if (!docId) continue;
    const ref = db.collection('waCalls').doc(docId);
    try {
      if (st.status === 'RINGING') {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (snap.exists && snap.data().status === 'calling') tx.update(ref, { status: 'ringing', ringingAt: now(), updatedAt: now() });
        });
      } else if (st.status === 'ACCEPTED') {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const d = snap.data();
          if (d.finalizado || d.status === 'active') return;
          tx.update(ref, { status: 'active', startedAt: d.startedAt || now(), acceptSent: true, updatedAt: now() });
        });
        if (_waCallAcceptTimers.has(docId)) { clearTimeout(_waCallAcceptTimers.get(docId)); _waCallAcceptTimers.delete(docId); }
      } else if (st.status === 'REJECTED') {
        await finalizarLlamada(ref, { rejectedByUser: true, endedBy: 'user' });
      }
    } catch (e) { console.error(`[WA-Call] estado ${st.status}:`, e.message); }
  }
}

// Procesa un evento ya normalizado del webhook: mensajes entrantes, estados de
// entrega y llamadas.
async function waCloudProcess(ev) {
  const numberId = await waCloudNumberIdFor(ev.phoneNumberId);
  if (!numberId) {
    console.warn(`[WA-Cloud] webhook para phoneNumberId ${ev.phoneNumberId} sin número configurado — ignorado`);
    return;
  }
  for (const m of ev.messages) {
    let mediaBase64 = null, mediaType = null, hasMedia = false;
    if (m.media) {
      hasMedia = true; mediaType = m.media.mimeType || m.type;
      if (m.type === 'image' || m.type === 'sticker') {
        const dl = await waCloudFetchMedia(m.media.id);
        if (dl) { mediaBase64 = dl.base64; mediaType = dl.mimeType; }
      }
    }
    const cuerpo = m.text || (hasMedia ? '' : `[${m.type}]`);
    const convRef = await persistIncomingWaMessage(numberId, {
      contactId: m.from, contactPhone: m.from, waName: m.name || m.from, body: cuerpo,
      ts: admin.firestore.Timestamp.fromMillis((m.ts || Math.floor(Date.now() / 1000)) * 1000),
      hasMedia, mediaBase64, mediaType, waMessageId: m.waMessageId,
    }).catch(e => { console.error('[WA-Cloud] persist:', e.message); return null; });
    // Respuesta a la solicitud de permiso para llamar: queda en la conversación
    // para que el botón de llamar sepa si puede iniciar la llamada.
    if (convRef && m.callPermission) {
      await convRef.update({
        callPermission: {
          status:      m.callPermission.response === 'accept' ? 'accepted' : 'rejected',
          isPermanent: m.callPermission.isPermanent,
          expiresAt:   m.callPermission.expiresAt ? admin.firestore.Timestamp.fromMillis(m.callPermission.expiresAt * 1000) : null,
          updatedAt:   admin.firestore.Timestamp.now(),
        },
      }).catch(() => {});
    } else if (convRef) {
      // Respondió a la bienvenida: ahora sí se puede pedir permiso para llamar (ventana de 24 h abierta).
      try {
        const conv = (await convRef.get()).data() || {};
        if (conv.autoCallPermission && !conv.callPermission?.status) {
          const numData = (await admin.firestore().collection('waNumbers').doc(numberId).get()).data() || {};
          if (esNumeroCloud(numData) && numData.cloud?.phoneNumberId) {
            await enviarSolicitudPermisoLlamada(convRef, conv, numData, null);
            console.log(`[WA-Cloud] permiso de llamada solicitado automáticamente a ${conv.contactPhone}`);
          }
        }
      } catch (e) { console.warn('[WA-Cloud] permiso automático:', e.message); }
    }
  }
  if ((ev.calls && ev.calls.length) || (ev.callStatuses && ev.callStatuses.length)) {
    await waCloudProcessCalls(ev, numberId);
  }
  // Estados de lo que ENVIAMOS: sent → delivered → read (o failed, con el motivo).
  for (const st of ev.statuses) {
    if (!st.waMessageId || !st.recipientId) continue;
    try {
      const conv = await admin.firestore().collection('waConversations')
        .where('waNumberId', '==', numberId).where('contactPhone', '==', st.recipientId).limit(1).get();
      if (conv.empty) continue;
      const msgs = await conv.docs[0].ref.collection('messages').where('waMessageId', '==', st.waMessageId).limit(1).get();
      if (msgs.empty) continue;
      const upd = { deliveryStatus: st.status };
      if (st.status === 'failed' && st.errors) upd.deliveryError = JSON.stringify(st.errors).slice(0, 500);
      await msgs.docs[0].ref.update(upd);
    } catch (e) { console.warn('[WA-Cloud] status:', e.message); }
  }
}

// Relé del webhook. Meta admite UNA sola URL de callback por app, y esta app la
// comparte con PVCRM (porteriavirtual.cloud). Para que los dos sistemas sigan
// recibiendo, nuestro webhook reenvía cada evento ya verificado a PVCRM con el
// cuerpo crudo y la firma originales: como es la misma app de Meta, PVCRM valida
// la firma con su propio App Secret y no nota la diferencia. Fire-and-forget con
// tope de tiempo: un PVCRM lento o caído no puede frenar nuestra respuesta a Meta.
//   WA_CLOUD_RELAY_URL     destino del reenvío (vacío = sin relé)
//   WA_CLOUD_RELAY_SECRET  opcional: si el destino usa OTRO App Secret, se re-firma
function waCloudRelay(rawBody, firmaOriginal) {
  const url = process.env.WA_CLOUD_RELAY_URL;
  if (!url || !rawBody) return;
  const secretDestino = process.env.WA_CLOUD_RELAY_SECRET;
  const firma = secretDestino
    ? 'sha256=' + crypto.createHmac('sha256', secretDestino).update(rawBody).digest('hex')
    : firmaOriginal;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  fetch(url, {
    method: 'POST', signal: ctl.signal,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma || '' },
    body: rawBody,
  }).then(r => {
    if (!r.ok) console.warn(`[WA-Cloud] relé a ${url} respondió HTTP ${r.status}`);
  }).catch(e => console.warn(`[WA-Cloud] relé a ${url} falló: ${e.message}`))
    .finally(() => clearTimeout(t));
}

// Verificación del webhook: Meta hace un GET con hub.* al registrar la URL.
// Registrado ANTES del muro de autenticación: Meta no tiene token de Firebase.
app.get('/api/wa/cloud/webhook', (req, res) => {
  const { verifyToken } = waCloudCfg();
  if (!verifyToken) return res.status(503).send('WA_CLOUD_VERIFY_TOKEN no configurado');
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WA-Cloud] webhook verificado por Meta');
    return res.status(200).send(String(challenge ?? ''));
  }
  return res.status(403).send('Token de verificación incorrecto');
});

// Entrega de eventos. La firma HMAC es el único control de acceso: sin ella
// cualquiera podría inyectar mensajes. Se responde 200 de inmediato y se
// procesa aparte, porque Meta reintenta si tardamos y eso duplicaría mensajes.
app.post('/api/wa/cloud/webhook', (req, res) => {
  const { appSecret } = waCloudCfg();
  if (!appSecret) return res.status(503).json({ error: 'WA_CLOUD_APP_SECRET no configurado' });
  if (!waCloud.verifySignature(req.rawBody, req.get('X-Hub-Signature-256'), appSecret)) {
    console.warn('[WA-Cloud] webhook con firma inválida — rechazado');
    return res.status(401).json({ error: 'Firma inválida' });
  }
  res.sendStatus(200);
  waCloudRelay(req.rawBody, req.get('X-Hub-Signature-256'));
  if (!admin.apps.length) return;
  for (const ev of waCloud.normalizeWebhook(req.body)) {
    waCloudProcess(ev).catch(e => console.error('[WA-Cloud] process:', e.message));
  }
});

// Al arrancar, deja visible el estado de los números por API: 'ready' si hay
// token y Phone Number ID; si no, 'disconnected' con el motivo en la tarjeta.
async function markCloudNumbersOnStartup() {
  if (!admin.apps.length) return;
  try {
    const snap = await admin.firestore().collection('waNumbers').where('provider', '==', 'cloud').get();
    for (const d of snap.docs) {
      const pid = d.data().cloud?.phoneNumberId;
      const ok = waCloudReady() && !!pid;
      await d.ref.update({
        status: ok ? 'ready' : 'disconnected', qrDataUrl: null, shouldAutoReconnect: false,
        lastError: ok ? null : (!pid
          ? 'Falta el Phone Number ID de Meta'
          : 'Faltan WA_CLOUD_TOKEN / WA_CLOUD_APP_SECRET / WA_CLOUD_VERIFY_TOKEN en el servidor'),
      }).catch(() => {});
    }
    if (snap.size) console.log(`[WA-Cloud] ${snap.size} número(s) por API · configuración ${waCloudReady() ? 'completa' : 'INCOMPLETA'}`);
  } catch (e) { console.warn('[WA-Cloud] startup:', e.message); }
}

// ── Seguridad: todos los endpoints de WhatsApp requieren sesión autenticada ────
// Manejan datos personales de contacto (números, conversaciones, envío de mensajes),
// por lo que no pueden quedar abiertos. Se exige token de Firebase en todo /api/wa/*.
// La única excepción es /api/wa/cloud/webhook, registrado más arriba: lo llama
// Meta, sin token de Firebase, y se protege con la firma HMAC del cuerpo.
app.use('/api/wa', requireAuth, requireRole(['condo_admin', 'administrador', 'operator', 'technician']));
// El id de número se usa en rutas de disco y procesos: sólo [A-Za-z0-9_-].
app.use('/api/wa/numbers/:id', (req, res, next) => WA_ID_RE.test(String(req.params.id || '')) ? next() : res.status(400).json({ error: 'id inválido' }));

// GET /api/wa/numbers
app.get('/api/wa/numbers', async (_req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const snap = await admin.firestore().collection('waNumbers').orderBy('createdAt').get();
    const numbers = snap.docs.map(d => {
      const data = d.data();
      delete data.qrDataUrl; // never send QR via REST (it's in Firestore for onSnapshot)
      return { id: d.id, ...data };
    });
    res.json(numbers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/numbers
app.post('/api/wa/numbers', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const ref = await admin.firestore().collection('waNumbers').add({
      name, phone: '', status: 'disconnected', qrDataUrl: null,
      assignedUsers: [],
      createdAt: admin.firestore.Timestamp.now(),
    });
    res.json({ id: ref.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/wa/numbers/:id
app.put('/api/wa/numbers/:id', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { name, assignedUsers, provider, cloud } = req.body || {};
  const update = {};
  if (name !== undefined)          update.name = name;
  if (assignedUsers !== undefined) update.assignedUsers = Array.isArray(assignedUsers) ? assignedUsers : [];

  // Cambiar el proveedor o los datos de Meta es configuración de plataforma:
  // sólo super_admin. Nombre y operadores los sigue editando quien ya podía.
  if (provider !== undefined || cloud !== undefined) {
    const prof = await callerProfile(req);
    if (!callerIsSuper(prof)) return res.status(403).json({ error: 'Sólo un super administrador puede cambiar la conexión del número.' });
    if (provider !== undefined) {
      if (!['web', 'cloud'].includes(provider)) return res.status(400).json({ error: "provider debe ser 'web' o 'cloud'" });
      update.provider = provider;
    }
    if (cloud !== undefined) {
      const c = cloud || {};
      update['cloud.phoneNumberId'] = String(c.phoneNumberId || '').replace(/\D/g, '');
      update['cloud.wabaId']        = String(c.wabaId || '').replace(/\D/g, '');
      update['cloud.displayPhone']  = String(c.displayPhone || '').trim();
    }
  }

  try {
    const ref   = admin.firestore().collection('waNumbers').doc(req.params.id);
    const antes = (await ref.get()).data() || {};
    const cambiaProveedor = update.provider !== undefined && update.provider !== (antes.provider || 'web');
    if (cambiaProveedor) {
      // Al cambiar de transporte se apaga lo que hubiera del anterior y el número
      // vuelve a "desconectado": el siguiente paso es Conectar con el nuevo.
      if (_waClients.has(req.params.id)) {
        try { await _waClients.get(req.params.id).client.destroy(); } catch {}
        _waClients.delete(req.params.id);
      }
      if (update.provider === 'cloud') { killWaSessionChrome(req.params.id); clearWaSessionLock(req.params.id); }
      Object.assign(update, { status: 'disconnected', qrDataUrl: null, shouldAutoReconnect: false, lastError: null });
    }
    await ref.update(update);
    _waCloudMapCache.ts = 0;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-cambio de puesto del operador (Operador 1 <-> Operador 2) ───────────
// El grupo DEFINE los condominios y el número de WhatsApp del puesto. Un
// operador puede cambiarse a sí mismo entre Operador 1 y Operador 2 (emergencia).
// Se hace en el backend (admin) para no abrir las reglas ni permitir condominios
// arbitrarios: el operador solo elige op1/op2 y se aplica el set canónico.
const OPERATOR_GROUP_CONDOS = {
  operador1: ['K0wio8h9EE7EM5Xs6Vcw', 'iIDV0tfObl80vACtxBCd', 'nF2VwV3RqqdXvsylkRco',
              'sECnsFbxMQHnjqvaESJu', 'kLqtxHZLejK27Ik52pMQ'],
  operador2: ['0RWRDUgw4qWebi8Laici', '2JP9jEeMx2d3aIYJJSPr', '72GlxDLCD8RbDh0yYQCx',
              'LhFPe2LSrqZmhjPFAF9C', 'WywRVcq5fPGX2YlbiUUW', 'uDRhIIwqal7ojqlSBzpK',
              'Vc8MyuGJ3ouReuVrPeK7'],
};
app.post('/api/operator/switch-group', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const grupo = (req.body || {}).group;
  if (!['operador1', 'operador2', 'parttime'].includes(grupo)) {
    return res.status(400).json({ error: 'Grupo inválido (operador1, operador2 o parttime).' });
  }
  const firestore = admin.firestore();
  const uid = req.user.uid;
  try {
    const prof = (await firestore.collection('users').doc(uid).get()).data() || {};
    if (prof.role !== 'operator') return res.status(403).json({ error: 'Solo operadores pueden cambiar de puesto.' });
    // El puesto "Part time" sólo lo toma quien tiene ese tipo de contrato. Se
    // valida en el servidor: la interfaz oculta la opción, pero eso no basta.
    if (grupo === 'parttime' && prof.esPartTime !== true && prof.operatorGroup !== 'parttime') {
      return res.status(403).json({ error: 'Solo un operador part time puede tomar ese puesto.' });
    }

    // El part time cubre TODOS los condominios; los puestos, su set canónico.
    const esPartTime = grupo === 'parttime';
    let ids, condoName;
    if (esPartTime) {
      const todos = await firestore.collection('condos').get();
      ids = todos.docs.map(d => d.id);
      condoName = 'Todos los condominios';
    } else {
      ids = OPERATOR_GROUP_CONDOS[grupo];
      condoName = '';
      try {
        const snaps = await Promise.all(ids.map(id => firestore.collection('condos').doc(id).get()));
        condoName = snaps.map(s => s.exists ? (s.data().name || '') : '').filter(Boolean).join(', ');
      } catch {}
    }

    // El teléfono de la ficha sigue al PUESTO (config/operatorPosts): es el número que
    // los residentes ven para llamar/escribir. El part time cubre ambos números; la app
    // del residente elige el del puesto de su condominio, así que su ficha no se toca.
    const postsDoc = await firestore.collection('config').doc('operatorPosts').get().catch(() => null);
    const postPhone = !esPartTime ? (postsDoc?.exists ? postsDoc.data()?.[grupo]?.phone : null) : null;
    await firestore.collection('users').doc(uid).update({
      operatorGroup: grupo,
      condoScope: esPartTime ? 'all' : 'multiple',
      condoId: esPartTime ? '' : ids[0],
      condoIds: ids,
      condoName, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(postPhone ? { phone: postPhone, phoneFromPost: true } : {}),
    });

    // Mover el WhatsApp: entrar al número del nuevo puesto, salir del otro.
    const nums = await firestore.collection('waNumbers')
      .where('operatorGroup', 'in', ['operador1', 'operador2']).get();
    for (const d of nums.docs) {
      const n = d.data();
      const actuales = Array.isArray(n.assignedUsers) ? n.assignedUsers : [];
      const tiene = actuales.some(u => u.uid === uid);
      // El part time atiende los DOS números; un puesto, sólo el suyo.
      const debe = esPartTime ? true : n.operatorGroup === grupo;
      if (tiene === debe) continue;
      const nuevos = debe ? [...actuales, { uid, name: prof.name || '' }]
                          : actuales.filter(u => u.uid !== uid);
      await firestore.collection('waNumbers').doc(d.id).update({ assignedUsers: nuevos });
    }
    res.json({ ok: true, group: grupo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/wa/numbers/:id
app.delete('/api/wa/numbers/:id', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  if (!callerIsSuper(await callerProfile(req))) return res.status(403).json({ error: 'Sólo super administrador' });
  const id = req.params.id;
  try {
    if (_waClients.has(id)) {
      try { await _waClients.get(id).client.destroy(); } catch {}
      _waClients.delete(id);
    }
    killWaSessionChrome(id);
    clearWaSessionLock(id);
    await admin.firestore().collection('waNumbers').doc(id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/wa/debug
app.get('/api/wa/debug', (_req, res) => {
  const fs = require('fs');
  let puppeteerChromium = null;
  try { puppeteerChromium = require('puppeteer').executablePath(); } catch {}
  res.json({
    chromePath: WA_CHROME_PATH,
    chromeExists: WA_CHROME_PATH ? (() => { try { return fs.existsSync(WA_CHROME_PATH); } catch { return false; } })() : false,
    puppeteerBundledChromium: puppeteerChromium,
    puppeteerChromiumReady: _puppeteerChromeReady,
    installInProgress: !!_chromeInstallPromise && !_puppeteerChromeReady,
    installLog: _chromeInstallLog,
    waLibLoaded: !!loadWaLib(),
    platform: process.platform,
    activeClients: [..._waClients.entries()].map(([id, v]) => ({ id, status: v.status })),
    cloud: {
      configured:     waCloudReady(),
      hasToken:       !!process.env.WA_CLOUD_TOKEN,
      hasAppSecret:   !!process.env.WA_CLOUD_APP_SECRET,
      hasVerifyToken: !!process.env.WA_CLOUD_VERIFY_TOKEN,
      apiVersion:     process.env.WA_CLOUD_API_VERSION || 'v21.0',
      webhookPath:    '/api/wa/cloud/webhook',
      relayTo:        process.env.WA_CLOUD_RELAY_URL || null,
      relayResigns:   !!process.env.WA_CLOUD_RELAY_SECRET,
      callingTimers:  _waCallAcceptTimers.size,
    },
  });
});

// POST /api/wa/install-chrome — trigger Chrome download manually
app.post('/api/wa/install-chrome', async (req, res) => {
  if (!callerIsSuper(await callerProfile(req))) return res.status(403).json({ error: 'Sólo super administrador' });
  if (_puppeteerChromeReady || WA_CHROME_PATH) return res.json({ ok: true, message: 'Chrome ya disponible' });
  installPuppeteerChrome().catch(() => {});
  res.json({ ok: true, message: 'Descarga iniciada — revisa /api/wa/debug para el progreso' });
});

// POST /api/wa/numbers/:id/force-reset
// Elimina completamente la sesión Chrome de un número: mata el proceso, borra el
// directorio de sesión completo y resetea el estado en Firestore. Útil cuando
// "browser already running" impide reconectar.
app.post('/api/wa/numbers/:id/force-reset', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  if (!callerIsSuper(await callerProfile(req))) return res.status(403).json({ error: 'Sólo super administrador' });
  const id = req.params.id;
  const fSnap = await admin.firestore().collection('waNumbers').doc(id).get().catch(() => null);
  if (fSnap && fSnap.exists && esNumeroCloud(fSnap.data())) {
    return res.status(400).json({ error: 'No aplica: un número por API no tiene sesión de Chrome que resetear.' });
  }
  try {
    // 1 — destroy in-memory client if exists
    if (_waClients.has(id)) {
      try { await _waClients.get(id).client.destroy(); } catch {}
      _waClients.delete(id);
    }
    _waInitLocks.delete(id);

    // 2 — kill ALL Chrome processes for this session
    killWaSessionChrome(id);
    await new Promise(r => setTimeout(r, 2000));

    // 3 — nuke the entire session directory (forces fresh QR on next connect)
    const fs   = require('fs');
    const path = require('path');
    const sessionDir = path.resolve(`./wa_sessions/session-${id}`);
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}

    // 4 — reset Firestore status
    await admin.firestore().collection('waNumbers').doc(id)
      .update({ status: 'disconnected', qrDataUrl: null, lastError: null }).catch(() => {});

    console.log(`[WA] force-reset completado para ${id}`);
    res.json({ ok: true, message: 'Sesión eliminada — reconecta para escanear nuevo QR' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wa/numbers/:id/connect
app.post('/api/wa/numbers/:id/connect', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const id = req.params.id;
  const doc = await admin.firestore().collection('waNumbers').doc(id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Number not found' });
  const numData = doc.data();
  if (esNumeroCloud(numData)) {
    // Por API no hay Chrome ni QR: "conectar" es comprobar que la configuración está completa.
    const pid = numData.cloud?.phoneNumberId;
    if (!pid) return res.status(400).json({ error: 'Falta el Phone Number ID de Meta. Edita el número para ingresarlo.' });
    if (!waCloudReady()) return res.status(503).json({ error: 'Faltan WA_CLOUD_TOKEN / WA_CLOUD_APP_SECRET / WA_CLOUD_VERIFY_TOKEN en el servidor.' });
    await admin.firestore().collection('waNumbers').doc(id).update({
      status: 'ready', qrDataUrl: null, lastError: null, shouldAutoReconnect: false,
      phone: numData.cloud?.displayPhone || numData.phone || '',
    });
    _waCloudMapCache.ts = 0; // refrescar el mapa phoneNumberId → número
    return res.json({ ok: true, provider: 'cloud' });
  }
  if (!loadWaLib()) return res.status(503).json({ error: 'whatsapp-web.js not available — check server dependencies and Chrome installation' });
  if (!numData.assignedUsers || numData.assignedUsers.length === 0) {
    return res.status(400).json({ error: 'Debes asignar al menos un operador antes de activar este número.' });
  }
  // Marca que este número debe auto-reconectarse en futuros reinicios del servidor.
  await admin.firestore().collection('waNumbers').doc(id)
    .update({ shouldAutoReconnect: true }).catch(() => {});
  // Fire-and-forget — client emits status/QR updates to Firestore
  initWaClient(id).catch(err => console.error('[WA] initWaClient:', err.message));
  res.json({ ok: true });
});

// POST /api/wa/numbers/:id/disconnect
app.post('/api/wa/numbers/:id/disconnect', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const id = req.params.id;
  const dSnap = await admin.firestore().collection('waNumbers').doc(id).get().catch(() => null);
  if (dSnap && dSnap.exists && esNumeroCloud(dSnap.data())) {
    // Pausar un número por API: deja de poder ENVIARSE por él. Lo entrante se
    // sigue guardando — Meta lo entrega igual y perderlo sería peor.
    await dSnap.ref.update({ status: 'disconnected', qrDataUrl: null, shouldAutoReconnect: false });
    return res.json({ ok: true, provider: 'cloud' });
  }
  try {
    _waIntentionalDisconnects.add(id);
    if (_waReconnectTimers.has(id)) { clearTimeout(_waReconnectTimers.get(id)); _waReconnectTimers.delete(id); }
    _waReconnectAttempts.delete(id);
    if (_waClients.has(id)) {
      try { await _waClients.get(id).client.destroy(); } catch {}
      _waClients.delete(id);
    }
    killWaSessionChrome(id);
    clearWaSessionLock(id);
    await admin.firestore().collection('waNumbers').doc(id)
      .update({ status: 'disconnected', phone: '', qrDataUrl: null, shouldAutoReconnect: false });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/numbers/:id/sync-contacts
// Manually re-triggers contact sync for a connected WA number.
app.post('/api/wa/numbers/:id/sync-contacts', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const id = req.params.id;
  const sSnap = await admin.firestore().collection('waNumbers').doc(id).get().catch(() => null);
  if (sSnap && sSnap.exists && esNumeroCloud(sSnap.data())) {
    return res.status(400).json({ error: 'No aplica: los números por API no exponen la agenda del teléfono. Usa la importación CSV.' });
  }
  const entry = _waClients.get(id);
  if (!entry || entry.status !== 'ready') {
    return res.status(409).json({ error: 'El número no está conectado' });
  }
  // Mark as syncing
  await admin.firestore().collection('waNumbers').doc(id)
    .update({ contactsSyncing: true }).catch(() => {});
  // Fire-and-forget
  syncWaContacts(id, entry.client).catch(err => {
    console.error(`[WA] manual sync error for ${id}:`, err.message);
    admin.firestore().collection('waNumbers').doc(id)
      .update({ contactsSyncing: false }).catch(() => {});
  });
  res.json({ ok: true, message: 'Sincronización iniciada' });
});

// GET /api/wa/conversations
app.get('/api/wa/conversations', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { waNumberId } = req.query;
  try {
    let q = admin.firestore().collection('waConversations').orderBy('lastMessageAt', 'desc');
    if (waNumberId) q = q.where('waNumberId', '==', waNumberId);
    const snap = await q.get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/conversations/:id/send
app.post('/api/wa/conversations/:id/send', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { body, senderName, mediaBase64, mediaType, mediaFilename } = req.body || {};
  // Identidad del emisor: SIEMPRE la del usuario autenticado (no del body, que era suplantable).
  const senderUserId = req.user?.uid || null;
  if (!body?.trim() && !mediaBase64) return res.status(400).json({ error: 'body or mediaBase64 is required' });
  try {
    const convDoc = await admin.firestore().collection('waConversations').doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convDoc.data();

    // El proveedor del número decide por dónde sale el mensaje.
    const numDoc   = await admin.firestore().collection('waNumbers').doc(conv.waNumberId).get();
    const numData  = numDoc.data() || {};
    const porCloud = esNumeroCloud(numData);

    // Validate the transport is available
    let clientEntry = null;
    if (porCloud) {
      if (!waCloudReady() || !numData.cloud?.phoneNumberId) {
        return res.status(409).json({ error: 'El número por API no está configurado (token o Phone Number ID).' });
      }
      if (numData.status !== 'ready') {
        return res.status(409).json({ error: 'El número está pausado. Actívalo en WhatsApp — Números.' });
      }
    } else {
      clientEntry = _waClients.get(conv.waNumberId);
      if (!clientEntry || clientEntry.status !== 'ready') {
        return res.status(409).json({ error: 'WhatsApp number is not connected' });
      }
    }

    // Chequeo OBLIGATORIO: el emisor autenticado debe estar asignado a este número
    // (o ser super_admin/condo_admin). Ya no depende de un senderUserId enviado por el cliente.
    {
      const isAssigned = (numData.assignedUsers || []).some(u => u.uid === senderUserId);
      if (!isAssigned) {
        const prof = await callerProfile(req);
        if (!(callerIsSuper(prof) || prof.role === 'condo_admin')) {
          return res.status(403).json({ error: 'No tienes permiso para enviar mensajes por este número.' });
        }
      }
    }

    let waMessageId = '';
    if (porCloud) {
      // Cloud API envía al número en formato internacional sin '+' (el wa_id de Meta).
      const to = String(conv.contactPhone || conv.contactId || '').replace(/\D/g, '');
      try {
        waMessageId = mediaBase64
          ? await waCloudSendMedia(numData.cloud.phoneNumberId, to, mediaBase64, mediaType || 'image/jpeg', mediaFilename || 'image.jpg', body || '')
          : await waCloudSendText(numData.cloud.phoneNumberId, to, body);
      } catch (e) {
        // Los errores de Meta llegan ya traducidos (ventana de 24 h, token vencido, número inválido…).
        return res.status(e.status || 502).json({ error: e.message, code: e.code || null });
      }
    } else {
      // Use stored contactId (full JID: @c.us or @lid); fall back for old docs without it
      const waJid = conv.contactId || `${conv.contactPhone}@c.us`;
      if (mediaBase64) {
        const { MessageMedia } = loadWaLib();
        const mime     = mediaType     || 'image/jpeg';
        const filename = mediaFilename || 'image.jpg';
        const media    = new MessageMedia(mime, mediaBase64, filename);
        await clientEntry.client.sendMessage(waJid, media, { caption: body || '' });
      } else {
        await clientEntry.client.sendMessage(waJid, body);
      }
    }

    const ts = admin.firestore.Timestamp.now();
    await convDoc.ref.collection('messages').add({
      body: body || '',
      fromMe: true,
      hasMedia:    mediaBase64 ? true : false,
      mediaBase64: mediaBase64 || null,
      mediaType:   mediaBase64 ? (mediaType || 'image/jpeg') : null,
      senderUserId: senderUserId || null,
      senderName:   senderName   || null,
      timestamp: ts, waMessageId, createdAt: ts,
      ...(porCloud ? { deliveryStatus: 'sent' } : {}),
    });

    // Calculate response time if this is the first reply to an unanswered incoming message
    const convUpdate = {
      lastMessage: body, lastMessageAt: ts, unreadCount: 0, respondedToLast: true,
      lastOperatorId: senderUserId || null,
      lastOperatorName: senderName || null,
    };
    if (conv.lastIncomingAt && conv.respondedToLast === false) {
      const responseMs = ts.toMillis() - conv.lastIncomingAt.toMillis();
      if (responseMs > 0 && responseMs < 7 * 24 * 3600 * 1000) { // ignore if > 7 days
        const prev = conv.responseStats || { count: 0, totalMs: 0, minMs: null, maxMs: 0 };
        convUpdate.responseStats = {
          count:   prev.count + 1,
          totalMs: prev.totalMs + responseMs,
          minMs:   prev.minMs === null ? responseMs : Math.min(prev.minMs, responseMs),
          maxMs:   Math.max(prev.maxMs, responseMs),
        };
      }
    }
    await convDoc.ref.update(convUpdate);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/conversations/:id/read — mark conversation as read
app.post('/api/wa/conversations/:id/read', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    await admin.firestore().collection('waConversations').doc(req.params.id)
      .update({ unreadCount: 0 });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Iluminación y Alertas (interruptores Shelly) ──────────────────────────────
// Los Shelly de todos los condominios viven en UNA cuenta de Shelly Cloud, ordenados en
// "salas" (pestañas del panel de Shelly) que equivalen a condominios. Este módulo:
//   · sincroniza los equipos de la cuenta a shellyDevices/{id} (1 doc por canal),
//   · los lee cada minuto (estado on/off, potencia, voltaje, conexión) y guarda el
//     cambio en shellyEvents, y
//   · evalúa alertas por equipo (sin conexión, reseteo apagado, luces fuera de horario,
//     encendido sin consumo). El resumen va a config/shellyStatus y pinta en ROJO el
//     módulo en el menú de la app; además avisa a super_admin y técnicos.
// La sala "Reseteo Equipos PV" es CRÍTICA: esos relés alimentan equipos (cámaras, DSS,
// lectores); si uno está apagado, hay equipos sin energía.
const shelly = require('./lib/shelly.cjs');
const SHELLY_POLL_MS       = 60_000;
const SHELLY_SYNC_MS       = 24 * 60 * 60_000;
const SHELLY_OFFLINE_MIN   = 3;    // minutos sin conexión antes de alertar
const SHELLY_LOWPOWER_MIN  = 10;   // minutos encendido sin consumo antes de alertar
const SHELLY_HORARIO_TOL   = 15;   // minutos de tolerancia alrededor del horario
const SHELLY_NOTIF_GAP_MS  = 30 * 60_000; // no repetir aviso del mismo equipo antes de 30 min

// Sala de Shelly → condominio de la app. Las salas de "Bodega N" son medidores de Maipo
// Bodegas (se importan ocultos). Lo que no calce queda "por asignar" y se edita en la app.
const SHELLY_ROOM_CONDO = {
  '15': '0RWRDUgw4qWebi8Laici', // Quillay
  '16': 'WywRVcq5fPGX2YlbiUUW', // Condominio Santa Elena
  '17': 'nF2VwV3RqqdXvsylkRco', // Valenzuela Puelma
  '18': 'uDRhIIwqal7ojqlSBzpK', // Maipo Bodegas
  '19': 'iIDV0tfObl80vACtxBCd', // Bodega Trama
  '20': '72GlxDLCD8RbDh0yYQCx', // Condominio Los Cantaros
  '22': 'K0wio8h9EE7EM5Xs6Vcw', // Don Alberto
  '23': 'LhFPe2LSrqZmhjPFAF9C', // Edificio Lotaguirre
  '24': '72GlxDLCD8RbDh0yYQCx', // Los cántaros
  '25': 'kLqtxHZLejK27Ik52pMQ', // Edificio Holanda
};
const SHELLY_ROOM_RESETEOS = '21';
// Un reseteo se asigna al condominio que nombra ("Reseteo Santa Elena" → Santa Elena).
const SHELLY_NOMBRE_CONDO = [
  [/lotaguirre/i, 'LhFPe2LSrqZmhjPFAF9C'], [/trama/i, 'iIDV0tfObl80vACtxBCd'], [/c[aá]ntaros/i, '72GlxDLCD8RbDh0yYQCx'],
  [/santa elena/i, 'WywRVcq5fPGX2YlbiUUW'], [/quillay/i, '0RWRDUgw4qWebi8Laici'], [/valenzuela|puelma/i, 'nF2VwV3RqqdXvsylkRco'],
  [/don alberto/i, 'K0wio8h9EE7EM5Xs6Vcw'], [/holanda/i, 'kLqtxHZLejK27Ik52pMQ'], [/torcaza/i, 'sECnsFbxMQHnjqvaESJu'],
  [/estancia/i, '2JP9jEeMx2d3aIYJJSPr'], [/acacio|cruz/i, 'Vc8MyuGJ3ouReuVrPeK7'], [/vergel/i, 'EVB6bvlc34vWuHoPDbXz'],
  [/hasar/i, '2yNEl1YuDTA7sBGWocKP'], [/maipo|\bmb\b|oficina|casino|porter[ií]a mb|bodega/i, 'uDRhIIwqal7ojqlSBzpK'],
];

const shellyTipoDe = (dev, roomId) => {
  if (dev.category === 'emeter') return 'medidor';
  if (/focos?|luces|luz|ilumina/i.test(dev.name)) return 'luces';     // "Focos Portón…" son luces
  if (/rese?teo|reset/i.test(dev.name)) return 'reseteo';
  if (/motor|port[oó]n|barrera/i.test(dev.name)) return 'motor';
  if (roomId === SHELLY_ROOM_RESETEOS) return 'reseteo';
  return 'luces';
};
// Todo lo que cuelga de la sala de reseteos alimenta equipos: crítico aunque sea un motor.
const shellyEsCritico = (dev, roomId, tipo) => tipo === 'reseteo' || roomId === SHELLY_ROOM_RESETEOS;
const shellyCondoDe = (dev, roomId) => {
  if (roomId !== SHELLY_ROOM_RESETEOS && SHELLY_ROOM_CONDO[roomId]) return SHELLY_ROOM_CONDO[roomId];
  for (const [re, condoId] of SHELLY_NOMBRE_CONDO) if (re.test(dev.name)) return condoId;
  if (/^Bodega /.test(roomNameCache[roomId] || '')) return 'uDRhIIwqal7ojqlSBzpK';
  return '';
};
let roomNameCache = {};

// Importa (o refresca) los equipos de la cuenta. Conserva lo editado en la app
// (condominio, zona, tipo, crítico, horario, umbral, oculto) si ya existía el doc.
async function shellySync(origen = 'auto') {
  if (!shelly.configured() || !admin.apps.length) return { ok: false, error: 'Shelly no configurado' };
  const db = admin.firestore();
  const [devices, rooms, condosSnap] = await Promise.all([shelly.listDevices(), shelly.listRooms(), db.collection('condos').get()]);
  roomNameCache = rooms;
  const condoName = new Map(); condosSnap.forEach(d => condoName.set(d.id, String(d.data().name || '').trim()));
  const existentes = new Map(); (await db.collection('shellyDevices').get()).forEach(d => existentes.set(d.id, d.data()));
  let nuevos = 0, actualizados = 0;
  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();
  for (const dev of devices) {
    const { baseId, channel } = shelly.splitId(dev.id);
    const prev = existentes.get(dev.id);
    const roomId = dev.roomId || '';
    const tipo = prev?.tipo || shellyTipoDe(dev, roomId);
    const condoId = prev?.condoId || shellyCondoDe(dev, roomId);
    const doc = {
      shellyId: dev.id, baseId, channel, name: prev?.name || dev.name || dev.id, shellyName: dev.name || '',
      model: dev.type, gen: dev.gen, category: dev.category, roomId, roomName: rooms[roomId] || '',
      condoId, condoName: condoName.get(condoId) || '',
      zona:    prev?.zona ?? '',
      tipo,
      critico: prev?.critico ?? shellyEsCritico(dev, roomId, tipo),
      horario: prev?.horario ?? (tipo === 'luces' ? { modo: 'solar', offsetMin: 0 } : null),
      umbralW: prev?.umbralW ?? (tipo === 'luces' ? 5 : 0),
      hidden:  prev?.hidden ?? (tipo === 'medidor'),
      updatedAt: now, syncedAt: now,
    };
    if (!prev) { doc.createdAt = now; doc.state = null; doc.alert = null; nuevos++; } else actualizados++;
    batch.set(db.collection('shellyDevices').doc(dev.id), doc, { merge: true });
  }
  await batch.commit();
  await db.collection('config').doc('shellyRooms').set({ rooms, updatedAt: now }, { merge: true });
  _jobStats.shelly.lastSync = new Date().toISOString();
  console.log(`[Shelly] sync (${origen}): ${devices.length} equipos · ${nuevos} nuevos · ${actualizados} actualizados · ${Object.keys(rooms).length} salas`);
  return { ok: true, total: devices.length, nuevos, actualizados, salas: Object.keys(rooms).length };
}

const hhmmSantiago = (d = new Date()) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(/^24/, '00');
const aMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
// Amanecer y atardecer en Santiago (33,45° S · 70,67° O) — algoritmo NOAA simplificado.
// Los Shelly de las luces tienen programado "atardecer → amanecer" según ubicación, y todos
// están en la Región Metropolitana: lo mismo calculamos aquí para saber si deberían estar
// encendidas. Devuelve los instantes (ms UTC) del día LOCAL de `nowMs`.
function shellySolarSantiago(nowMs) {
  const lat = -33.45, lon = -70.67, rad = Math.PI / 180;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(nowMs)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  const medianocheUTC = Date.UTC(p.year, p.month - 1, p.day);
  const doy = Math.floor((medianocheUTC - Date.UTC(p.year, 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (doy - 1);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const sunrise = medianocheUTC + (720 - 4 * (lon + ha) - eqtime) * 60000;
  const sunset  = medianocheUTC + (720 - 4 * (lon - ha) - eqtime) * 60000;
  return { sunrise, sunset };
}
const SHELLY_SOLAR_TOL_MIN = 30; // los Shelly pueden tener desfases programados; tolerancia amplia

// ¿Debería estar encendido ahora según el horario {on:'19:00', off:'07:00'}? (null = sin horario)
function shellyDeberiaEstar(horario, ahoraMin) {
  const on = aMin(horario?.on), off = aMin(horario?.off);
  if (on == null || off == null || on === off) return null;
  return on < off ? (ahoraMin >= on && ahoraMin < off) : (ahoraMin >= on || ahoraMin < off);
}
// Minutos hasta el borde más cercano del horario (para la tolerancia).
function shellyMinAlBorde(horario, ahoraMin) {
  const on = aMin(horario?.on), off = aMin(horario?.off);
  if (on == null || off == null) return Infinity;
  const dist = (a, b) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));
  return Math.min(dist(ahoraMin, on), dist(ahoraMin, off));
}

// Reglas de alerta de un equipo. Devuelve { level:'critico'|'alerta', reason, code } o null.
function shellyEvaluarAlerta(dev, st, nowMs) {
  const min = (ts) => ts ? (nowMs - ts) / 60000 : 0;
  if (!st.online) {
    if (min(st.offlineSince) >= SHELLY_OFFLINE_MIN) return { level: dev.critico ? 'critico' : 'alerta', code: 'offline', reason: 'Sin conexión con el equipo' };
    return null;
  }
  if (dev.tipo === 'reseteo' || dev.critico) {
    if (st.on === false) return { level: 'critico', code: 'apagado', reason: 'Interruptor crítico APAGADO: equipos sin energía' };
  }
  if (dev.horario?.modo === 'solar' && st.on != null) {
    const { sunrise, sunset } = shellySolarSantiago(nowMs);
    const off = (Number(dev.horario.offsetMin) || 0) * 60000;      // desfase programado en el Shelly
    const noche = nowMs >= sunset + off || nowMs < sunrise - off;
    const lejosDelBorde = Math.min(Math.abs(nowMs - (sunset + off)), Math.abs(nowMs - (sunrise - off))) > SHELLY_SOLAR_TOL_MIN * 60000;
    if (noche !== st.on && lejosDelBorde) {
      return { level: 'alerta', code: noche ? 'apagado_de_noche' : 'encendido_de_dia',
        reason: noche ? 'Es de noche (atardecer → amanecer) y las luces están apagadas' : 'Es de día y las luces siguen encendidas' };
    }
  } else if (dev.horario && st.on != null) {
    const ahora = aMin(hhmmSantiago(new Date(nowMs)));
    const debe = shellyDeberiaEstar(dev.horario, ahora);
    if (debe != null && debe !== st.on && shellyMinAlBorde(dev.horario, ahora) > SHELLY_HORARIO_TOL) {
      return { level: 'alerta', code: debe ? 'apagado_en_horario' : 'encendido_fuera_horario',
        reason: debe ? `Debería estar encendido (${dev.horario.on}–${dev.horario.off}) y está apagado`
                     : `Encendido fuera de horario (${dev.horario.on}–${dev.horario.off})` };
    }
  }
  if (dev.tipo === 'luces' && st.on === true && typeof st.apower === 'number' && Number(dev.umbralW) > 0
      && st.apower < Number(dev.umbralW) && min(st.lowPowerSince) >= SHELLY_LOWPOWER_MIN) {
    return { level: 'alerta', code: 'sin_consumo', reason: `Encendido pero sin consumo (${st.apower} W): revisar luminarias o circuito` };
  }
  return null;
}

async function shellyNotificar(dev, alerta) {
  try {
    const users = await admin.firestore().collection('users').where('role', 'in', ['super_admin', 'technician']).get();
    const titulo = alerta.level === 'critico' ? '🔴 Alerta crítica de iluminación' : '⚠️ Alerta de iluminación';
    const msg = `${dev.name} (${dev.condoName || dev.roomName || 'sin condominio'}): ${alerta.reason}`;
    await Promise.all(users.docs.map(u => addNotification(u.id, { title: titulo, message: msg, type: 'alert', link: '/iluminacion' }).catch(() => {})));
  } catch (e) { console.warn('[Shelly] notificar:', e.message); }
}

// Lectura periódica de todos los equipos visibles.
async function shellyPoll() {
  if (!shelly.configured() || !admin.apps.length || _jobStats.shelly.running) return;
  const st = _jobStats.shelly; st.running = true;
  const db = admin.firestore();
  try {
    const snap = await db.collection('shellyDevices').get();
    if (snap.empty) { await shellySync('bootstrap'); st.running = false; return shellyPoll(); }
    const devs = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() })).filter(d => !d.hidden);
    const statuses = await shelly.getStatuses(devs.map(d => d.baseId));
    const nowMs = Date.now(), now = admin.firestore.Timestamp.now();
    let alertas = 0, criticas = 0, encendidos = 0, offline = 0;
    const batch = db.batch(); let escrituras = 0;
    for (const dev of devs) {
      const raw = statuses.get(String(dev.baseId));
      const p = raw ? shelly.parseSwitch(raw.status, dev.channel) : {};
      const online = !!(raw && raw.online && raw.status);
      const prev = dev.state || {};
      const nuevo = {
        on: online ? p.on : (prev.on ?? null), online,
        apower: online ? p.apower : null, voltage: online ? p.voltage : null,
        temperature: online ? p.temperature : null, energyWh: online ? p.energyWh : (prev.energyWh ?? null),
        ts: now,
        offlineSince:  !online ? (prev.offlineSince || nowMs) : null,
        lowPowerSince: (online && p.on === true && typeof p.apower === 'number' && Number(dev.umbralW) > 0 && p.apower < Number(dev.umbralW)) ? (prev.lowPowerSince || nowMs) : null,
      };
      if (nuevo.on === true) encendidos++;
      if (!online) offline++;
      const cambioOnOff = prev.on != null && nuevo.on != null && prev.on !== nuevo.on;
      const cambioOnline = (prev.online ?? true) !== online;
      if (cambioOnOff || cambioOnline) {
        batch.set(db.collection('shellyEvents').doc(), {
          deviceId: dev.id, name: dev.name, condoId: dev.condoId || '', condoName: dev.condoName || '',
          type: cambioOnOff ? 'state' : 'online', from: cambioOnOff ? prev.on : (prev.online ?? true), to: cambioOnOff ? nuevo.on : online,
          apower: nuevo.apower, ts: now, by: null,
        }); escrituras++;
      }
      // Alertas: nueva, cambia de motivo, o se resuelve.
      const al = shellyEvaluarAlerta(dev, nuevo, nowMs);
      let alertDoc = dev.alert || null;
      if (al) {
        alertas++; if (al.level === 'critico') criticas++;
        if (!alertDoc || alertDoc.code !== al.code) {
          alertDoc = { ...al, since: now, notifiedAt: null, ackedAt: null, ackedBy: null };
          batch.set(db.collection('shellyEvents').doc(), { deviceId: dev.id, name: dev.name, condoId: dev.condoId || '', condoName: dev.condoName || '', type: 'alert', level: al.level, reason: al.reason, ts: now }); escrituras++;
        } else alertDoc = { ...alertDoc, level: al.level, reason: al.reason };
        const notMs = alertDoc.notifiedAt?.toMillis ? alertDoc.notifiedAt.toMillis() : 0;
        if (!alertDoc.ackedAt && nowMs - notMs > SHELLY_NOTIF_GAP_MS) { alertDoc.notifiedAt = now; shellyNotificar(dev, al); }
      } else if (alertDoc) {
        batch.set(db.collection('shellyEvents').doc(), { deviceId: dev.id, name: dev.name, condoId: dev.condoId || '', condoName: dev.condoName || '', type: 'alert_resolved', reason: alertDoc.reason, ts: now }); escrituras++;
        alertDoc = null;
      }
      // Escribir sólo si cambió algo relevante o pasaron 5 min (latido).
      const tsPrev = prev.ts?.toMillis ? prev.ts.toMillis() : 0;
      const cambioPot = Math.abs((prev.apower ?? 0) - (nuevo.apower ?? 0)) >= 5;
      if (cambioOnOff || cambioOnline || cambioPot || JSON.stringify(alertDoc) !== JSON.stringify(dev.alert || null) || nowMs - tsPrev > 5 * 60_000) {
        const upd = { state: nuevo, alert: alertDoc, updatedAt: now };
        if (cambioOnOff) { upd.lastChangeAt = now; upd.lastChangeBy = null; }
        batch.update(dev.ref, upd); escrituras++;
      }
    }
    batch.set(db.collection('config').doc('shellyStatus'), {
      alertCount: alertas, criticalCount: criticas, devices: devs.length, on: encendidos, offline,
      lastPoll: now, lastError: null, configured: true,
    }, { merge: true });
    await batch.commit();
    Object.assign(st, { lastPoll: new Date().toISOString(), lastError: null, devices: devs.length, alerts: alertas });
  } catch (err) {
    st.lastError = err.message;
    console.warn('[Shelly] poll:', err.message);
    await db.collection('config').doc('shellyStatus').set({ lastError: err.message, lastErrorAt: admin.firestore.Timestamp.now(), configured: shelly.configured() }, { merge: true }).catch(() => {});
  } finally { st.running = false; }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.use('/api/lighting', requireAuth, requireRole(['condo_admin', 'administrador', 'operator', 'technician']));

app.get('/api/lighting/status', (_req, res) => res.json({ ...(_jobStats.shelly), configured: shelly.configured() }));

// POST /api/lighting/sync — importar equipos de la cuenta Shelly (super_admin)
app.post('/api/lighting/sync', async (req, res) => {
  try {
    if (!callerIsSuper(await callerProfile(req))) return res.status(403).json({ error: 'Sólo super administrador' });
    const r = await shellySync('manual');
    if (!r.ok) return res.status(503).json(r);
    setTimeout(() => shellyPoll().catch(() => {}), 1500);
    res.json(r);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/lighting/poll — leer ahora
app.post('/api/lighting/poll', async (_req, res) => {
  try { await shellyPoll(); res.json({ ok: true, ...(_jobStats.shelly) }); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// PUT /api/lighting/devices/:id — configuración del equipo (super_admin)
app.put('/api/lighting/devices/:id', async (req, res) => {
  try {
    if (!callerIsSuper(await callerProfile(req))) return res.status(403).json({ error: 'Sólo super administrador' });
    const ref = admin.firestore().collection('shellyDevices').doc(req.params.id);
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'Equipo no encontrado' });
    const b = req.body || {}; const upd = { updatedAt: admin.firestore.Timestamp.now() };
    if (b.name !== undefined)    upd.name = String(b.name).trim().slice(0, 80);
    if (b.zona !== undefined)    upd.zona = String(b.zona).trim().slice(0, 60);
    if (b.tipo !== undefined && ['luces', 'reseteo', 'motor', 'medidor', 'otro'].includes(b.tipo)) upd.tipo = b.tipo;
    if (b.critico !== undefined) upd.critico = !!b.critico;
    if (b.hidden !== undefined)  upd.hidden = !!b.hidden;
    if (b.umbralW !== undefined) upd.umbralW = Math.max(0, Number(b.umbralW) || 0);
    if (b.horario !== undefined) {
      if (b.horario?.modo === 'solar') upd.horario = { modo: 'solar', offsetMin: Math.max(-120, Math.min(120, Number(b.horario.offsetMin) || 0)) };
      else upd.horario = (b.horario && aMin(b.horario.on) != null && aMin(b.horario.off) != null) ? { on: String(b.horario.on), off: String(b.horario.off) } : null;
    }
    if (b.condoId !== undefined) {
      upd.condoId = String(b.condoId || '');
      const c = upd.condoId ? await admin.firestore().collection('condos').doc(upd.condoId).get() : null;
      upd.condoName = c && c.exists ? String(c.data().name || '').trim() : '';
    }
    await ref.update(upd);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/lighting/devices/:id/switch { on, confirm } — encender/apagar
app.post('/api/lighting/devices/:id/switch', async (req, res) => {
  try {
    const ref = admin.firestore().collection('shellyDevices').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Equipo no encontrado' });
    const dev = snap.data();
    const prof = await callerProfile(req);
    if (!callerIsSuper(prof) && !callerHasCondo(prof, dev.condoId)) return res.status(403).json({ error: 'Sin permiso sobre este condominio' });
    const on = !!req.body?.on;
    // Apagar siempre pide confirmación (evita toques accidentales); en los críticos el
    // mensaje deja claro que se cortan equipos.
    if (!on && req.body?.confirm !== true) {
      const critico = dev.critico || dev.tipo === 'reseteo';
      return res.status(409).json({ error: critico
        ? 'Este interruptor es crítico: apagarlo deja equipos sin energía. Confirma la acción.'
        : 'Confirma que quieres apagar este interruptor.', code: 'confirm_required', critico });
    }
    await shelly.setSwitch(dev.baseId, dev.channel, on);
    await shelly.sleep(1500);
    let estado = null;
    try {
      const m = await shelly.getStatuses([dev.baseId]); const raw = m.get(String(dev.baseId));
      if (raw && raw.status) { const p = shelly.parseSwitch(raw.status, dev.channel); estado = { ...p, online: !!raw.online }; }
    } catch { /* se actualizará en el próximo poll */ }
    const now = admin.firestore.Timestamp.now();
    const quien = { uid: req.user.uid, name: prof.name || prof.displayName || req.user.email || 'Usuario' };
    const upd = { lastChangeAt: now, lastChangeBy: quien, updatedAt: now };
    if (estado) upd.state = { ...(dev.state || {}), on: estado.on, online: estado.online, apower: estado.apower, voltage: estado.voltage, temperature: estado.temperature, energyWh: estado.energyWh, ts: now, offlineSince: null };
    await ref.update(upd);
    await admin.firestore().collection('shellyEvents').add({
      deviceId: snap.id, name: dev.name, condoId: dev.condoId || '', condoName: dev.condoName || '',
      type: 'action', from: dev.state?.on ?? null, to: on, by: quien, critico: !!(dev.critico || dev.tipo === 'reseteo'), ts: now,
    });
    console.log(`[Shelly] ${quien.name} ${on ? 'ENCENDIÓ' : 'APAGÓ'} ${dev.name} (${dev.condoName || dev.roomName})${dev.critico ? ' [CRÍTICO]' : ''}`);
    res.json({ ok: true, state: estado });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/lighting/devices/:id/ack — marcar la alerta como revisada (silencia avisos)
app.post('/api/lighting/devices/:id/ack', async (req, res) => {
  try {
    const ref = admin.firestore().collection('shellyDevices').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || !snap.data().alert) return res.status(404).json({ error: 'Sin alerta activa' });
    const prof = await callerProfile(req);
    await ref.update({ 'alert.ackedAt': admin.firestore.Timestamp.now(), 'alert.ackedBy': { uid: req.user.uid, name: prof.name || req.user.email || '' } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Centro de eventos (alarmas del Centro de Eventos del DSS) ─────────────────
// El DSS acumula alarmas (cruce de línea, intrusión, eventos de controladores…) que nadie
// gestiona. Cada minuto se leen las nuevas por /brms/api/v1.1/alarm/record/fetch/page y se
// guardan en dssAlarms/{alarmId} con nombre en español, condominio y gravedad. Sólo las de
// gravedad ALTA (alarmGrade 1) requieren gestión; medias/bajas quedan como registro. Las
// repeticiones del mismo equipo+tipo en 10 min se agrupan en un solo doc (count) para que
// una ráfaga (p. ej. 355 alarmas de un controlador en una hora) no tape lo importante.
// Gestionar = POST /brms/api/v1.0/BRM/Alarm/HandleAlarm (queda también en el DSS).
const DSS_ALARM_POLL_MS   = 60_000;
const DSS_ALARM_OVERLAP_S = 15 * 60;   // se relee con solapamiento; alarmId evita duplicados
const DSS_ALARM_GROUP_S   = 10 * 60;   // misma alarma (equipo+tipo) dentro de 10 min → mismo grupo
const DSS_ALARM_RETAIN_D  = 30;
const DSS_ALARM_MAX_PAGES = 10;

// Diccionario Dahua → español (los códigos vienen del anexo "Alarm Type" del manual v8.5).
const DSS_ALARM_TYPES = {
  1: 'Pérdida de video', 4: 'Manipulación de cámara', 13: 'Canal desconectado', 665: 'Cambio de escena',
  3: 'Detección de movimiento', 302: 'Cruce de línea', 303: 'Intrusión', 305: 'Objeto abandonado',
  306: 'Permanencia de personas', 307: 'Merodeo', 309: 'Movimiento rápido', 310: 'Seguimiento',
  311: 'Aglomeración', 312: 'Llama', 313: 'Humo', 314: 'Violencia', 564: 'Estacionamiento ilegal',
  587: 'Cruce de cerco virtual', 675: 'Caída de persona', 886: 'Aproximación de persona',
  962: 'Cruce de línea (persona)', 963: 'Cruce de línea (vehículo)', 964: 'Intrusión (persona)',
  965: 'Intrusión (vehículo)', 980: 'Movimiento rápido (persona)', 981: 'Movimiento rápido (vehículo)',
  19010: 'Movimiento inteligente (persona)', 19011: 'Movimiento inteligente (vehículo)',
  16: 'Evento de alarma (controlador)', 41: 'Coacción', 72: 'Puerta abierta demasiado tiempo',
  1433: 'Persona en lista negra', 1446: 'Alarma maliciosa', 4331: 'Incendio (acceso)',
  13105: 'Anti-passback', 13110: 'Intrusión (acceso)', 13130: 'Interbloqueo (equipo fuera de línea)',
  600003: 'Manipulación de lector', 702001: 'Contraseña incorrecta',
  43: 'Desconocido (clave)', 46: 'Desconocido (huella)', 52: 'Desconocido (tarjeta)', 62: 'Desconocido (rostro)',
  13100: 'Sin permiso', 13103: 'Verificación fallida', 13104: 'Fuera de vigencia', 13111: 'Fuera de periodo',
  13140: 'Reingreso repetido', 13143: 'Permisos congelados', 13144: 'Límite de visitas alcanzado',
  42: 'Apertura con clave', 45: 'Apertura con huella', 48: 'Apertura remota (operador)', 49: 'Apertura por botón',
  51: 'Apertura con tarjeta', 600005: 'Apertura por rostro', 600013: 'Apertura tarjeta + rostro',
  84: 'Batería baja', 85: 'Falla de energía principal', 22020: 'Incendio', 22022: 'Pánico', 22037: 'Manipulación de equipo',
  5120: 'Alarma de temperatura', 22086: 'Energía principal restablecida',
};
const dssAlarmNombre = (t) => DSS_ALARM_TYPES[Number(t)] || `Alarma ${t}`;
// Id del doc = alarmCode (GUID) sin llaves: es lo único que comparten el historial paginado y
// el callback push, así ambos caminos escriben el MISMO doc.
const dssAlarmDocId = (code, fallback) => String(code || '').replace(/[{}\s]/g, '').replace(/[^A-Za-z0-9_-]/g, '') || String(fallback || '');

// Condominio por prefijo del nombre del equipo en el DSS (convención de los técnicos).
const DSS_PREFIJO_CONDO = [
  [/^EQ_/i, '0RWRDUgw4qWebi8Laici'], [/^EH_/i, 'kLqtxHZLejK27Ik52pMQ'], [/^LT_|torcaza/i, 'sECnsFbxMQHnjqvaESJu'],
  [/^LC_|c[aá]ntaros/i, '72GlxDLCD8RbDh0yYQCx'], [/^ELA_|^LE_|estancia/i, '2JP9jEeMx2d3aIYJJSPr'], [/^DA_|don alberto/i, 'K0wio8h9EE7EM5Xs6Vcw'],
  [/^VP_|valenzuela/i, 'nF2VwV3RqqdXvsylkRco'], [/^EV_|vergel/i, 'EVB6bvlc34vWuHoPDbXz'], [/^SE_|santa elena/i, 'WywRVcq5fPGX2YlbiUUW'],
  [/^BT_|trama/i, 'iIDV0tfObl80vACtxBCd'], [/^MB_|maipo/i, 'uDRhIIwqal7ojqlSBzpK'], [/^LO_|lotaguirre/i, 'LhFPe2LSrqZmhjPFAF9C'],
  [/^AC_|acacio/i, 'Vc8MyuGJ3ouReuVrPeK7'], [/^HC_|hasar/i, '2yNEl1YuDTA7sBGWocKP'],
];
let _condoNombreCache = { ts: 0, map: new Map() };
async function dssCondoNombres() {
  if (Date.now() - _condoNombreCache.ts > 10 * 60_000) {
    const m = new Map(); (await admin.firestore().collection('condos').get()).forEach(d => m.set(d.id, String(d.data().name || '').trim()));
    _condoNombreCache = { ts: Date.now(), map: m };
  }
  return _condoNombreCache.map;
}
async function dssAlarmCondo(a) {
  let condoId = '';
  try { const cm = await getChannelCondoMap(); if (a.channelId && cm.get(String(a.channelId))) condoId = cm.get(String(a.channelId)); } catch {}
  if (!condoId) for (const [re, id] of DSS_PREFIJO_CONDO) if (re.test(String(a.deviceName || '')) || re.test(String(a.channelName || ''))) { condoId = id; break; }
  const nombres = await dssCondoNombres();
  return { condoId, condoName: nombres.get(condoId) || '' };
}

// Grupos abiertos en memoria: clave equipo+tipo → { docId, lastTs }.
const _dssAlarmGrupos = new Map();
const _dssAlarmVistas = new Set(); // alarmIds ya guardados (se limpia cada hora)
setInterval(() => { _dssAlarmVistas.clear(); }, 60 * 60_000).unref?.();

async function dssAlarmsSync() {
  if (!DAHUA_HOST || !admin.apps.length || _jobStats.events.running) return;
  const st = _jobStats.events; st.running = true;
  const db = admin.firestore();
  try {
    const nowS = Math.floor(Date.now() / 1000);
    const cfgRef = db.collection('config').doc('dssAlarmsStatus');
    const cfg = (await cfgRef.get()).data() || {};
    const desde = Math.max(nowS - 24 * 3600, (Number(cfg.lastAlarmTs) || (nowS - 6 * 3600)) - DSS_ALARM_OVERLAP_S);
    const base = { alarmCode: '', deviceCodes: [], channelIds: [], alarmStatus: [], alarmTypes: [], startAlarmTime: String(desde), endAlarmTime: String(nowS),
      alarmGrade: [], handleUser: '', handleStatus: [], splitTime: '', splitId: '', pageSize: '100', orderType: '1', orderDirection: '0', handleMessage: '' };
    // Paginación del DSS: para pasar de página hay que mandar splitTime/splitId del último
    // registro de la página anterior (sin eso devuelve siempre la primera página).
    let filas = [], split = { splitTime: '', splitId: '', currentPage: '1' }, vistoPrimero = '';
    for (let p = 1; p <= DSS_ALARM_MAX_PAGES; p++) {
      const r = await dssAuthed('POST', '/brms/api/v1.1/alarm/record/fetch/page', { ...base, ...split, page: String(p) });
      if (r.body?.code !== 1000) throw new Error(`DSS alarm page: ${r.body?.code} ${r.body?.desc || ''}`);
      const rows = r.body?.data?.pageData || [];
      if (!rows.length || rows[0].alarmId === vistoPrimero) break; // misma página → fin
      vistoPrimero = rows[0].alarmId;
      filas = filas.concat(rows);
      if (rows.length < 100) break;
      const last = rows[rows.length - 1];
      split = { splitTime: String(last.alarmDate || ''), splitId: String(last.alarmId || ''), currentPage: String(p) };
    }
    filas.sort((a, b) => Number(a.alarmDate) - Number(b.alarmDate));
    let nuevas = 0, agrupadas = 0, maxTs = Number(cfg.lastAlarmTs) || 0;
    let batch = db.batch(); let escrituras = 0;
    for (const a of filas) {
      const id = dssAlarmDocId(a.alarmCode, a.alarmId); if (!id) continue;
      const ts = Number(a.alarmDate) || nowS;
      if (ts > maxTs) maxTs = ts;
      if (_dssAlarmVistas.has(id)) continue;
      const ex = await db.collection('dssAlarms').doc(id).get();
      if (ex.exists) {
        _dssAlarmVistas.add(id);
        // Llegó antes por el callback (sin nombre de equipo): completar con el historial.
        if (ex.data().viaCallback && !ex.data().deviceName) {
          const { condoId, condoName } = await dssAlarmCondo(a);
          batch.update(ex.ref, { alarmId: String(a.alarmId || ''), deviceCode: String(a.deviceCode || ''), deviceName: String(a.deviceName || ''), channelId: String(a.channelId || ''), channelName: String(a.channelName || ''),
            ...(condoId && !ex.data().condoId ? { condoId, condoName } : {}), dssHandleStatus: String(a.handleStatus || '0'), picture: a.picture || ex.data().picture || '', linkRecordChannels: Array.isArray(a.linkRecordChannels) ? a.linkRecordChannels : [] });
          escrituras++; if (escrituras >= 400) { await batch.commit(); batch = db.batch(); escrituras = 0; }
        }
        continue;
      }
      _dssAlarmVistas.add(id);
      const grade = Number(a.alarmGrade) || 3;
      const clave = `${a.deviceCode}|${a.channelId || ''}|${a.alarmType}`;
      const g = _dssAlarmGrupos.get(clave);
      // Repetición reciente → sumar al grupo existente (sólo cuenta y última hora).
      if (g && ts - g.lastTs <= DSS_ALARM_GROUP_S) {
        batch.update(db.collection('dssAlarms').doc(g.docId), { count: admin.firestore.FieldValue.increment(1), lastTs: ts, lastAt: admin.firestore.Timestamp.fromMillis(ts * 1000), ultimoAlarmId: id, ultimoAlarmCode: a.alarmCode || '' });
        g.lastTs = ts; agrupadas++; escrituras++;
        if (escrituras >= 400) { await batch.commit(); batch = db.batch(); escrituras = 0; }
        continue;
      }
      const { condoId, condoName } = await dssAlarmCondo(a);
      const doc = {
        alarmId: id, alarmCode: a.alarmCode || '', ts, at: admin.firestore.Timestamp.fromMillis(ts * 1000), lastTs: ts, lastAt: admin.firestore.Timestamp.fromMillis(ts * 1000),
        type: String(a.alarmType || ''), typeName: dssAlarmNombre(a.alarmType), grade, gestionable: grade === 1,
        deviceCode: String(a.deviceCode || ''), deviceName: String(a.deviceName || ''), channelId: String(a.channelId || ''), channelName: String(a.channelName || ''),
        condoId, condoName, alarmStat: String(a.alarmStat || a.alarmStatus || ''),
        dssHandleStatus: String(a.handleStatus || '0'), dssHandleUser: a.handleUser || null, dssHandleMessage: a.handleMessage || null,
        picture: a.picture || '', linkRecordChannels: Array.isArray(a.linkRecordChannels) ? a.linkRecordChannels : [], extData: a.extData || null,
        count: 1, gestion: null, createdAt: admin.firestore.Timestamp.now(),
      };
      batch.set(db.collection('dssAlarms').doc(id), doc); escrituras++; nuevas++;
      _dssAlarmGrupos.set(clave, { docId: id, lastTs: ts });
      if (escrituras >= 400) { await batch.commit(); batch = db.batch(); escrituras = 0; }
    }
    if (escrituras) await batch.commit();
    // Grupos viejos fuera de memoria.
    for (const [k, g] of _dssAlarmGrupos) if (nowS - g.lastTs > DSS_ALARM_GROUP_S * 2) _dssAlarmGrupos.delete(k);
    // Resumen para el menú/página: altas pendientes por condominio (últimos 7 días).
    const pend = await db.collection('dssAlarms').where('ts', '>=', nowS - 7 * 86400).get();
    let pendientes = 0; const porCondo = {};
    // Ráfaga anómala: un mismo equipo+tipo repitiéndose ≥ 20 veces con actividad en la última
    // hora (p. ej. controlador de Quillay). Se lista en el resumen y se avisa una sola vez.
    const rafagas = [];
    const avisos = [];
    pend.forEach(d => {
      const x = d.data();
      if (x.gestionable && !x.gestion && x.dssHandleStatus === '0') { pendientes++; const k = x.condoName || 'Sin condominio'; porCondo[k] = (porCondo[k] || 0) + 1; }
      if ((x.count || 1) >= DSS_ALARM_RAFAGA_MIN && (x.lastTs || x.ts) >= nowS - 3600 && !x.gestion) {
        rafagas.push({ id: d.id, deviceName: x.deviceName, channelName: x.channelName || '', condoName: x.condoName || '', condoId: x.condoId || '', typeName: x.typeName, count: x.count, desde: x.ts, hasta: x.lastTs, grade: x.grade });
        if (!x.rafagaNotificada) avisos.push(d);
      }
    });
    for (const d of avisos) {
      const x = d.data();
      await d.ref.update({ rafagaNotificada: true }).catch(() => {});
      dssAlarmNotificar(x.condoId, '🚨 Ráfaga de alarmas en el DSS', `${x.deviceName}${x.channelName ? ' / ' + x.channelName : ''} (${x.condoName || 'sin condominio'}): ${x.count} × "${x.typeName}" en poco tiempo. Revisar el equipo.`).catch(() => {});
    }
    await cfgRef.set({ lastSync: admin.firestore.Timestamp.now(), lastAlarmTs: maxTs, lastError: null, pendientesAltas: pendientes, porCondo, rafagas, rafagasCount: rafagas.length, leidas: filas.length, nuevas, agrupadas }, { merge: true });
    Object.assign(st, { lastSync: new Date().toISOString(), lastError: null, leidas: filas.length, nuevas, agrupadas });
    if (nuevas || agrupadas) console.log(`[Eventos DSS] ${filas.length} leídas · ${nuevas} nuevas · ${agrupadas} agrupadas · ${pendientes} altas pendientes`);
  } catch (err) {
    st.lastError = err.message; console.warn('[Eventos DSS] sync:', err.message);
    await db.collection('config').doc('dssAlarmsStatus').set({ lastError: err.message, lastErrorAt: admin.firestore.Timestamp.now() }, { merge: true }).catch(() => {});
  } finally { st.running = false; }
}

async function dssAlarmsPurge() {
  if (!admin.apps.length) return;
  try {
    const db = admin.firestore(); const limite = Math.floor(Date.now() / 1000) - DSS_ALARM_RETAIN_D * 86400;
    let total = 0;
    for (;;) {
      const snap = await db.collection('dssAlarms').where('ts', '<', limite).limit(400).get();
      if (snap.empty) break;
      const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit(); total += snap.size;
      if (snap.size < 400) break;
    }
    const dirs = dssPurgarFotos(DSS_ALARM_RETAIN_D);
    if (total || dirs) console.log(`[Eventos DSS] purgadas ${total} alarmas y ${dirs} carpetas de fotos de más de ${DSS_ALARM_RETAIN_D} días`);
  } catch (e) { console.warn('[Eventos DSS] purge:', e.message); }
}

// Gestión de una alarma en el DSS + en la app. status: 1 en gestión, 2 resuelta, 3 falsa, 4 ignorada.
async function dssAlarmHandle(docSnap, status, comment, quien) {
  const a = docSnap.data();
  const body = { clientType: 'API', method: 'BRM.Alarm.HandleAlarm', data: {
    handleUser: quien.name || 'Portería Virtual', comment: '', mailReceivers: [], handleStatus: String(status),
    handleMessage: String(comment || '').slice(0, 500), optional: '/brms/api/v1.0/BRM/Alarm/HandleAlarm',
    alarmCode: a.alarmCode, alarmDate: String(a.ts), deviceCode: a.deviceCode || '' } };
  let dssOk = false, dssDesc = '';
  try { const r = await dssAuthed('POST', '/brms/api/v1.0/BRM/Alarm/HandleAlarm', body); dssOk = r.body?.code === 1000; dssDesc = r.body?.desc || String(r.body?.code || ''); }
  catch (e) { dssDesc = e.message; }
  await docSnap.ref.update({
    gestion: { status: Number(status), by: quien, at: admin.firestore.Timestamp.now(), comment: String(comment || '').slice(0, 500), dssOk, dssDesc },
    dssHandleStatus: dssOk ? String(status) : a.dssHandleStatus,
  });
  return { dssOk, dssDesc };
}

const DSS_ALARM_RAFAGA_MIN = 20;

// Técnicos del condominio (misma regla que Incidents.tsx: scope all, condoId o condoIds) + super_admin.
async function dssAlarmDestinatarios(condoId) {
  const db = admin.firestore();
  const [tecs, supers] = await Promise.all([
    db.collection('users').where('role', '==', 'technician').get(),
    db.collection('users').where('role', '==', 'super_admin').get(),
  ]);
  const ids = new Set();
  tecs.forEach(d => { const u = d.data(); if (u.condoScope === 'all' || u.condoId === condoId || (Array.isArray(u.condoIds) && u.condoIds.includes(condoId))) ids.add(d.id); });
  supers.forEach(d => ids.add(d.id));
  return [...ids];
}
async function dssAlarmNotificar(condoId, title, message, link = '/eventos') {
  const ids = await dssAlarmDestinatarios(condoId);
  await Promise.all(ids.map(uid => addNotification(uid, { title, message, type: 'alert', link }).catch(() => {})));
}

// Fotos de alarmas: en disco del VPS (data/alarm-pictures/AAAAMMDD/<doc>_<n>.jpg), servidas sólo
// con sesión. Se purgan junto con las alarmas (30 días).
const DSS_PIC_DIR = require('path').join(__dirname, 'data', 'alarm-pictures');
function dssGuardarFotos(docId, base64s) {
  const fsx = require('fs'), pathx = require('path');
  const dia = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dir = pathx.join(DSS_PIC_DIR, dia); fsx.mkdirSync(dir, { recursive: true });
  const out = [];
  let n = fsx.readdirSync(dir).filter(f => f.startsWith(docId + '_')).length;
  for (const b64 of base64s || []) {
    if (!b64 || typeof b64 !== 'string') continue;
    const data = b64.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(data, 'base64'); if (buf.length < 100) continue;
    const file = `${docId}_${n++}.jpg`;
    fsx.writeFileSync(pathx.join(dir, file), buf);
    out.push({ file: `${dia}/${file}`, bytes: buf.length, ts: Math.floor(Date.now() / 1000) });
  }
  return out;
}
function dssPurgarFotos(dias) {
  const fsx = require('fs'), pathx = require('path');
  if (!fsx.existsSync(DSS_PIC_DIR)) return 0;
  const limite = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  let n = 0;
  for (const d of fsx.readdirSync(DSS_PIC_DIR)) if (/^\d{8}$/.test(d) && d < limite) { fsx.rmSync(pathx.join(DSS_PIC_DIR, d), { recursive: true, force: true }); n++; }
  return n;
}

// Callback push del DSS (POST /brms/api/v1.1/push-data/alarm/subscribe → nos envía cada alarma al
// instante, con las fotos en Base64). Sin sesión de Firebase: lo autentica la `signature` que
// nosotros mismos registramos al suscribirnos (DSS_ALARM_PUSH_SECRET).
app.post('/api/dss/alarm-callback', async (req, res) => {
  const secret = process.env.DSS_ALARM_PUSH_SECRET || '';
  const b = req.body || {};
  if (!secret || String(b.signature || '') !== secret) return res.status(401).json({ code: 401, desc: 'firma inválida' });
  res.json({ code: 1000, desc: 'Success' }); // responder ya: el DSS reintenta si tardamos
  if (!admin.apps.length) return;
  try {
    const docId = dssAlarmDocId(b.alarmCode);
    if (!docId) return;
    const ref = admin.firestore().collection('dssAlarms').doc(docId);
    const fotos = dssGuardarFotos(docId, Array.isArray(b.alarmPictures) ? b.alarmPictures : []);
    const tipo = String(b.callbackType || '1');
    const snap = await ref.get();
    if (tipo === '2' || snap.exists) {
      // Sólo fotos (o alarma ya conocida por el historial): agregar sin pisar lo demás.
      if (fotos.length) await ref.set({ pictures: admin.firestore.FieldValue.arrayUnion(...fotos), updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      if (tipo !== '2' && snap.exists && String(b.alarmStatus) === '2') await ref.set({ alarmStat: '2' }, { merge: true });
      return;
    }
    let ts = Number(b.alarmTime) || Math.floor(Date.now() / 1000); if (ts > 1e12) ts = Math.floor(ts / 1000);
    const grade = Number(b.alarmGrade) || 3;
    const fuente = { deviceName: String(b.sourceName || ''), channelName: '', channelId: String(b.sourceCode || '') };
    const { condoId, condoName } = await dssAlarmCondo(fuente);
    await ref.set({
      alarmId: '', alarmCode: String(b.alarmCode || ''), ts, at: admin.firestore.Timestamp.fromMillis(ts * 1000), lastTs: ts, lastAt: admin.firestore.Timestamp.fromMillis(ts * 1000),
      type: String(b.alarmType || ''), typeName: b.alarmTypeName && !DSS_ALARM_TYPES[Number(b.alarmType)] ? String(b.alarmTypeName) : dssAlarmNombre(b.alarmType), grade, gestionable: grade === 1,
      deviceCode: '', deviceName: String(b.sourceName || ''), channelId: String(b.sourceCode || ''), channelName: '', sourceCode: String(b.sourceCode || ''), sourceName: String(b.sourceName || ''),
      condoId, condoName, alarmStat: String(b.alarmStatus || '1'), dssHandleStatus: '0', picture: '', linkRecordChannels: [], extData: b.extData || null,
      count: 1, gestion: null, pictures: fotos, viaCallback: true, createdAt: admin.firestore.Timestamp.now(),
    });
    _dssAlarmVistas.add(docId);
    console.log(`[Eventos DSS] push: ${dssAlarmNombre(b.alarmType)} · ${b.sourceName || b.sourceCode} · grado ${grade} · ${fotos.length} foto(s)`);
  } catch (e) { console.warn('[Eventos DSS] callback:', e.message); }
});

// Suscripción al push del DSS. Una por usuario; repetirla la renueva. Se reintenta cada 6 h por
// si el DSS la pierde al reiniciar.
async function dssAlarmSubscribe() {
  const url = process.env.DSS_ALARM_CALLBACK_URL, secret = process.env.DSS_ALARM_PUSH_SECRET;
  if (!url || !secret || !DAHUA_HOST) return;
  try {
    const r = await dssAuthed('POST', '/brms/api/v1.1/push-data/alarm/subscribe', { callbackUrl: url, action: '1', signature: secret });
    if (r.body?.code === 1000) console.log('[Eventos DSS] suscripción push activa →', url);
    else console.warn('[Eventos DSS] suscripción push rechazada:', JSON.stringify(r.body).slice(0, 200));
    _jobStats.events.push = { at: new Date().toISOString(), code: r.body?.code, desc: r.body?.desc };
  } catch (e) { console.warn('[Eventos DSS] suscripción push:', e.message); _jobStats.events.push = { at: new Date().toISOString(), error: e.message }; }
}

const DSS_HANDLE_LABEL = { 1: 'En gestión', 2: 'Resuelta', 3: 'Falsa alarma', 4: 'Ignorada' };
app.use('/api/events', requireAuth, requireRole(['condo_admin', 'administrador', 'operator', 'technician']));
app.get('/api/events/status', (_req, res) => res.json(_jobStats.events));

// GET /api/events/picture/:dia/:file — foto guardada por el callback (sólo con sesión).
app.get('/api/events/picture/:dia/:file', (req, res) => {
  const { dia, file } = req.params;
  if (!/^\d{8}$/.test(dia) || !/^[A-Za-z0-9_-]+\.jpg$/.test(file)) return res.status(400).end();
  const p = require('path').join(DSS_PIC_DIR, dia, file);
  if (!require('fs').existsSync(p)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400'); res.type('image/jpeg'); res.sendFile(p);
});
// GET /api/events/:id/dss-picture — foto que el propio DSS asocia a la alarma (URL en su servidor).
app.get('/api/events/:id/dss-picture', async (req, res) => {
  try {
    const snap = await admin.firestore().collection('dssAlarms').doc(req.params.id).get();
    const url = snap.exists ? String(snap.data().picture || '') : '';
    if (!url) return res.status(404).end();
    // Las imágenes estáticas del DSS se autentican con ?token={credential} del 2º login, no con el X-Subject-Token.
    const token = await ensureReportToken();
    if (!_pollerCredential) { _pollerToken = await pollerDssLogin(); }
    const u = new URL(url);
    u.searchParams.set('token', _pollerCredential || token || '');
    require('https').get({ host: u.hostname, port: u.port || 443, path: u.pathname + u.search, rejectUnauthorized: false, headers: { 'X-Subject-Token': token || '' } }, (up) => {
      const len = Number(up.headers['content-length'] || -1);
      if (up.statusCode !== 200 || len === 0) { res.status(up.statusCode === 200 ? 404 : (up.statusCode || 502)).end(); up.resume(); return; }
      res.set('Cache-Control', 'private, max-age=86400'); res.type(up.headers['content-type'] || 'image/jpeg'); up.pipe(res);
    }).on('error', () => res.status(502).end());
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/events/sync', async (req, res) => {
  try { if (!callerIsSuper(await callerProfile(req))) return res.status(403).json({ error: 'Sólo super administrador' }); await dssAlarmsSync(); res.json(_jobStats.events); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
// POST /api/events/handle { ids: [...], status, comment } — gestiona una o varias (máx. 200)
app.post('/api/events/handle', async (req, res) => {
  const { ids, status, comment } = req.body || {};
  const lista = Array.isArray(ids) ? ids.map(String).slice(0, 200) : [];
  if (!lista.length || !DSS_HANDLE_LABEL[Number(status)]) return res.status(400).json({ error: 'ids y status (1-4) son obligatorios' });
  try {
    const prof = await callerProfile(req);
    const quien = { uid: req.user.uid, name: prof.name || prof.displayName || req.user.email || 'Usuario' };
    let ok = 0, sinPermiso = 0, dssFail = 0;
    for (const id of lista) {
      const snap = await admin.firestore().collection('dssAlarms').doc(id).get();
      if (!snap.exists) continue;
      const a = snap.data();
      if (!callerIsSuper(prof) && !callerHasCondo(prof, a.condoId)) { sinPermiso++; continue; }
      if (!a.gestionable) { sinPermiso++; continue; } // las bajas/medias son registro
      const r = await dssAlarmHandle(snap, Number(status), comment, quien);
      ok++; if (!r.dssOk) dssFail++;
    }
    console.log(`[Eventos DSS] ${quien.name} → ${DSS_HANDLE_LABEL[Number(status)]} × ${ok}${dssFail ? ` (${dssFail} sin eco en DSS)` : ''}`);
    setTimeout(() => dssAlarmsSync().catch(() => {}), 500); // refresca el contador de pendientes
    res.json({ ok: true, gestionadas: ok, sinPermiso, dssFail });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/events/:id/incident { priority?, description? } — crea un incidente desde una
// alarma alta, avisa a los técnicos del condominio y deja la alarma "En gestión" (app + DSS).
app.post('/api/events/:id/incident', async (req, res) => {
  try {
    const snap = await admin.firestore().collection('dssAlarms').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Evento no encontrado' });
    const a = snap.data();
    if (!a.gestionable) return res.status(400).json({ error: 'Sólo las alarmas de gravedad alta generan incidente' });
    if (!a.condoId) return res.status(400).json({ error: 'El evento no tiene condominio asignado' });
    const prof = await callerProfile(req);
    if (!callerIsSuper(prof) && !callerHasCondo(prof, a.condoId)) return res.status(403).json({ error: 'Sin permiso sobre este condominio' });
    if (a.gestion?.incidentId) return res.status(409).json({ error: 'Este evento ya tiene un incidente', incidentId: a.gestion.incidentId });
    const quien = { uid: req.user.uid, name: prof.name || prof.displayName || req.user.email || 'Usuario' };
    const priority = ['low', 'medium', 'high', 'critical'].includes(req.body?.priority) ? req.body.priority : 'high';
    const condoName = a.condoName || String((await admin.firestore().collection('condos').doc(a.condoId).get()).data()?.name || '').trim();
    const lugar = a.channelName ? `${a.deviceName} / ${a.channelName}` : a.deviceName;
    const fecha = new Date(a.ts * 1000).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    const descripcion = String(req.body?.description || '').trim()
      || `Alarma del DSS: ${a.typeName} en ${lugar} · ${fecha}${(a.count || 1) > 1 ? ` · ${a.count} repeticiones` : ''} · código ${a.type} · id ${a.alarmId}`;
    const now = admin.firestore.Timestamp.now();
    const ref = await admin.firestore().collection(`condos/${a.condoId}/incidents`).add({
      title: `${a.typeName} — ${lugar}`.slice(0, 120), description: descripcion, priority, category: 'security',
      location: lugar, condoId: a.condoId, condoName, reportedBy: quien.uid, reportedByName: quien.name,
      equipmentId: '', equipmentName: a.deviceName || '', status: 'open', imgApertura: 0,
      origen: 'dss_event', dssAlarmId: snap.id, createdAt: now, updatedAt: now,
    });
    await dssAlarmHandle(snap, 1, `Incidente creado en la app (${ref.id})`, quien);
    await snap.ref.update({ 'gestion.incidentId': ref.id });
    await dssAlarmNotificar(a.condoId, `Nuevo incidente: ${a.typeName}`, `${condoName} — ${lugar}`, '/incidents');
    console.log(`[Eventos DSS] ${quien.name} creó incidente ${ref.id} desde ${a.typeName} (${condoName})`);
    res.json({ ok: true, incidentId: ref.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Plantillas de WhatsApp (Cloud API) ────────────────────────────────────────
// Meta sólo deja escribir libremente dentro de las 24 h siguientes al último
// mensaje del contacto. Para un número nuevo, o pasado ese plazo, el primer
// mensaje debe ser una plantilla APROBADA de la WABA. Se listan desde Meta
// (caché 60 s) y al enviarlas se guarda en el chat el texto ya rendereado.
let _waTplCache = new Map(); // wabaId → { ts, list }
async function waCloudTemplates(wabaId) {
  const c = _waTplCache.get(wabaId);
  if (c && Date.now() - c.ts < 60_000) return c.list;
  const json = await waCloudGraph(`/${wabaId}/message_templates?status=APPROVED&fields=name,language,category,components&limit=100`);
  const list = (json?.data || []).map(t => {
    const body = (t.components || []).find(x => x.type === 'BODY')?.text || '';
    const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    return { name: t.name, language: t.language, category: t.category, body, params: nums.length ? Math.max(...nums) : 0 };
  });
  _waTplCache.set(wabaId, { ts: Date.now(), list });
  return list;
}
const renderTemplate = (body, params) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => String(params[Number(n) - 1] ?? ''));

// Envía una plantilla y deja el mensaje en la conversación (la crea si no existe).
async function enviarPlantilla({ req, numDoc, numData, phone, templateName, language, params }) {
  const wabaId = numData.cloud?.wabaId;
  if (!wabaId) throw Object.assign(new Error('Falta el WABA ID del número. Edítalo en WhatsApp — Números → Conexión.'), { status: 409 });
  const tpls = await waCloudTemplates(wabaId);
  const tpl = tpls.find(t => t.name === templateName && (!language || t.language === language));
  if (!tpl) throw Object.assign(new Error('La plantilla no existe o aún no está aprobada por Meta.'), { status: 404 });
  const vals = Array.from({ length: tpl.params }, (_, i) => String((params || [])[i] ?? '').trim());
  if (vals.some(v => !v)) throw Object.assign(new Error('Completa todos los datos de la plantilla.'), { status: 400 });
  const to = String(phone || '').replace(/\D/g, '');
  if (to.length < 9) throw Object.assign(new Error('Número inválido. Usa formato internacional, ej. +56 9 1234 5678.'), { status: 400 });
  const body = {
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
    template: { name: tpl.name, language: { code: tpl.language },
      components: vals.length ? [{ type: 'body', parameters: vals.map(v => ({ type: 'text', text: v })) }] : [] },
  };
  const json = await waCloudGraph(`/${numData.cloud.phoneNumberId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const waMessageId = json?.messages?.[0]?.id || '';
  const texto = renderTemplate(tpl.body, vals);
  const conv = await findOrCreateWaConversation(numDoc.id, to, vals[0] || '');
  const yo = { uid: req.user.uid, name: await nombreDelUsuario(req) };
  const ts = admin.firestore.Timestamp.now();
  await conv.ref.collection('messages').add({
    body: texto, fromMe: true, type: 'template', template: tpl.name,
    senderUserId: yo.uid, senderName: yo.name, hasMedia: false, mediaBase64: null, mediaType: null,
    timestamp: ts, waMessageId, createdAt: ts, deliveryStatus: 'sent',
  });
  await conv.ref.update({
    lastMessage: texto, lastMessageAt: ts, unreadCount: 0, respondedToLast: true,
    lastOperatorId: yo.uid, lastOperatorName: yo.name, lastTemplateAt: ts,
    // Cuando responda, se le pide automáticamente permiso para llamar.
    ...(WA_TPL_CON_PERMISO.has(tpl.name) ? { autoCallPermission: true } : {}),
  });
  return { conversationId: conv.ref.id, text: texto };
}

// GET /api/wa/numbers/:id/templates — plantillas aprobadas del número (por su WABA).
app.get('/api/wa/numbers/:id/templates', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const snap = await admin.firestore().collection('waNumbers').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Number not found' });
    const numData = snap.data();
    if (!esNumeroCloud(numData) || !numData.cloud?.wabaId) return res.json({ supported: false, templates: [] });
    if (!waCloudReady()) return res.status(503).json({ error: 'Cloud API no configurada en el servidor' });
    res.json({ supported: true, templates: await waCloudTemplates(numData.cloud.wabaId) });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// GET /api/wa/contact-lookup?phone= — nombre/condominio del residente para rellenar la plantilla.
app.get('/api/wa/contact-lookup', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try { res.json(await enrichWaContact(String(req.query.phone || ''))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/conversations/start { waNumberId, phone, templateName, language, params[] }
// Abre conversación con un número nuevo enviándole una plantilla.
app.post('/api/wa/conversations/start', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { waNumberId, phone, templateName, language, params } = req.body || {};
  try {
    const numDoc = await admin.firestore().collection('waNumbers').doc(String(waNumberId || '')).get();
    if (!numDoc.exists) return res.status(404).json({ error: 'Number not found' });
    const numData = numDoc.data();
    if (!esNumeroCloud(numData) || !waCloudReady() || !numData.cloud?.phoneNumberId) return res.status(409).json({ error: 'Sólo disponible en números conectados por la API de Meta.' });
    if (numData.status !== 'ready') return res.status(409).json({ error: 'El número está pausado. Actívalo en WhatsApp — Números.' });
    if (!(await puedeOperarNumero(req, numData))) return res.status(403).json({ error: 'No tienes permiso para enviar por este número.' });
    const out = await enviarPlantilla({ req, numDoc, numData, phone, templateName, language, params });
    res.json({ ok: true, ...out });
  } catch (err) { res.status(err.status || 500).json({ error: err.message, code: err.code || null }); }
});

// POST /api/wa/conversations/:id/template { templateName, language, params[] }
// Reabre una conversación existente fuera de la ventana de 24 h.
app.post('/api/wa/conversations/:id/template', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { templateName, language, params } = req.body || {};
  try {
    const convDoc = await admin.firestore().collection('waConversations').doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convDoc.data();
    const numDoc = await admin.firestore().collection('waNumbers').doc(conv.waNumberId).get();
    const numData = numDoc.data() || {};
    if (!esNumeroCloud(numData) || !waCloudReady() || !numData.cloud?.phoneNumberId) return res.status(409).json({ error: 'Sólo disponible en números conectados por la API de Meta.' });
    if (numData.status !== 'ready') return res.status(409).json({ error: 'El número está pausado.' });
    if (!(await puedeOperarNumero(req, numData))) return res.status(403).json({ error: 'No tienes permiso para enviar por este número.' });
    const out = await enviarPlantilla({ req, numDoc, numData, phone: conv.contactPhone || conv.contactId, templateName, language, params });
    res.json({ ok: true, ...out });
  } catch (err) { res.status(err.status || 500).json({ error: err.message, code: err.code || null }); }
});

// Solicitud de permiso para llamar (mensaje interactivo de Meta con botones
// Permitir / No permitir). Sólo puede enviarse dentro de la ventana de 24 h.
const WA_CALL_PERMISSION_TEXT = 'Gracias por responder. Para poder avisarle también por llamada de WhatsApp sobre sus visitas y encomiendas, ¿nos autoriza a llamarle por este medio?';
// Plantillas que, al ser respondidas, gatillan la solicitud de permiso automáticamente.
const WA_TPL_CON_PERMISO = new Set(['bienvenida_contacto', 'contacto_porteria']);

async function enviarSolicitudPermisoLlamada(convRef, conv, numData, quien, texto) {
  const to = String(conv.contactPhone || conv.contactId || '').replace(/\D/g, '');
  const text = String(texto || '').trim() || WA_CALL_PERMISSION_TEXT;
  const json = await waCloudGraph(`/${numData.cloud.phoneNumberId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive',
      interactive: { type: 'call_permission_request', action: { name: 'call_permission_request' }, body: { text } },
    }),
  });
  const waMessageId = json?.messages?.[0]?.id || '';
  const ts = admin.firestore.Timestamp.now();
  await convRef.collection('messages').add({
    body: `📞 Solicitud de permiso para llamar: "${text}"`, fromMe: true, type: 'call_permission',
    senderUserId: quien?.uid || null, senderName: quien?.name || 'Automático', hasMedia: false, mediaBase64: null, mediaType: null,
    timestamp: ts, waMessageId, createdAt: ts, deliveryStatus: 'sent',
  });
  await convRef.update({
    lastMessage: '📞 Solicitud de permiso para llamar', lastMessageAt: ts,
    ...(quien?.uid ? { lastOperatorId: quien.uid, lastOperatorName: quien.name } : {}),
    callPermission: { status: 'requested', requestedAt: ts, updatedAt: ts },
    autoCallPermission: admin.firestore.FieldValue.delete(),
  });
}

// ── Llamadas por WhatsApp — endpoints para el navegador del operador ─────────
// Quién puede operar un número: sus operadores asignados, o super_admin/condo_admin.
async function puedeOperarNumero(req, numData) {
  const uid = req.user?.uid;
  if ((numData.assignedUsers || []).some(u => u.uid === uid)) return true;
  const prof = await callerProfile(req);
  return callerIsSuper(prof) || prof.role === 'condo_admin';
}
async function nombreDelUsuario(req) {
  const prof = await callerProfile(req);
  return prof.name || prof.displayName || req.user?.email || 'Operador';
}
async function cargarLlamada(req, res) {
  const ref = admin.firestore().collection('waCalls').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) { res.status(404).json({ error: 'Llamada no encontrada' }); return null; }
  const call = snap.data();
  const numSnap = await admin.firestore().collection('waNumbers').doc(call.waNumberId || '').get();
  const numData = numSnap.exists ? numSnap.data() : {};
  if (!(await puedeOperarNumero(req, numData))) { res.status(403).json({ error: 'No tienes permiso sobre este número.' }); return null; }
  return { ref, call, numData };
}

// POST /api/wa/calls/:id/accept  { sdp }  — contestar una llamada entrante.
// Toma la llamada de forma atómica (si dos operadores contestan, gana uno) y hace
// el pre_accept en Meta con la respuesta SDP del navegador.
app.post('/api/wa/calls/:id/accept', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const sdp = String(req.body?.sdp || '');
  if (!sdp.includes('m=audio')) return res.status(400).json({ error: 'Falta la respuesta SDP de audio' });
  try {
    const ctx = await cargarLlamada(req, res); if (!ctx) return;
    const { ref, call } = ctx;
    const yo = { uid: req.user.uid, name: await nombreDelUsuario(req) };
    let tomada = false;
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data() || {};
      if (d.status !== 'ringing' || d.direction !== 'inbound' || d.finalizado) return;
      tx.update(ref, { status: 'connecting', acceptedBy: yo, acceptedAt: admin.firestore.Timestamp.now(), answerSdp: sdp, updatedAt: admin.firestore.Timestamp.now() });
      tomada = true;
    });
    if (!tomada) return res.status(409).json({ error: 'La llamada ya fue tomada por otro operador o terminó.' });
    try {
      await waCloudCallAction(call.phoneNumberId, { call_id: call.waCallId, action: 'pre_accept', session: { sdp_type: 'answer', sdp } });
    } catch (e) {
      // Si Meta ya no tiene la llamada, cerrarla; si fue otro error, devolverla a 'ringing'.
      if (/sdp/i.test(e.detail || '')) console.warn('[WA-Call] SDP rechazada (answer):\n' + sdp.slice(0, 3000));
      if (e.code === 138003) await finalizarLlamada(ref, { forcedStatus: 'missed', endedBy: 'meta' });
      else await ref.update({ status: 'ringing', acceptedBy: null, answerSdp: null }).catch(() => {});
      return res.status(e.status || 502).json({ error: e.message, code: e.code || null });
    }
    // accept definitivo de inmediato: Meta sólo deja fluir el audio después de él, y
    // esperar al navegador hacía que el que llama oyera silencio y colgara.
    const aceptada = await confirmarLlamada(ref.id, 'server');
    res.json({ ok: true, aceptada });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/calls/:id/confirm — el audio quedó conectado: "accept" definitivo.
app.post('/api/wa/calls/:id/confirm', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const ctx = await cargarLlamada(req, res); if (!ctx) return;
    const ok = await confirmarLlamada(ctx.ref.id, 'browser');
    res.json({ ok, alreadyAccepted: !ok });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/calls/:id/reject — rechazar una llamada entrante que está sonando.
app.post('/api/wa/calls/:id/reject', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const ctx = await cargarLlamada(req, res); if (!ctx) return;
    const { ref, call } = ctx;
    if (call.finalizado) return res.json({ ok: true });
    const yo = { uid: req.user.uid, name: await nombreDelUsuario(req) };
    await ref.update({ status: 'rejected', acceptedBy: yo, updatedAt: admin.firestore.Timestamp.now() });
    try { await waCloudCallAction(call.phoneNumberId, { call_id: call.waCallId, action: 'reject' }); }
    catch (e) { if (e.code !== 138003) console.warn('[WA-Call] reject:', e.message); }
    await finalizarLlamada(ref, { endedBy: yo.uid });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/calls/:id/terminate — colgar (en curso) o cancelar (saliente sin contestar).
app.post('/api/wa/calls/:id/terminate', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const ctx = await cargarLlamada(req, res); if (!ctx) return;
    const { ref, call } = ctx;
    if (call.finalizado) return res.json({ ok: true });
    try { await waCloudCallAction(call.phoneNumberId, { call_id: call.waCallId, action: 'terminate' }); }
    catch (e) { if (e.code !== 138003) console.warn('[WA-Call] terminate:', e.message); }
    const forced = (call.direction === 'outbound' && ['calling', 'ringing'].includes(call.status)) ? 'cancelled' : undefined;
    await finalizarLlamada(ref, { endedBy: req.user.uid, forcedStatus: forced });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/conversations/:id/call  { sdp }  — llamar al contacto.
// Meta exige permiso del usuario para llamadas iniciadas por el negocio (error
// 138006): se obtiene con la solicitud de permiso o cuando él nos llamó antes.
app.post('/api/wa/conversations/:id/call', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const sdp = String(req.body?.sdp || '');
  const purpose = ['parcel_notice'].includes(req.body?.purpose) ? req.body.purpose : null;
  if (!sdp.includes('m=audio')) return res.status(400).json({ error: 'Falta la oferta SDP de audio' });
  try {
    const convDoc = await admin.firestore().collection('waConversations').doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convDoc.data();
    const numDoc  = await admin.firestore().collection('waNumbers').doc(conv.waNumberId).get();
    const numData = numDoc.data() || {};
    if (!esNumeroCloud(numData)) return res.status(409).json({ error: 'Las llamadas sólo están disponibles en números conectados por la API de Meta.' });
    if (!waCloudReady() || !numData.cloud?.phoneNumberId) return res.status(409).json({ error: 'El número por API no está configurado.' });
    if (numData.status !== 'ready') return res.status(409).json({ error: 'El número está pausado. Actívalo en WhatsApp — Números.' });
    if (!numData.cloud?.calling?.enabled) return res.status(409).json({ error: 'Las llamadas no están habilitadas para este número. Actívalas en WhatsApp — Números.', code: 138000 });
    if (!(await puedeOperarNumero(req, numData))) return res.status(403).json({ error: 'No tienes permiso para llamar por este número.' });

    const to = String(conv.contactPhone || conv.contactId || '').replace(/\D/g, '');
    const yo = { uid: req.user.uid, name: await nombreDelUsuario(req) };
    let json;
    try {
      json = await waCloudCallAction(numData.cloud.phoneNumberId, {
        to, action: 'connect', session: { sdp_type: 'offer', sdp }, biz_opaque_callback_data: convDoc.id,
      });
    } catch (e) {
      if (/sdp/i.test(e.detail || '')) console.warn('[WA-Call] SDP rechazada (offer):\n' + sdp.slice(0, 3000));
      return res.status(e.status || 502).json({ error: e.message, code: e.code || null });
    }
    const waCallId = json?.calls?.[0]?.id;
    const docId = waCallDocId(waCallId);
    if (!docId) return res.status(502).json({ error: 'Meta no devolvió el id de la llamada' });
    const ref = admin.firestore().collection('waCalls').doc(docId);
    const now = admin.firestore.Timestamp.now();
    // El webhook (RINGING / respuesta SDP) puede llegar antes que este set: no pisar su estado.
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      tx.set(ref, {
        waCallId, waNumberId: numDoc.id, phoneNumberId: numData.cloud.phoneNumberId,
        conversationId: convDoc.id, contactPhone: to, contactName: conv.contactName || to,
        condoName: conv.condoName || '', unit: conv.unit || '',
        direction: 'outbound', status: d.status || 'calling', offerSdp: sdp, offerType: 'offer',
        startedBy: yo, acceptedBy: null, purpose,
        ...(snap.exists ? {} : { startedAt: null, endedAt: null, duration: 0, finalizado: false, createdAt: now }),
        updatedAt: now,
      }, { merge: true });
    });
    console.log(`[WA-Call] saliente a ${to} por ${yo.name} → ${docId}`);
    res.json({ ok: true, callId: docId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/conversations/:id/call-permission  { text? } — pedir permiso para llamar.
// Meta limita estas solicitudes (1 cada 24 h, 2 por semana por contacto).
app.post('/api/wa/conversations/:id/call-permission', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const convDoc = await admin.firestore().collection('waConversations').doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convDoc.data();
    const numDoc  = await admin.firestore().collection('waNumbers').doc(conv.waNumberId).get();
    const numData = numDoc.data() || {};
    if (!esNumeroCloud(numData) || !waCloudReady() || !numData.cloud?.phoneNumberId) return res.status(409).json({ error: 'Sólo disponible en números conectados por la API de Meta.' });
    if (numData.status !== 'ready') return res.status(409).json({ error: 'El número está pausado.' });
    if (!(await puedeOperarNumero(req, numData))) return res.status(403).json({ error: 'No tienes permiso para usar este número.' });
    const yo = { uid: req.user.uid, name: await nombreDelUsuario(req) };
    try {
      await enviarSolicitudPermisoLlamada(convDoc.ref, conv, numData, yo, req.body?.text);
    } catch (e) {
      return res.status(e.status || 502).json({ error: e.message, code: e.code || null });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET/POST /api/wa/numbers/:id/calling — estado de llamadas del número en Meta.
app.get('/api/wa/numbers/:id/calling', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const snap = await admin.firestore().collection('waNumbers').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Number not found' });
    const numData = snap.data();
    if (!esNumeroCloud(numData) || !numData.cloud?.phoneNumberId) return res.json({ supported: false });
    if (!waCloudReady()) return res.status(503).json({ error: 'Cloud API no configurada en el servidor' });
    const st = await waCloudGetCalling(numData.cloud.phoneNumberId);
    res.json({ supported: true, ...st });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
app.post('/api/wa/numbers/:id/calling', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const enabled = !!req.body?.enabled;
  try {
    const prof = await callerProfile(req);
    if (!callerIsSuper(prof)) return res.status(403).json({ error: 'Sólo un super administrador puede cambiar las llamadas del número.' });
    const ref  = admin.firestore().collection('waNumbers').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Number not found' });
    const numData = snap.data();
    if (!esNumeroCloud(numData) || !numData.cloud?.phoneNumberId) return res.status(409).json({ error: 'Las llamadas requieren un número conectado por la API de Meta.' });
    if (!waCloudReady()) return res.status(503).json({ error: 'Cloud API no configurada en el servidor' });
    await waCloudSetCalling(numData.cloud.phoneNumberId, enabled);
    const st = await waCloudGetCalling(numData.cloud.phoneNumberId).catch(() => ({ enabled }));
    await ref.update({ 'cloud.calling': { enabled: !!st.enabled, updatedAt: admin.firestore.Timestamp.now(), updatedBy: req.user.uid } });
    console.log(`[WA-Call] llamadas ${st.enabled ? 'HABILITADAS' : 'deshabilitadas'} en ${numData.name} (${numData.cloud.phoneNumberId})`);
    res.json({ ok: true, ...st });
  } catch (err) { res.status(err.status || 500).json({ error: err.message, code: err.code || null }); }
});

// ── Atención al Cliente — evaluación de calidad con Claude ───────────────────

const WA_EVAL_SYSTEM = `Eres un auditor de calidad de un servicio de Portería Virtual (conserjería remota y control de acceso 24/7 para edificios y condominios). Evalúas el desempeño de un operador HUMANO a partir de la transcripción de un chat/llamado y de métricas de tiempo.

Tu objetivo es ser objetivo, consistente y justo. Evalúa SOLO con evidencia presente en la transcripción y en los datos entregados. Si falta información para un indicador, asígnale "valor": null y explícalo en "comentario". Nunca inventes datos.

Contexto del servicio: el operador controla accesos (visitas, proveedores, deliveries, encomiendas), verifica identidad antes de autorizar ingresos, registra eventos en bitácora y atiende emergencias. La seguridad pesa más que la rapidez: autorizar un ingreso sin verificar es una falta grave.

Evalúa estos 10 indicadores. Para cada uno entrega un "valor" en su unidad y un "puntaje" de 0 a 100 según la regla indicada:

1. tiempo_respuesta_acceso (seg) — Meta <=10. Menor es mejor. Puntaje=100 si valor<=10, si no MAX(0, 10/valor*100). (Usa el dato de tiempo entregado; no lo estimes del texto.)
2. tiempo_gestion_acceso (seg) — Meta <=30. Menor es mejor. Igual regla con meta 30.
3. atendido (0/1) — ¿El operador respondió al usuario? 1=sí (100 pts), 0=no (0 pts).
4. verificacion_identidad_correcta (0/1) — ¿Pidió y confirmó identidad/autorización antes de dar acceso, según protocolo? 1=sí (100), 0=no (0). Si no hubo gestión de acceso en el chat, valor=null.
5. errores_acceso (n°) — Conteo de ingresos autorizados sin validar o denegados indebidamente. Puntaje=MAX(0, 100 - valor*25).
6. registro_bitacora_correcto (0/1) — ¿Dejó registro/confirmación del evento? 1=100, 0=0. Si no aplica, null.
7. tono_y_protocolo (0-100) — Calidad de la atención: saludo, identificación de la comunidad, trato cordial, claridad, ortografía, cierre. Puntúa de 0 a 100.
8. manejo_incidente (0-100) — Si hubo emergencia/incidente, ¿siguió el procedimiento (mantener la calma, contactar residente, derivar a guardia/Carabineros)? Si no hubo incidente, valor=null.
9. csat_estimado (0-100) — Satisfacción probable del usuario inferida del tono y la resolución. Es una estimación, no reemplaza la encuesta real.
10. reclamo_detectado (n°) — ¿El usuario expresó una queja explícita por el operador? 0 o 1+. Puntaje=MAX(0, 100 - valor*20).

Reglas de salida:
- Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown.
- Respeta exactamente las claves del esquema.
- "comentario" de cada indicador: máx 1 frase justificando el puntaje con evidencia.
- "resumen": 2-3 frases con fortalezas, riesgos y una recomendación de mejora.
- "banderas_rojas": lista de faltas graves de seguridad detectadas (puede ir vacía).

El puntaje_total debe calcularse con estos pesos: tiempo_respuesta 15, tiempo_gestion 10, atendido 10, verificacion_identidad 12, errores_acceso 10, bitacora 8, tono 10, manejo_incidente 10, csat 8, reclamo 7. Los indicadores con valor null se excluyen y los pesos se renormalizan sobre los presentes.

Esquema de salida fijo:
{"operador":"...","turno":"...","comunidad":"...","fecha":"...","indicadores":{"tiempo_respuesta_acceso":{"valor":null,"puntaje":null,"comentario":""},"tiempo_gestion_acceso":{"valor":null,"puntaje":null,"comentario":""},"atendido":{"valor":null,"puntaje":null,"comentario":""},"verificacion_identidad_correcta":{"valor":null,"puntaje":null,"comentario":""},"errores_acceso":{"valor":null,"puntaje":null,"comentario":""},"registro_bitacora_correcto":{"valor":null,"puntaje":null,"comentario":""},"tono_y_protocolo":{"valor":null,"puntaje":null,"comentario":""},"manejo_incidente":{"valor":null,"puntaje":null,"comentario":""},"csat_estimado":{"valor":null,"puntaje":null,"comentario":""},"reclamo_detectado":{"valor":null,"puntaje":null,"comentario":""}},"puntaje_total":null,"semaforo":"VERDE","resumen":"","banderas_rojas":[]}`;

async function _callClaude(input) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurado en el servidor');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0,
      system: WA_EVAL_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(input, null, 0) }],
    }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Anthropic ${res.status}: ${t}`); }
  const data = await res.json();
  return JSON.parse(data.content[0].text);
}

function _deriveTurno(ts) {
  const h = new Date(ts).getHours();
  if (h < 8)  return 'Noche';
  if (h < 18) return 'Día';
  return 'Tarde';
}

// ── Core evaluation logic (shared by auto + manual) ──────────────────────────
// force=true skips the "already evaluated since last message" check.
async function _evaluateConversation(conversationId, force = false) {
  if (!admin.apps.length) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const db = admin.firestore();
  const convDoc = await db.collection('waConversations').doc(conversationId).get();
  if (!convDoc.exists) return null;
  const conv = convDoc.data();

  if (!force) {
    // Skip if already evaluated after the last message
    const lastMsgAt = conv.lastMessageAt?.toMillis?.() ?? 0;
    const prevSnap = await db.collection('waEvaluations')
      .where('conversationId', '==', conversationId)
      .orderBy('evaluatedAt', 'desc').limit(1).get();
    if (!prevSnap.empty) {
      const prevAt = prevSnap.docs[0].data().evaluatedAt?.toMillis?.() ?? 0;
      if (prevAt >= lastMsgAt) return null; // already up-to-date
    }
  }

  const msgSnap = await db.collection('waConversations').doc(conversationId)
    .collection('messages').orderBy('timestamp').get();
  if (msgSnap.empty) return null;

  const msgs = msgSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const firstVisitorMsg = msgs.find(m => !m.fromMe);
  const firstOpMsg      = msgs.find(m => m.fromMe);
  const lastOpMsg       = [...msgs].reverse().find(m => m.fromMe);

  const t0 = firstVisitorMsg?.timestamp?.toMillis?.() ?? null;
  const t1 = firstOpMsg?.timestamp?.toMillis?.() ?? null;
  const tN = lastOpMsg?.timestamp?.toMillis?.() ?? null;

  const tiempoRespuesta = (t0 && t1 && t1 > t0) ? Math.round((t1 - t0) / 1000) : null;
  const tiempoGestion   = (t0 && tN && tN > t0) ? Math.round((tN - t0) / 1000) : null;

  const transcripcion = msgs.map(m => ({
    rol:   m.fromMe ? 'operador' : 'visita',
    hora:  new Date((m.timestamp?.toMillis?.() ?? Date.now())).toTimeString().slice(0, 8),
    texto: m.body || '',
  }));

  const firstTs   = firstVisitorMsg?.timestamp?.toMillis?.() ?? Date.now();
  const fecha     = new Date(firstTs).toISOString().slice(0, 10);
  const turno     = _deriveTurno(firstTs);
  const comunidad = conv.condoName || 'Portería Virtual';
  const opMsg     = msgs.find(m => m.fromMe && m.senderName);
  const operador  = opMsg?.senderName || conv.lastOperatorName || 'Operador';

  const input = {
    operador, turno, comunidad, fecha,
    ...(tiempoRespuesta !== null && { tiempo_respuesta_acceso_seg: tiempoRespuesta }),
    ...(tiempoGestion   !== null && { tiempo_gestion_acceso_seg:   tiempoGestion }),
    transcripcion,
  };

  const evaluation = await _callClaude(input);

  const evalRef = db.collection('waEvaluations').doc();
  await evalRef.set({
    ...evaluation,
    conversationId,
    waNumberId:   conv.waNumberId,
    contactName:  conv.contactName,
    contactPhone: conv.contactPhone,
    evaluatedAt:  admin.firestore.Timestamp.now(),
  });

  console.log(`[Eval] ${conversationId} → ${evaluation.semaforo} ${evaluation.puntaje_total}`);
  return { id: evalRef.id, ...evaluation };
}

// ── Startup catch-up: evaluate recent unevaluated conversations ───────────────
async function autoEvalCatchUp() {
  if (!admin.apps.length || !process.env.ANTHROPIC_API_KEY) return;
  try {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - EVAL_INACTIVITY_MS);
    // Conversations silent for 20+ min (lastMessageAt < cutoff)
    const snap = await db.collection('waConversations')
      .where('lastMessageAt', '<', cutoff)
      .orderBy('lastMessageAt', 'desc')
      .limit(50).get();

    let queued = 0;
    for (const doc of snap.docs) {
      const lastMsgAt = doc.data().lastMessageAt?.toMillis?.() ?? 0;
      if (Date.now() - lastMsgAt > 7 * 24 * 60 * 60 * 1000) continue; // skip > 7 days old

      // Check if already evaluated after last message
      const prevSnap = await db.collection('waEvaluations')
        .where('conversationId', '==', doc.id)
        .orderBy('evaluatedAt', 'desc').limit(1).get();
      if (!prevSnap.empty) {
        const prevAt = prevSnap.docs[0].data().evaluatedAt?.toMillis?.() ?? 0;
        if (prevAt >= lastMsgAt) continue;
      }

      // Check it has messages
      const msgCount = (await doc.ref.collection('messages').limit(1).get()).size;
      if (!msgCount) continue;

      // Stagger 4 s apart to stay well within API rate limits
      setTimeout(() => _evaluateConversation(doc.id)
        .catch(e => console.error('[Eval] catch-up error:', e.message)), queued * 4000);
      queued++;
    }
    if (queued > 0) console.log(`[Eval] Catch-up: queued ${queued} conversations`);
  } catch (err) {
    console.error('[Eval] autoEvalCatchUp error:', err.message);
  }
}

// POST /api/wa/evaluate — manual/forced evaluation
app.post('/api/wa/evaluate', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { conversationId } = req.body || {};
  if (!conversationId) return res.status(400).json({ error: 'conversationId requerido' });
  try {
    const result = await _evaluateConversation(conversationId, true);
    if (!result) return res.status(400).json({ error: 'Sin mensajes para evaluar o API key no configurada' });
    res.json(result);
  } catch (err) {
    console.error('[Eval]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wa/evaluations?waNumberId=xxx&limit=50
app.get('/api/wa/evaluations', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  try {
    const db = admin.firestore();
    const { waNumberId, conversationId, limit: lim } = req.query;
    let q = db.collection('waEvaluations').orderBy('evaluatedAt', 'desc');
    if (waNumberId)    q = q.where('waNumberId', '==', waNumberId);
    if (conversationId) q = q.where('conversationId', '==', conversationId);
    q = q.limit(parseInt(lim) || 50);
    const snap = await q.get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Serve Vite build ──────────────────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist');
// index.html must never be cached (por CDN/navegador) o quedan apuntando a assets
// viejos tras un deploy; los assets hasheados sí se cachean.
app.use(express.static(DIST, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.set('Cache-Control', 'no-store, must-revalidate');
  },
}));

// SPA fallback — any unmatched route returns index.html so React Router works
app.get('*', (_req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(DIST, 'index.html'));
});

// ── Startup: reset stale WA number statuses ──────────────────────────────────
// After a server restart _waClients is empty, but Firestore may still show
// 'ready'/'connecting'/'qr' from the previous session.  Reset them so the UI
// shows the "Conectar" button instead of "Desconectar".
async function resetWaStatusesOnStartup() {
  if (!admin.apps.length) return;
  try {
    const snap = await admin.firestore().collection('waNumbers').get();
    const batch = admin.firestore().batch();
    let count = 0;
    snap.docs.forEach(d => {
      const s = d.data().status;
      if (s && s !== 'disconnected') {
        batch.update(d.ref, { status: 'disconnected', qrDataUrl: null });
        count++;
      }
    });
    if (count > 0) {
      await batch.commit();
      console.log(`[WA] Reset ${count} stale WA number status(es) to disconnected`);
    }
  } catch (e) {
    console.warn('[WA] Could not reset WA statuses on startup:', e.message);
  }
}

// ── Startup: reconecta automáticamente números que estaban activos ────────────
// Después de un reinicio de Passenger/servidor, los números con shouldAutoReconnect=true
// se reconectan solos sin que el usuario tenga que presionar "Conectar".
async function autoReconnectOnStartup() {
  if (!admin.apps.length) return;
  if (!loadWaLib()) return;
  try {
    const snap = await admin.firestore().collection('waNumbers')
      .where('shouldAutoReconnect', '==', true).get();
    // Los números por API no tienen Chrome que reconectar.
    const ids = snap.docs.filter(d => !esNumeroCloud(d.data())).map(d => d.id);
    if (ids.length === 0) return;
    console.log(`[WA] Auto-reconectando ${ids.length} número(s) tras reinicio del servidor…`);
    for (let i = 0; i < ids.length; i++) {
      // Escalona 6s entre números para no saturar la memoria al arrancar simultáneamente.
      setTimeout(() => {
        initWaClient(ids[i]).catch(e =>
          console.error(`[WA] ${ids[i]} startup reconnect error:`, e.message));
      }, i * 6000);
    }
  } catch (e) {
    console.warn('[WA] autoReconnectOnStartup error:', e.message);
  }
}

// ── Graceful shutdown: destruye Chrome antes de que PM2 mate el proceso ────────
// Sin esto, Chrome queda huérfano en cada restart y el próximo arranque falla
// con "browser already running" porque el SingletonLock sigue activo.
function gracefulShutdown(signal) {
  console.log(`[Server] ${signal} recibido — limpiando Chrome…`);
  // Cancel pending reconnect timers so the dying process doesn't spawn new Chrome
  // instances that become orphans and block the new process from initializing.
  for (const [, timer] of _waReconnectTimers.entries()) clearTimeout(timer);
  _waReconnectTimers.clear();
  // Síncrono: mata Chrome y borra locks ANTES de que PM2 envíe SIGKILL.
  // No esperamos client.destroy() (async) porque PM2 puede matar el proceso antes.
  for (const [numberId] of _waClients.entries()) {
    killWaSessionChrome(numberId);
    clearWaSessionLock(numberId);
  }
  // Adicionalmente: mata cualquier Chrome usando wa_sessions (captura huérfanos)
  clearAllWaSessionLocks();
  process.exit(0);
}
// Un rechazo no capturado en un job no debe tumbar el proceso (Node ≥15 lo haría): se registra.
process.on('unhandledRejection', (err) => { console.error('[unhandledRejection]', (err && err.stack) || err); });
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────
// ── Retención de datos (Ley 21.719, principio de finalidad/proporcionalidad) ───
// Depura automáticamente los datos que superan el plazo de conservación declarado en la
// Política de Privacidad: bitácoras de acceso a los 2 años (accessEvents/accessDaily) y
// tokens de ratificación sin usar a los 90 días. Corre 1 vez/día. Los datos actuales son
// de 2026, así que hoy es no-op; enforcea la política hacia adelante.
const RETENTION_DAYS = Number(process.env.ACCESS_RETENTION_DAYS || 730);   // 2 años
const VISITOR_RETENTION_DAYS = Number(process.env.VISITOR_RETENTION_DAYS || 120); // pases de visita: 4 meses (informes usan máx. 90d)
async function purgeExpiredData() {
  if (!admin.apps.length) return;
  const firestore = admin.firestore();
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoffTs = nowSec - RETENTION_DAYS * 86400;
    const cutoffDate = new Date(cutoffTs * 1000).toISOString().slice(0, 10);
    let delEvents = 0, delDaily = 0, delTokens = 0, delVisitors = 0;
    const visitorCutoffDate = new Date(nowSec * 1000 - VISITOR_RETENTION_DAYS * 86400 * 1000).toISOString().slice(0, 10);
    const condos = await firestore.collection('condos').get();
    for (const c of condos.docs) {
      // Pases de visita antiguos (por fecha) — se conservan mientras sirven a los
      // informes (máx. 90 días) y luego se purgan. A esta antigüedad ya están cerrados.
      for (let guard = 0; guard < 50; guard++) {
        const snap = await firestore.collection(`condos/${c.id}/visitors`).where('date', '<', visitorCutoffDate).limit(400).get();
        if (snap.empty) break;
        const batch = firestore.batch(); snap.forEach(d => batch.delete(d.ref)); await batch.commit();
        delVisitors += snap.size;
        if (snap.size < 400) break;
      }
      // accessEvents por timestamp
      for (let guard = 0; guard < 50; guard++) {
        const snap = await firestore.collection(`condos/${c.id}/accessEvents`).where('ts', '<', cutoffTs).limit(400).get();
        if (snap.empty) break;
        const batch = firestore.batch(); snap.forEach(d => batch.delete(d.ref)); await batch.commit();
        delEvents += snap.size;
        if (snap.size < 400) break;
      }
      // accessDaily por fecha (id = YYYY-MM-DD)
      const daily = await firestore.collection(`condos/${c.id}/accessDaily`).get();
      const old = daily.docs.filter(d => d.id < cutoffDate);
      for (let i = 0; i < old.length; i += 400) {
        const batch = firestore.batch(); old.slice(i, i + 400).forEach(d => batch.delete(d.ref)); await batch.commit();
        delDaily += Math.min(400, old.length - i);
      }
    }
    // ratifyTokens sin usar > 90 días
    const tokCut = admin.firestore.Timestamp.fromMillis(Date.now() - 90 * 86400 * 1000);
    for (let guard = 0; guard < 20; guard++) {
      const snap = await firestore.collection('ratifyTokens').where('createdAt', '<', tokCut).limit(400).get();
      if (snap.empty) break;
      const batch = firestore.batch(); snap.forEach(d => batch.delete(d.ref)); await batch.commit();
      delTokens += snap.size;
      if (snap.size < 400) break;
    }
    if (delEvents || delDaily || delTokens || delVisitors)
      console.log(`[Retención] purgados: ${delVisitors} pases (>${VISITOR_RETENTION_DAYS}d), ${delEvents} eventos, ${delDaily} rollups, ${delTokens} tokens (>${RETENTION_DAYS}d)`);
    else console.log(`[Retención] nada por purgar (pases ${VISITOR_RETENTION_DAYS}d, acceso ${RETENTION_DAYS}d)`);
  } catch (e) { console.warn('[Retención] error:', e.message); }
}

app.listen(port, () => {
  console.log(`🚀 Portería Virtual running on port ${port}`);

  // Semilla del flag de consentimiento (Ley 21.719). Se crea DESACTIVADO: el flujo
  // no se muestra a nadie hasta que un super_admin ponga enabled:true en config/consent.
  if (admin.apps.length) {
    const cRef = admin.firestore().doc('config/consent');
    cRef.get().then(s => {
      if (!s.exists) cRef.set({ version: 1, enabled: false, createdAt: admin.firestore.Timestamp.now() });
    }).catch(() => {});
  }

  // Limpia locks y procesos Chrome huérfanos ANTES de cualquier inicialización WA
  clearAllWaSessionLocks();

  // Reset stale WA number statuses from previous session
  setTimeout(() => resetWaStatusesOnStartup().catch(() => {}), 5000);

  // Auto-reconnect numbers that were connected before this restart
  markCloudNumbersOnStartup().catch(() => {});
  setTimeout(() => autoReconnectOnStartup().catch(() => {}), 8000);

  // Auto-evaluate conversations that went silent before the last restart
  setTimeout(() => autoEvalCatchUp().catch(() => {}), 20000);

  // Auto-download Puppeteer Chrome in background if no system Chrome
  if (!WA_CHROME_PATH) {
    setTimeout(() => {
      installPuppeteerChrome().catch(() => {});
    }, 3000);
  }

  // Start DSS visitor poller after a short delay to let Firebase Admin initialize
  if (DAHUA_HOST) {
    setTimeout(() => {
      if (!admin.apps.length) {
        console.warn('[DSS Poller] Firebase Admin not initialized — poller disabled');
        return;
      }
      console.log('🔄 DSS visitor poller started (30 s interval)');
      pollVisitorStatuses();
      setInterval(pollVisitorStatuses, 30_000);

      console.log('🔁 DSS sync-retry job started (60 s interval)');
      syncPendingVisitors();
      setInterval(syncPendingVisitors, 60_000);

      console.log('🗄️  Access-events sync job started (3 min interval)');
      syncAccessEvents();
      setInterval(syncAccessEvents, 3 * 60_000);

      console.log(`🧹 Retención de datos: job diario (retención ${RETENTION_DAYS} días)`);
      purgeExpiredData();
      setInterval(purgeExpiredData, 24 * 60 * 60_000);

      console.log(`🔐 Barrido de credenciales DSS: cada 6 h (últimos ${SWEEP_DAYS} días)`);
      setTimeout(sweepVisitorCredentials, 60_000);
      setInterval(sweepVisitorCredentials, 6 * 60 * 60_000);

      if (shelly.configured()) {
        console.log('💡 Iluminación (Shelly): lectura cada 60 s, sincronización diaria');
        setTimeout(() => shellyPoll().catch(() => {}), 20_000);
        setInterval(() => shellyPoll().catch(() => {}), SHELLY_POLL_MS);
        setInterval(() => shellySync('auto').catch(e => console.warn('[Shelly] sync:', e.message)), SHELLY_SYNC_MS);
      } else console.log('💡 Iluminación (Shelly): sin SHELLY_HOST/SHELLY_AUTH_KEY — módulo inactivo');

      console.log('🚨 Centro de eventos (DSS): lectura cada 60 s, retención 30 días');
      setTimeout(() => dssAlarmsSync().catch(() => {}), 30_000);
      setInterval(() => dssAlarmsSync().catch(() => {}), DSS_ALARM_POLL_MS);
      setTimeout(dssAlarmsPurge, 120_000);
      setInterval(dssAlarmsPurge, 24 * 60 * 60_000);
      setTimeout(() => dssAlarmSubscribe().catch(() => {}), 45_000);
      setInterval(() => dssAlarmSubscribe().catch(() => {}), 6 * 60 * 60_000);
    }, 15_000);
  }
});
