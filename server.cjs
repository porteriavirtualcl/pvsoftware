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
app.use(bodyParser.json({ limit: '2mb' }));
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
app.use('/api/users', authLimiter);
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

if (DAHUA_HOST) {
  app.all('/dahua/*', (req, res) => {
    const targetUrl = new URL(
      req.path.replace(/^\/dahua/, '') + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''),
      DAHUA_HOST
    );

    const isHttps   = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port:     targetUrl.port || (isHttps ? 443 : 80),
      path:     targetUrl.pathname + targetUrl.search,
      method:   req.method,
      // Skip TLS verification — DSS appliances often use self-signed certs
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        ...( req.headers['x-subject-token']
               ? { 'X-Subject-Token': req.headers['x-subject-token'] }
               : {} ),
      },
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode || 200);
      // Forward relevant headers
      const forward = ['content-type', 'x-subject-token'];
      forward.forEach(h => { if (proxyRes.headers[h]) res.set(h, proxyRes.headers[h]); });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[Dahua proxy] request error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'DSS proxy error', detail: err.message });
    });

    // Forward request body for POST/PUT
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
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

app.post('/api/dahua/login', async (_req, res) => {
  if (!DAHUA_HOST || !DAHUA_USER || !DAHUA_PASS) {
    return res.status(503).json({ error: 'Dahua credentials not configured on server' });
  }
  try {
    // Step 1 — get realm + randomKey (DSS returns 401 by design)
    const step1 = await dssRequest('POST', '/brms/api/v1.0/accounts/authorize',
      { userName: DAHUA_USER, ipAddress: '', clientType: 'API' }, {});
    const { realm, randomKey } = step1.body;
    if (!realm || !randomKey) {
      return res.status(502).json({ error: 'step-1 missing realm/randomKey', detail: step1.body });
    }

    // Step 2 — sign and authenticate
    const signature = buildDssSignature(DAHUA_USER, DAHUA_PASS, realm, randomKey);
    const step2 = await dssRequest('POST', '/brms/api/v1.0/accounts/authorize', {
      mac: '00:DE:AD:BE:EF:01', signature, userName: DAHUA_USER, randomKey,
      publicKey:
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LwTBkqEyS0qpahbp5HlSc+tttuJUuPftmMo' +
        '+QSSsZ+fbNou3W/fFzyPhcCbInIXp1UxGr2qwbkfSd7GPUKO36QpFSHDKJHenjedEWTfaZsCltmjMKtx' +
        '2j5M/L+Ij2T31t2XNITlo22TFdWMNyUHFMTEvi6hXFsWlPBr7yTrACGrgDk24oLxzZNgp/ZGa7jv828' +
        'Lbsi0SXgkTOWRkXF6rlER7aP9tSvsXk0UF4T2HUe5kayc4329y4p2LjASWA+72BHQ3XUvVK9+VnkJ6Y' +
        'n61PfJ2Ex9h/OWE07CBHpc6p+7Og5ShJOGXZ9L38OGPXQZbEpqIzvkR1qx3aCu307KMQIDAQAB',
      encryptType: 'MD5', ipAddress: '', clientType: 'API', userType: '0',
    }, {});

    // Handle code 2004 (stale session) — unauthorize and retry once
    const code = step2.body?.code ?? step2.body?.data?.code;
    if (code === 2004) {
      await dssRequest('POST', '/brms/api/v1.0/accounts/unauthorize', { userName: DAHUA_USER }, {}).catch(() => {});
      return res.status(409).json({ code: 2004, message: 'Stale session cleared — retry login' });
    }

    const token = step2.body?.token ?? step2.body?.data?.token;
    if (!token) return res.status(502).json({ error: 'login failed', detail: step2.body });

    // Share token with background jobs (avoids dual-session conflict)
    _pollerToken = token;

    // Return ONLY the token — password never leaves the server
    res.json({ token, userName: DAHUA_USER });
  } catch (err) {
    console.error('[Dahua login]', err.message);
    res.status(502).json({ error: 'DSS login error', detail: err.message });
  }
});

// Config probe (username only, never password)
app.get('/api/dahua/config', (_req, res) => {
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

app.get('/api/reports/raw-data', requireAuth, async (req, res) => {
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
      dahuaPersonId: prof.dahuaPersonId || null, isSelf: true, hasPhoto: !!prof.photoUrl,
    }];
    if (condoId && unit) {
      // Solo filtro por condoId (índice de campo único) y afino unidad/rol en memoria,
      // para no requerir un índice compuesto.
      const snap = await firestore.collection('users').where('condoId', '==', condoId).get();
      snap.forEach(d => {
        if (d.id === req.user.uid) return;
        const u = d.data();
        if (!['resident', 'usuario'].includes(u.role)) return;
        if (String(u.unit || '') !== unit) return;
        members.push({
          uid: d.id, name: u.name || u.displayName || 'Integrante',
          dahuaPersonId: u.dahuaPersonId || null, isSelf: false, hasPhoto: !!u.photoUrl,
        });
      });
    }
    res.json({ unit, condoId, members });
  } catch (err) {
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
        subjectUid: m.uid, subjectName: m.name || '', unit: String(prof.unit || ''), condoId,
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consent/ratify — un adulto confirma (o rechaza) su propio consentimiento.
// Público: se accede por un enlace con token de un solo uso.
app.post('/api/consent/ratify', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const firestore = admin.firestore();
  const token = String((req.body || {}).token || '');
  const accept = (req.body || {}).accept !== false;
  if (!token) return res.status(400).json({ error: 'token requerido' });
  try {
    const tokRef = firestore.doc(`ratifyTokens/${token}`);
    const tok = await tokRef.get();
    if (!tok.exists) return res.status(404).json({ error: 'Enlace inválido o ya utilizado' });
    const { condoId, subjectUid, subjectName } = tok.data();
    const now = admin.firestore.Timestamp.now();
    await firestore.doc(`condos/${condoId}/consents/${subjectUid}`).set(
      accept
        ? { ratified: true, basis: 'ratified', ratifiedAt: now }
        : { biometric: false, ratified: true, basis: 'refused', ratifiedAt: now },
      { merge: true },
    );
    await tokRef.delete().catch(() => {});
    res.json({ ok: true, subjectName, accepted: accept });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// POST /api/users/create  { name, email, password, role, condoId, condoName, ...extras }
// Creates a Firebase Auth user + Firestore profile. Requires Firebase Admin.
app.post('/api/users/create', requireAuth, async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { name, email, password, role, condoId, condoName, jobTitle, shift, phone, condoIds, condoScope, unit } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'name, email and password are required' });

  try {
    const userRecord = await admin.auth().createUser({ email, password, displayName: name });
    const profile = Object.assign(
      { name, email, role: role || 'operator', condoId: condoId || '', condoName: condoName || '', status: 'active', createdAt: admin.firestore.Timestamp.now() },
      jobTitle   && { jobTitle },
      shift      && { shift },
      phone      && { phone },
      condoIds   && { condoIds },
      condoScope && { condoScope },
      unit       && { unit },
    );
    await admin.firestore().collection('users').doc(userRecord.uid).set(profile);
    res.json({ uid: userRecord.uid });
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
  try {
    await admin.auth().updateUser(uid, { password });
    res.json({ ok: true });
  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/user-not-found') return res.status(404).json({ error: 'Usuario no encontrado en Firebase Auth' });
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
        email: String(r.email || '').trim(),
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
      expectArrivalTime: String(startTs), expectLeaveTime: String(endTs),
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

// Debug: fetch raw DSS visitor object — use to confirm status field name
// GET /api/debug/visitor/:visitorId
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

// ── Job telemetry (exposed via /api/status) ───────────────────────────────────
const _jobStats = {
  poller:   { lastRun: null, lastError: null, notifsSent: 0 },
  syncRetry: { lastRun: null, lastError: null, synced: 0 },
};

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
async function fetchVisitorAccessedDoors(visitorId, visitorName, startTime, endTime) {
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
        const rows = mapAndFilter(payload.list ?? payload.pageData);
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
        const finalizeExit = async (notifKey) => {
          const upd = { dssStatus: '4', status: 'exited' };
          const doors = await fetchVisitorAccessedDoors(v.dahuaVisitorId, v.visitorName, startTs, nowTs);
          if (doors.length > 0) upd.accessedDoors = doors;
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
        let latestIn = 0, latestOut = 0;
        try {
          const mv = await fetchVisitorMovement([v.dahuaPersonId || v.dahuaVisitorId, v.dahuaPlatePersonId], startTs, nowTs);
          latestIn = mv.latestIn; latestOut = mv.latestOut;
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

        // Salida: el último evento es una salida → finalizar (peatonal o barrera).
        if (latestOut && latestOut >= latestIn) {
          if (prev !== '4') {
            await finalizeExit(prev === '0' ? null : '1:4');
            console.log(`[DSS Poller] ${v.visitorName} salió (access record) → exited`);
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
    expectArrivalTime: String(startTs),
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
async function serverDssCreatePlateVehicle(token, { plateNo, visitorName, orgCode, parkingLotId, entranceGroupId, startTs, endTs }) {
  const plate = normalizePlate(plateNo);
  if (!plate) return null;
  const H = { 'X-Subject-Token': token };
  const personId = String(Math.floor(10000000 + Math.random() * 89999999)); // 8 dígitos

  // 1) Crear persona (registro ACS, separado del de visitas)
  const personBody = {
    baseInfo: { personId, lastName: '', firstName: `VISITA ${visitorName || ''} ${plate}`.trim().slice(0, 60),
      gender: '1', orgCode, orgCodes: [orgCode], email: '', tel: '', remark: 'pase visita (patente)',
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
        entranceLongTerm: '0', entranceStartTime: String(startTs), entranceEndTime: String(endTs) }],
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

// Detecta el ÚLTIMO ingreso y la ÚLTIMA salida del visitante por los access records,
// consultando tanto el personId del visitante como el de la persona-patente (cubre
// ingreso peatonal por QR y vehicular por barrera). Devuelve { latestIn, latestOut }
// (timestamps; 0 si no hay). DSS NO refleja la salida en el visitStatus del módulo de
// visitas, por eso el último evento de acceso es la fuente de verdad del estado.
// Entrada/salida se distingue por el pointName ("Ingreso"/"Salida"); el campo
// direction es poco fiable (suele venir "0" en ambos).
async function fetchVisitorMovement(personIds, startTs, endTs) {
  let latestIn = 0, latestOut = 0;
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
      if (/salida/i.test(pt)) { if (t > latestOut) latestOut = t; }
      else if (/ingreso|entrada/i.test(pt)) { if (t > latestIn) latestIn = t; }
      else {
        // El nombre del punto no dice ingreso/salida (p.ej. "Estacionamiento",
        // barreras ANPR con nombre libre). Usar la dirección del propio registro.
        const dir = String(x.inOutStatus ?? x.direction ?? '').toLowerCase();
        if (dir === '1' || dir === 'out' || dir === 'exit') { if (t > latestOut) latestOut = t; }
        else if (dir === '0' || dir === 'in' || dir === 'enter') { if (t > latestIn) latestIn = t; }
      }
    }
  }
  return { latestIn, latestOut };
}

// Detecta el ÚLTIMO ingreso por barrera ANPR de una PATENTE (log de parking, distinto
// del de access records ACS). Cubre el caso en que la persona-patente no quedó vinculada
// (patente ya existente en DSS = conflicto) y por tanto el ingreso no aparece por personId.
async function fetchPlateEntry(plateNo, parking, startTs, endTs) {
  if (!plateNo || !parking?.entranceGroupId) return 0;
  try {
    const r = await dssAuthed('POST', '/ipms/api/v1.1/entrance/vehicle-enter/record/fetch/page', {
      page: '1', pageSize: '20', currentPage: '1',
      plateNo: normalizePlate(plateNo), personName: '', cardPersonName: '',
      plateNoMatchMode: '1', vehicleBrand: '0', vehicleModel: '0', vehicleColor: '0',
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

// Devuelve {orgCode, parkingLotId, entranceGroupId} para un condo, o null si no tiene
// parking. 1) usa campos explícitos del doc; 2) auto-descubre por orgName y persiste.
async function resolveCondoParking(condoData, condoRef) {
  if (condoData.dahuaParkingOrgCode && condoData.dahuaParkingLotId && condoData.dahuaEntranceGroupId) {
    return { orgCode: condoData.dahuaParkingOrgCode, parkingLotId: condoData.dahuaParkingLotId, entranceGroupId: condoData.dahuaEntranceGroupId };
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
    return hit;
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
            // Other errors: log quietly, will retry next cycle
          }
        }

        // 2) Patente → barrera vehicular (ANPR). Independiente del visitante: registra
        //    la patente en el grupo de parking para que el lector LPR abra la barrera.
        //    Solo si el condominio tiene parking configurado y el pase sigue vigente.
        if (v.licensePlate && parkOrg && parkLot && parkGrp && !v.dahuaPlatePersonId
            && !v.dahuaPlateConflict && v.status !== 'exited' && v.dssStatus !== '4') {
          try {
            const plateRes = await serverDssCreatePlateVehicle(_pollerToken, {
              plateNo: v.licensePlate, visitorName: v.visitorName,
              orgCode: parkOrg, parkingLotId: parkLot, entranceGroupId: parkGrp,
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
            if (err.message?.includes('2003') || err.message?.includes('401')) {
              _pollerToken = null; return;
            }
            console.warn(`[DSS Plate] error patente ${v.licensePlate}:`, err.message);
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
app.get('/api/status', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });

  if (idToken) {
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

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
function killWaSessionChrome(numberId) {
  if (process.platform === 'win32') return;
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
  const { execSync } = require('child_process');
  for (const bin of ['/usr/bin/pkill', '/bin/pkill', 'pkill']) {
    try { execSync(`${bin} -9 -f "[s]ession-${numberId}"`, { stdio: 'ignore' }); break; } catch {}
  }
}

// Borra todos los archivos de lock que Chromium deja en la sesión.
function clearWaSessionLock(numberId) {
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

async function handleWaMessage(numberId, msg) {
  const db = admin.firestore();
  // contactId is the full JID used for sending (e.g. '5491234@c.us' or '54924092141804@lid')
  const contactId = msg.from;
  const contact = await msg.getContact().catch(() => null);
  // For @lid contacts, msg.from is a device ID, not the real phone number.
  // contact.number always gives the real phone number regardless of JID type.
  const contactPhone = contact?.number || msg.from.replace(/@(c\.us|lid)$/, '');
  const waName = contact?.pushname || contact?.name || contactPhone;
  const body = msg.body || '';
  const ts = admin.firestore.Timestamp.fromMillis((msg.timestamp || Date.now() / 1000) * 1000);

  // Enrich with Firestore resident data using normalized phone number
  let contactName = waName;
  let condoName = '';
  let unit = '';
  const normKey = contactPhone.replace(/\D/g, '').slice(-9);
  if (normKey.length >= 8) {
    const possiblePhones = [...new Set([
      contactPhone, `+${contactPhone}`, normKey, `56${normKey}`, `+56${normKey}`,
    ])].slice(0, 10);
    const uSnap = await db.collection('users').where('phone', 'in', possiblePhones).limit(1).get().catch(() => null);
    if (uSnap && !uSnap.empty) {
      const u = uSnap.docs[0].data();
      if (u.displayName) contactName = u.displayName;
      condoName = u.condoName || '';
      unit = u.unit || '';
    }
  }

  // Find or create conversation — match by contactId (exact JID) for accuracy
  const existing = await db.collection('waConversations')
    .where('waNumberId', '==', numberId)
    .where('contactId', '==', contactId)
    .limit(1).get();

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
      contactId, contactName, condoName, unit, lastMessage: body, lastMessageAt: ts,
      unreadCount: admin.firestore.FieldValue.increment(1),
      lastIncomingAt: ts, respondedToLast: false,
    });
  }

  // Store message (detect incoming media)
  const isIncomingMedia = msg.hasMedia || false;
  const waMediaType = msg.type || null; // WA type: 'image','sticker','video','audio','ptt','document'

  let incomingThumb = null;
  let incomingMimeType = isIncomingMedia ? waMediaType : null; // fallback to WA type

  // Download images and stickers for inline display; use media.mimetype (proper MIME type)
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

  await convRef.collection('messages').add({
    body, fromMe: false, senderUserId: null, senderName: null,
    hasMedia:    isIncomingMedia,
    mediaBase64: incomingThumb,
    mediaType:   incomingMimeType,
    timestamp: ts, waMessageId: msg.id?.id || '',
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
}

// ── Seguridad: todos los endpoints de WhatsApp requieren sesión autenticada ────
// Manejan datos personales de contacto (números, conversaciones, envío de mensajes),
// por lo que no pueden quedar abiertos. Se exige token de Firebase en todo /api/wa/*.
// (Los mensajes entrantes llegan por whatsapp-web.js, no por HTTP, así que no hay
//  webhook público que romper.)
app.use('/api/wa', requireAuth);

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
  const { name, assignedUsers } = req.body || {};
  const update = {};
  if (name !== undefined)          update.name = name;
  if (assignedUsers !== undefined) update.assignedUsers = Array.isArray(assignedUsers) ? assignedUsers : [];
  try {
    await admin.firestore().collection('waNumbers').doc(req.params.id).update(update);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/wa/numbers/:id
app.delete('/api/wa/numbers/:id', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
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
  });
});

// POST /api/wa/install-chrome — trigger Chrome download manually
app.post('/api/wa/install-chrome', (_req, res) => {
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
  const id = req.params.id;
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
  if (!loadWaLib()) return res.status(503).json({ error: 'whatsapp-web.js not available — check server dependencies and Chrome installation' });
  const id = req.params.id;
  const doc = await admin.firestore().collection('waNumbers').doc(id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Number not found' });
  const numData = doc.data();
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
  const { body, senderUserId, senderName, mediaBase64, mediaType, mediaFilename } = req.body || {};
  if (!body?.trim() && !mediaBase64) return res.status(400).json({ error: 'body or mediaBase64 is required' });
  try {
    const convDoc = await admin.firestore().collection('waConversations').doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convDoc.data();

    // Validate client is connected
    const clientEntry = _waClients.get(conv.waNumberId);
    if (!clientEntry || clientEntry.status !== 'ready') {
      return res.status(409).json({ error: 'WhatsApp number is not connected' });
    }

    // Validate sender is assigned to this WA number (or is super_admin/condo_admin)
    if (senderUserId) {
      const numDoc = await admin.firestore().collection('waNumbers').doc(conv.waNumberId).get();
      const numData = numDoc.data() || {};
      const isAssigned = (numData.assignedUsers || []).some(u => u.uid === senderUserId);
      if (!isAssigned) {
        const userDoc = await admin.firestore().collection('users').doc(senderUserId).get();
        const role = userDoc.exists ? userDoc.data().role : null;
        if (role !== 'super_admin' && role !== 'condo_admin') {
          return res.status(403).json({ error: 'No tienes permiso para enviar mensajes por este número.' });
        }
      }
    }

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

    const ts = admin.firestore.Timestamp.now();
    await convDoc.ref.collection('messages').add({
      body: body || '',
      fromMe: true,
      hasMedia:    mediaBase64 ? true : false,
      mediaBase64: mediaBase64 || null,
      mediaType:   mediaBase64 ? (mediaType || 'image/jpeg') : null,
      senderUserId: senderUserId || null,
      senderName:   senderName   || null,
      timestamp: ts, waMessageId: '', createdAt: ts,
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
    const ids = snap.docs.map(d => d.id);
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
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────
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
    }, 15_000);
  }
});
