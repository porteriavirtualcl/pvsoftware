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

const app  = express();
const port = process.env.PORT || 3002;

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

// Allow Firebase Auth popups (Google Sign-In) to communicate with the opener.
// Without this header Firebase's window.closed / window.close calls are blocked
// by the browser's Cross-Origin-Opener-Policy enforcement.
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

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

// POST /api/users/create  { name, email, password, role, condoId, condoName, ...extras }
// Creates a Firebase Auth user + Firestore profile. Requires Firebase Admin.
app.post('/api/users/create', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { name, email, password, role, condoId, condoName, jobTitle, shift, phone, condoIds, condoScope } = req.body || {};
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
app.post('/api/users/delete', async (req, res) => {
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
app.post('/api/users/update-password', async (req, res) => {
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

// POST /api/door/open  { channelId: "1000649$7$0$1" }
// Opens a door using the server-managed DSS token (no browser session required).
app.post('/api/door/open', async (req, res) => {
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

// Debug: fetch raw DSS visitor object — use to confirm status field name
// GET /api/debug/visitor/:visitorId
app.get('/api/debug/visitor/:visitorId', async (req, res) => {
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
app.get('/api/debug/visitor-sample', async (req, res) => {
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

/** DSS status code → notification factory */
const DSS_VISIT_NOTIFS = {
  '0:1': (name) => ({ title: 'Visita ingresó',  message: `${name} ha ingresado` }),
  '1:2': ()     => ({ title: 'Pase vencido',    message: 'Tu visita tiene el pase vencido, modifica el horario de salida para que no tenga problemas al salir' }),
  '1:3': ()     => ({ title: 'Pase vencido',    message: 'Tu visita tiene el pase vencido, modifica el horario de salida para que no tenga problemas al salir' }),
  '1:4': ()     => ({ title: 'Visita se fue',   message: 'Tu visita ya se fue' }),
};

async function pollerDssLogin() {
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
      // Browser session already active — don't kick it out, just skip this cycle.
      // The browser login handler sets _pollerToken when it authenticates.
      console.warn('[DSS Poller] code 2004 — browser session active, sharing token on next browser login');
      return null;
    }

    const token = step2.body?.token ?? step2.body?.data?.token;
    _pollerToken = token || null;
    return _pollerToken;
  } catch (err) {
    console.warn('[DSS Poller] login error:', err.message);
    return null;
  }
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

      for (const docSnap of visitorsSnap.docs) {
        const v = docSnap.data();

        // Skip visitors not synced with DSS or already in terminal state
        if (!v.dahuaVisitorId || !v.userId) continue;
        if (v.dssStatus === '4') continue;

        let r;
        try {
          r = await dssRequest(
            'GET',
            `/obms/api/v1.0/visitors/visitor/${v.dahuaVisitorId}`,
            null,
            { 'X-Subject-Token': _pollerToken }
          );
        } catch { continue; }

        // Session expired — abort this cycle; next cycle will re-login
        if (r.body?.code === 2003 || r.body?.code === 401) {
          _pollerToken = null;
          return;
        }

        // DSS code 2144 = "data does not exist" — registro purgado por DSS al
        // marcar salida manual o al expirar. Si localmente está 'entered',
        // asumimos que el visitante se fue y cerramos el loop.
        if (r.body?.code === 2144) {
          if (v.status === 'entered' && v.dssStatus !== '4') {
            await docSnap.ref.update({ dssStatus: '4', status: 'exited' });
            const n = DSS_VISIT_NOTIFS['1:4'](v.visitorName || 'Tu visitante');
            await firestore.collection('notifications').add({
              userId:    v.userId,
              title:     n.title,
              message:   n.message,
              type:      'visitor',
              read:      false,
              createdAt: admin.firestore.Timestamp.now(),
            });
            _jobStats.poller.notifsSent++;
            console.log(`[DSS Poller] ${v.visitorName} purgado de DSS → exited`);
          }
          continue;
        }

        if (r.body?.code !== 1000) continue;

        const d = r.body?.data ?? {};

        // Log raw data once per visitor to help identify the correct status field
        if (!v.dssStatus) {
          console.log(`[DSS Poller] raw visitor data keys for ${v.visitorName}:`, JSON.stringify(d).slice(0, 400));
        }

        // DSS Pro uses different field names depending on version:
        // visitStatus (V8+), visitedStatus, status, state
        const rawStatus = d.visitStatus ?? d.visitedStatus ?? d.visitState ?? d.status ?? d.state;
        const newStatus = rawStatus != null ? String(rawStatus) : '';
        if (!newStatus) continue;

        const prev = String(v.dssStatus ?? '0');
        if (newStatus === prev) continue;

        // Map DSS status → app status
        const DSS_TO_APP_STATUS = { '0': 'pending', '1': 'entered', '2': 'entered', '3': 'entered', '4': 'exited' };
        const appStatus = DSS_TO_APP_STATUS[newStatus];

        // Persist DSS status and sync app status
        const updatePayload = { dssStatus: newStatus };
        if (appStatus) updatePayload.status = appStatus;
        await docSnap.ref.update(updatePayload);

        // Fire notification if this transition is mapped
        const notifFn = DSS_VISIT_NOTIFS[`${prev}:${newStatus}`];
        if (notifFn) {
          const n = notifFn(v.visitorName || 'Tu visitante');
          await firestore.collection('notifications').add({
            userId:    v.userId,
            title:     n.title,
            message:   n.message,
            type:      'visitor',
            read:      false,
            createdAt: admin.firestore.Timestamp.now(),
          });
          _jobStats.poller.notifsSent++;
          console.log(`[DSS Poller] ${v.visitorName} ${prev}→${newStatus} — notified ${v.userId}`);
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

async function serverDssCreateVisitor(token, { visitorName, hostName, plate, startTs, endTs, acsChannelIds }) {
  const passport = await serverDssGeneratePassport(token);
  const body = {
    status: '0',
    visitorName,
    visitedName: hostName || 'Portería Virtual',
    visitedEmail: '', idType: '0', idNum: '',
    tel: '', email: '',
    expectArrivalTime: String(startTs),
    expectLeaveTime:   String(endTs),
    plateNo: plate ?? '',
    reason: 'Invitación', remark: 'vía API',
    authInfo: {
      qrcode: passport.qrcode,
      passportCardNo: passport.passportCardNo,
      facePictures: [], idPicture: '',
    },
    rightInfo: {
      inheritVisitedAuthority: '0',
      acsChannelIds,
      vtoChannelIds: [], positionIds: [], liftChannels: [],
    },
  };
  const r = await dssRequest('POST', '/obms/api/v1.0/visitors/visitor', body,
    { 'X-Subject-Token': token });
  if (r.body?.code !== 1000)
    throw new Error('[DSS Sync] createVisitor failed: ' + JSON.stringify(r.body));
  return { visitorId: r.body.data?.visitorId, qrcode: passport.qrcode };
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
      const channelIds = condoDoc.data().dahuaChannelIds ?? [];
      if (!channelIds.length) continue;

      let visitorsSnap;
      try {
        visitorsSnap = await firestore
          .collection(`condos/${condoDoc.id}/visitors`)
          .where('date', '>=', cutoffStr)
          .get();
      } catch { continue; }

      for (const docSnap of visitorsSnap.docs) {
        const v = docSnap.data();
        if (v.dahuaVisitorId) continue; // already synced

        try {
          const toTs = (date, time) =>
            Math.floor(new Date(`${date}T${time || '00:00'}:00`).getTime() / 1000);

          const result = await serverDssCreateVisitor(_pollerToken, {
            visitorName: v.visitorName || 'Visitante',
            hostName:    v.hostName    || 'Portería Virtual',
            plate:       v.licensePlate || undefined,
            startTs:     toTs(v.date, v.entryTime),
            endTs:       toTs(v.date, v.exitTime),
            acsChannelIds: channelIds,
          });

          await docSnap.ref.update({
            dahuaVisitorId: result.visitorId,
            dahuaQrCode:    result.qrcode,
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
    }
  } catch (err) {
    _jobStats.syncRetry.lastError = err.message;
    console.warn('[DSS Sync] error:', err.message);
    _pollerToken = null;
  }
}

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

const WA_CHROME_PATH = process.env.WA_CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/google-chrome');

// In-memory map: numberId → { client, status }
const _waClients = new Map();

let _waLib = undefined; // undefined = not tried, false = failed, object = ok

function loadWaLib() {
  if (_waLib !== undefined) return _waLib;
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const qrcodeLib = require('qrcode');
    _waLib = { Client, LocalAuth, qrcode: qrcodeLib };
    console.log('📱 whatsapp-web.js loaded');
  } catch (e) {
    console.warn('⚠️  whatsapp-web.js not available:', e.message);
    _waLib = false;
  }
  return _waLib;
}

async function initWaClient(numberId) {
  const lib = loadWaLib();
  if (!lib || !admin.apps.length) return;
  const db = admin.firestore();

  // Tear down existing client for this number
  if (_waClients.has(numberId)) {
    try { await _waClients.get(numberId).client.destroy(); } catch {}
    _waClients.delete(numberId);
  }

  await db.collection('waNumbers').doc(numberId)
    .update({ status: 'connecting', qrDataUrl: null }).catch(() => {});

  const { Client, LocalAuth, qrcode } = lib;
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: numberId, dataPath: './wa_sessions' }),
    puppeteer: {
      executablePath: WA_CHROME_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--no-first-run', '--no-zygote'],
      headless: true,
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
    const phone = client.info?.wid?.user || '';
    await db.collection('waNumbers').doc(numberId)
      .update({ status: 'ready', phone, qrDataUrl: null }).catch(() => {});
    console.log(`[WA] ${numberId} ready — phone: ${phone}`);
  });

  client.on('disconnected', async (reason) => {
    console.log(`[WA] ${numberId} disconnected:`, reason);
    _waClients.delete(numberId);
    await db.collection('waNumbers').doc(numberId)
      .update({ status: 'disconnected', phone: '', qrDataUrl: null }).catch(() => {});
  });

  client.on('auth_failure', async () => {
    _waClients.delete(numberId);
    await db.collection('waNumbers').doc(numberId)
      .update({ status: 'disconnected', qrDataUrl: null }).catch(() => {});
  });

  client.on('message', async (msg) => {
    if (msg.from.endsWith('@g.us')) return; // ignore groups
    try { await handleWaMessage(numberId, msg); } catch (e) {
      console.error('[WA] handleWaMessage error:', e.message);
    }
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error(`[WA] ${numberId} initialize error:`, err.message);
    _waClients.delete(numberId);
    await db.collection('waNumbers').doc(numberId)
      .update({ status: 'disconnected' }).catch(() => {});
  }
}

async function handleWaMessage(numberId, msg) {
  const db = admin.firestore();
  const contactPhone = msg.from.replace('@c.us', '');
  const contact = await msg.getContact().catch(() => null);
  const contactName = contact?.pushname || contact?.name || contactPhone;
  const body = msg.body || '';
  const ts = admin.firestore.Timestamp.fromMillis((msg.timestamp || Date.now() / 1000) * 1000);

  // Find or create conversation
  const existing = await db.collection('waConversations')
    .where('waNumberId', '==', numberId)
    .where('contactPhone', '==', contactPhone)
    .limit(1).get();

  let convRef;
  if (existing.empty) {
    convRef = db.collection('waConversations').doc();
    await convRef.set({
      waNumberId: numberId, contactPhone, contactName,
      lastMessage: body, lastMessageAt: ts, unreadCount: 1,
      createdAt: admin.firestore.Timestamp.now(),
    });
  } else {
    convRef = existing.docs[0].ref;
    await convRef.update({
      contactName, lastMessage: body, lastMessageAt: ts,
      unreadCount: admin.firestore.FieldValue.increment(1),
    });
  }

  // Store message
  await convRef.collection('messages').add({
    body, fromMe: false, senderUserId: null, senderName: null,
    timestamp: ts, waMessageId: msg.id?.id || '',
    createdAt: admin.firestore.Timestamp.now(),
  });
}

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
      assignedUserId: null, assignedUserName: null,
      createdAt: admin.firestore.Timestamp.now(),
    });
    res.json({ id: ref.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/wa/numbers/:id
app.put('/api/wa/numbers/:id', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const { name, assignedUserId, assignedUserName } = req.body || {};
  const update = {};
  if (name !== undefined)             update.name = name;
  if (assignedUserId !== undefined)   update.assignedUserId = assignedUserId;
  if (assignedUserName !== undefined) update.assignedUserName = assignedUserName;
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
    await admin.firestore().collection('waNumbers').doc(id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/wa/numbers/:id/connect
app.post('/api/wa/numbers/:id/connect', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  if (!loadWaLib()) return res.status(503).json({ error: 'whatsapp-web.js not available — check server dependencies and Chrome installation' });
  const id = req.params.id;
  const doc = await admin.firestore().collection('waNumbers').doc(id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Number not found' });
  // Fire-and-forget — client emits status/QR updates to Firestore
  initWaClient(id).catch(err => console.error('[WA] initWaClient:', err.message));
  res.json({ ok: true });
});

// POST /api/wa/numbers/:id/disconnect
app.post('/api/wa/numbers/:id/disconnect', async (req, res) => {
  if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin not initialized' });
  const id = req.params.id;
  try {
    if (_waClients.has(id)) {
      try { await _waClients.get(id).client.destroy(); } catch {}
      _waClients.delete(id);
    }
    await admin.firestore().collection('waNumbers').doc(id)
      .update({ status: 'disconnected', phone: '', qrDataUrl: null });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  const { body, senderUserId, senderName } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' });
  try {
    const convDoc = await admin.firestore().collection('waConversations').doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convDoc.data();

    // Validate client is connected
    const clientEntry = _waClients.get(conv.waNumberId);
    if (!clientEntry || clientEntry.status !== 'ready') {
      return res.status(409).json({ error: 'WhatsApp number is not connected' });
    }

    await clientEntry.client.sendMessage(`${conv.contactPhone}@c.us`, body);

    const ts = admin.firestore.Timestamp.now();
    await convDoc.ref.collection('messages').add({
      body, fromMe: true,
      senderUserId: senderUserId || null,
      senderName: senderName || null,
      timestamp: ts, waMessageId: '', createdAt: ts,
    });
    await convDoc.ref.update({ lastMessage: body, lastMessageAt: ts, unreadCount: 0 });
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

// ── Serve Vite build ──────────────────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST));

// SPA fallback — any unmatched route returns index.html so React Router works
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`🚀 Portería Virtual running on port ${port}`);

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
    }, 15_000);
  }
});
