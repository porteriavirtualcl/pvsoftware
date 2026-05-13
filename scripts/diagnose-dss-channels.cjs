/**
 * Diagnose DSS channel mismatch for "Don Alberto" (and all condos).
 *
 * Compares:
 *   - Channel IDs stored in Firestore (condos/{id}.dahuaChannelIds)
 *   - Channel IDs currently returned by DSS Pro (tree/deviceOrg?channelTypes=7)
 *
 * Prints orphaned IDs (in Firestore but not in DSS) per condo, plus the
 * admin's working channels so we can see permission patterns.
 *
 * Run from repo root:  node scripts/diagnose-dss-channels.cjs
 */

'use strict';

require('dotenv').config();
require('dotenv').config({ path: '.env.production', override: false });

const https = require('https');
const http  = require('http');
const crypto = require('crypto');
const admin  = require('firebase-admin');

const DAHUA_HOST = process.env.DAHUA_HOST;
const DAHUA_USER = process.env.DAHUA_USER;
const DAHUA_PASS = process.env.DAHUA_PASS;

if (!DAHUA_HOST || !DAHUA_USER || !DAHUA_PASS) {
  console.error('Missing DAHUA_HOST / DAHUA_USER / DAHUA_PASS in .env');
  process.exit(1);
}

// ── Firebase Admin ────────────────────────────────────────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
} else {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT_B64 in .env.production');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});
const db = admin.firestore();

// ── DSS helpers (lifted from server.cjs) ──────────────────────────────────────
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function buildSignature(u, p, realm, randomKey) {
  const t1 = md5(p);
  const t2 = md5(u + t1);
  const t3 = md5(t2);
  const t4 = md5(`${u}:${realm}:${t3}`);
  return md5(`${t4}:${randomKey}`);
}

function dssRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DAHUA_HOST);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };
    const req = transport.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function dssLogin() {
  const step1 = await dssRequest('POST', '/brms/api/v1.0/accounts/authorize',
    { userName: DAHUA_USER, ipAddress: '', clientType: 'API' }, {});
  const { realm, randomKey } = step1.body;
  if (!realm || !randomKey) throw new Error('step-1 missing realm/randomKey: ' + JSON.stringify(step1.body));

  const signature = buildSignature(DAHUA_USER, DAHUA_PASS, realm, randomKey);
  const step2 = await dssRequest('POST', '/brms/api/v1.0/accounts/authorize', {
    mac: '00:DE:AD:BE:EF:99', signature, userName: DAHUA_USER, randomKey,
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
    console.log('[DSS] code 2004 — unauthorizing stale session then retrying');
    await dssRequest('POST', '/brms/api/v1.0/accounts/unauthorize', { userName: DAHUA_USER }, {}).catch(() => {});
    return dssLogin();
  }

  const token = step2.body?.token ?? step2.body?.data?.token;
  if (!token) throw new Error('DSS login failed: ' + JSON.stringify(step2.body));
  return token;
}

// ── Walk device tree, collecting all access channels ─────────────────────────
function walkChannels(departments, parentPath, out) {
  if (!Array.isArray(departments)) return;
  for (const dept of departments) {
    const orgPath = parentPath ? `${parentPath} / ${dept.name}` : (dept.name ?? '');
    if (Array.isArray(dept.channel)) {
      for (const ch of dept.channel) {
        out.push({ id: String(ch.id), name: ch.name ?? '', orgPath });
      }
    }
    if (Array.isArray(dept.departments)) walkChannels(dept.departments, orgPath, out);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log(`[1/4] DSS login as "${DAHUA_USER}" → ${DAHUA_HOST}`);
    const token = await dssLogin();
    console.log(`      ✅ token obtained: ${token.slice(0, 12)}...`);

    console.log('[2/4] Fetching access channel tree (channelTypes=7) from DSS');
    const r = await dssRequest('GET', '/brms/api/v1.0/tree/deviceOrg?channelTypes=7&sort=&orgCode=',
      null, { 'X-Subject-Token': token });
    if (r.body?.code !== 1000) {
      console.error('      ❌ DSS error: ' + JSON.stringify(r.body));
      process.exit(1);
    }
    const channels = [];
    walkChannels(r.body?.data?.departments ?? [], '', channels);
    const dssIds = new Set(channels.map(c => c.id));
    console.log(`      ✅ ${channels.length} channels in DSS`);
    console.log('      sample:', channels.slice(0, 8).map(c => `${c.id} (${c.name})`).join(', '));

    console.log('[3/4] Listing condos from Firestore');
    const condosSnap = await db.collection('condos').get();
    const condos = condosSnap.docs.map(d => ({
      id: d.id,
      name: d.data().name ?? '(no name)',
      stored: d.data().dahuaChannelIds ?? [],
    }));
    console.log(`      ✅ ${condos.length} condos found`);

    console.log('[4/4] Comparing stored vs DSS-actual per condo');
    console.log('─'.repeat(80));
    let anyOrphans = false;
    for (const c of condos) {
      const orphans = c.stored.filter(id => !dssIds.has(id));
      const valid   = c.stored.filter(id =>  dssIds.has(id));
      const marker = orphans.length === 0
        ? (c.stored.length === 0 ? '⚪ (no channels configured)' : '✅')
        : '❌';
      console.log(`${marker}  ${c.name}  [${c.id}]`);
      console.log(`     stored : ${c.stored.length}   valid : ${valid.length}   orphans : ${orphans.length}`);
      if (orphans.length > 0) {
        anyOrphans = true;
        console.log(`     ORPHANED IDs (not in DSS):`);
        for (const o of orphans) console.log(`       - ${o}`);
      }
    }
    console.log('─'.repeat(80));
    if (!anyOrphans) {
      console.log('All stored channel IDs resolve in DSS — orphan check is clean.');
      console.log('If sync still fails, the issue is likely DSS-side permissions on the API user.');
    }

    console.log('\n--- DSS channel inventory (full) ---');
    for (const ch of channels) console.log(`  ${ch.id}  ${ch.orgPath} :: ${ch.name}`);

    process.exit(0);
  } catch (err) {
    console.error('Fatal:', err.message);
    process.exit(1);
  }
})();
