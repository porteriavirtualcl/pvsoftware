/// <reference types="vite/client" />
/**
 * DahuaService — Singleton client for Dahua DSS Pro V8.5 REST API.
 *
 * ── How credentials work by environment ──────────────────────────────────────
 *
 *   LOCAL DEV  (npm run dev)
 *     • Vite proxies /dahua/ → VITE_DAHUA_HOST.
 *     • Login is performed client-side using VITE_DAHUA_USER / VITE_DAHUA_PASS
 *       from .env.local (gitignored). Credentials are in the bundle but only
 *       reachable by you on localhost.
 *
 *   PRODUCTION  (npm start — Express serves dist/)
 *     • import.meta.env.PROD === true
 *     • Login is performed by calling POST /api/dahua/login (server endpoint).
 *       The server uses DAHUA_USER / DAHUA_PASS env vars and returns only the
 *       token. The password is NEVER sent to the browser or included in the
 *       built bundle.
 *     • All subsequent /dahua/* calls are proxied by server.cjs and carry the
 *       token via X-Subject-Token header.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import CryptoJS from 'crypto-js';

const IS_PROD = import.meta.env.PROD === true;

// Dev-only credentials (empty strings in prod build — Vite strips undefined VITE_* vars)
const DEV_USER = (import.meta.env.VITE_DAHUA_USER as string) ?? '';
const DEV_PASS = (import.meta.env.VITE_DAHUA_PASS as string) ?? '';

// All requests go to /dahua/ — Vite proxy (dev) or Express proxy (prod) handles forwarding
const BASE_URL = '/dahua';

// ─── types ────────────────────────────────────────────────────────────────────

export interface DahuaChannel {
  id: string;
  orgName: string;
}

export interface DahuaPerson {
  /** DSS internal person ID (personId field from /obms/api/v1.1/acs/person/page) */
  id: string;
  personCode: string;
  personName: string;
  orgCode: string;
  orgName: string;
  gender?: string;
  phoneNum?: string;
  email?: string;
  plateNos?: string[];
  /**
   * Non-empty when the person has at least one access group with ACS channels configured.
   * Used to detect QR-capable persons.
   */
  accessGroupIds?: string[];
  /** Raw access group list from DSS (v1.1 API) */
  accessGroups?: Array<{ id?: string; name?: string }>;
  /** Legacy v1.0 field kept for back-compat */
  doorAuthInfo?: {
    acsChannelIds?: string[];
  };
}

export interface DahuaPassport {
  qrcode: string;
  passportCardNo: string;
}

export interface DahuaVisitorResult {
  visitorId: string;
  personId: string;
  qrcode: string;
}

interface CreateVisitorParams {
  visitorName: string;
  phone?: string;
  plate?: string;
  startTs: number;
  endTs: number;
  acsChannelIds: string[];
  passport?: DahuaPassport;
}

// ─── helpers (dev login only) ─────────────────────────────────────────────────

function md5(str: string): string {
  return CryptoJS.MD5(str).toString(CryptoJS.enc.Hex);
}

function buildSignature(username: string, password: string, realm: string, randomKey: string): string {
  const t1 = md5(password);
  const t2 = md5(username + t1);
  const t3 = md5(t2);
  const t4 = md5(`${username}:${realm}:${t3}`);
  return md5(`${t4}:${randomKey}`);
}

// ─── singleton state ──────────────────────────────────────────────────────────

let _token: string | null = null;
let _keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let _updateTokenTimer: ReturnType<typeof setInterval> | null = null;
let _loginPromise: Promise<string> | null = null;

// ─── low-level fetch ──────────────────────────────────────────────────────────

async function _request(
  method: string,
  path: string,
  body: object | null = null,
  { skipAuth = false } = {}
): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!skipAuth && _token) headers['X-Subject-Token'] = _token;

  const opts: RequestInit = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);

  // Step-1 login intentionally returns 401 — documented in DSS manual
  if (!res.ok && !(res.status === 401 && path.includes('authorize') && skipAuth)) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
  }

  return res.json();
}

// ─── timers ───────────────────────────────────────────────────────────────────

function _stopTimers() {
  if (_keepaliveTimer)   { clearInterval(_keepaliveTimer);   _keepaliveTimer   = null; }
  if (_updateTokenTimer) { clearInterval(_updateTokenTimer); _updateTokenTimer = null; }
}

function _startTimers() {
  _stopTimers();

  // Keepalive every 20 s
  _keepaliveTimer = setInterval(async () => {
    if (!_token) return;
    try {
      const data = await _request('PUT', '/brms/api/v1.0/accounts/keepalive', { token: _token });
      if (data?.code === 2003 || data?.code === 401) {
        console.warn('[Dahua] keepalive expired — clearing session');
        _token = null;
        _stopTimers();
      }
    } catch (err) {
      console.warn('[Dahua] keepalive error:', (err as Error).message);
    }
  }, 20_000);

  // Token refresh every 20 min
  _updateTokenTimer = setInterval(async () => {
    if (!_token) return;
    try {
      const data = await _request('POST', '/brms/api/v1.0/accounts/updateToken', { token: _token });
      if (data?.data?.token) _token = data.data.token;
      else if (data?.token)  _token = data.token;
    } catch (err) {
      console.warn('[Dahua] updateToken error:', (err as Error).message);
    }
  }, 20 * 60_000);
}

// ─── login ────────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
  if (_token) return _token;
  if (_loginPromise) return _loginPromise;

  _loginPromise = (IS_PROD ? _prodLogin() : _devLogin()).finally(() => { _loginPromise = null; });
  return _loginPromise;
}

/**
 * PRODUCTION login — delegates to the Express server endpoint.
 * The password never leaves the server; we only receive the token.
 */
async function _prodLogin(isRetry = false): Promise<string> {
  const res = await fetch('/api/dahua/login', { method: 'POST' });
  const data = await res.json();

  if (data?.code === 2004) {
    if (isRetry) throw new Error('[Dahua] code 2004 persists — enable multi-client in DSS Pro for this user');
    console.warn('[Dahua] code 2004 from server — retrying');
    return _prodLogin(true);
  }

  if (!data?.token) throw new Error('[Dahua] prod login failed: ' + JSON.stringify(data));

  _token = data.token;
  _startTimers();
  window.addEventListener('beforeunload', logout, { once: true });
  return _token;
}

/**
 * DEV login — performs the full MD5 two-step directly in the browser.
 * Uses VITE_DAHUA_USER / VITE_DAHUA_PASS from .env.local (gitignored).
 */
async function _devLogin(isRetry = false): Promise<string> {
  // Step 1 — 401 is expected and documented
  const step1 = await _request(
    'POST',
    '/brms/api/v1.0/accounts/authorize',
    { userName: DEV_USER, ipAddress: '', clientType: 'API' },
    { skipAuth: true }
  );

  const { realm, randomKey } = step1;
  if (!realm || !randomKey) {
    throw new Error('[Dahua] step-1 missing realm/randomKey: ' + JSON.stringify(step1));
  }

  // Step 2
  const signature = buildSignature(DEV_USER, DEV_PASS, realm, randomKey);
  const step2 = await _request(
    'POST',
    '/brms/api/v1.0/accounts/authorize',
    {
      mac: '00:DE:AD:BE:EF:01', signature, userName: DEV_USER, randomKey,
      publicKey:
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4LwTBkqEyS0qpahbp5HlSc+tttuJUuPftmMo' +
        '+QSSsZ+fbNou3W/fFzyPhcCbInIXp1UxGr2qwbkfSd7GPUKO36QpFSHDKJHenjedEWTfaZsCltmjMKtx' +
        '2j5M/L+Ij2T31t2XNITlo22TFdWMNyUHFMTEvi6hXFsWlPBr7yTrACGrgDk24oLxzZNgp/ZGa7jv828' +
        'Lbsi0SXgkTOWRkXF6rlER7aP9tSvsXk0UF4T2HUe5kayc4329y4p2LjASWA+72BHQ3XUvVK9+VnkJ6Y' +
        'n61PfJ2Ex9h/OWE07CBHpc6p+7Og5ShJOGXZ9L38OGPXQZbEpqIzvkR1qx3aCu307KMQIDAQAB',
      encryptType: 'MD5', ipAddress: '', clientType: 'API', userType: '0',
    },
    { skipAuth: true }
  );

  const code = step2?.code ?? step2?.data?.code;
  if (code === 2004) {
    if (isRetry) throw new Error('[Dahua] code 2004 persists — enable multi-client in DSS Pro');
    console.warn('[Dahua] code 2004 — unauthorizing stale session');
    await _request('POST', '/brms/api/v1.0/accounts/unauthorize', { userName: DEV_USER }, { skipAuth: true }).catch(() => {});
    return _devLogin(true);
  }

  const token: string = step2?.token ?? step2?.data?.token;
  if (!token) throw new Error('[Dahua] dev login failed: ' + JSON.stringify(step2));

  _token = token;
  _startTimers();
  window.addEventListener('beforeunload', logout, { once: true });
  return _token;
}

// ─── logout ───────────────────────────────────────────────────────────────────

async function logout(): Promise<void> {
  _stopTimers();
  if (!_token) return;
  _token = null;
  await _request('POST', '/brms/api/v1.0/accounts/unauthorize', { userName: DEV_USER || 'api' }).catch(() => {});
}

// ─── persons (residents from DSS "Información de Personas y Vehículos") ──────

/**
 * Fetches all persons from Dahua DSS Pro V8.5 with auto-pagination.
 *
 * Endpoint: GET /obms/api/v1.1/acs/person/page (from official Postman collection)
 *
 * QR-capability detection: a person is QR-capable when they have at least one
 * access group configured (accessGroups / accessGroupIds non-empty).
 */
async function listPersons(maxCount = 1000): Promise<{ list: DahuaPerson[]; total: number }> {
  await login();
  const PAGE_SIZE = 20;
  let page = 1;
  const all: DahuaPerson[] = [];
  let total = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      orgCode: '001',
      keyword: '',
      containChild: '1',
      accessGroupId: '',
      personId: '',
      liftGroupId: '',
      cardNo: '',
      personName: '',
    }).toString();

    const data = await _request('GET', `/obms/api/v1.1/acs/person/page?${qs}`, null);
    if (data?.code !== 1000) {
      throw new Error('[Dahua] listPersons failed: ' + JSON.stringify(data));
    }

    const payload   = data?.data ?? data;
    // DSS returns list under different keys depending on version
    const pageData: any[] = payload?.list ?? payload?.pageData ?? [];
    total = payload?.total ?? payload?.totalCount ?? pageData.length;

    // Normalise each raw person into our DahuaPerson shape
    for (const raw of pageData) {
      const person: DahuaPerson = {
        id:          raw.personId ?? raw.id ?? '',
        personCode:  raw.personCode ?? '',
        personName:  raw.personName ?? raw.name ?? '',
        orgCode:     raw.orgCode ?? '',
        orgName:     raw.orgName ?? '',
        gender:      raw.gender,
        phoneNum:    raw.phoneNum ?? raw.phone ?? raw.tel,
        email:       raw.email,
        plateNos:    raw.plateNos ?? raw.plateNoList ?? [],
        accessGroups: raw.accessGroups ?? raw.accessGroupList ?? [],
        accessGroupIds: (raw.accessGroupIds ?? raw.accessGroups ?? raw.accessGroupList ?? [])
          .map((g: any) => (typeof g === 'string' ? g : (g?.id ?? ''))).filter(Boolean),
      };
      all.push(person);
    }

    if (all.length >= total || all.length >= maxCount || pageData.length < PAGE_SIZE) break;
    page++;
  }

  return { list: all, total };
}

// ─── channels ─────────────────────────────────────────────────────────────────

async function listAccessChannels(): Promise<DahuaChannel[]> {
  await login();
  const data = await _request('GET', '/brms/api/v1.0/tree/deviceOrg?channelTypes=7&sort=&orgCode=');
  if (data?.code !== 1000) throw new Error('[Dahua] listAccessChannels failed: ' + JSON.stringify(data));

  const channels: DahuaChannel[] = [];
  function walk(departments: any[], parentPath: string) {
    if (!Array.isArray(departments)) return;
    for (const dept of departments) {
      const orgPath = parentPath ? `${parentPath} / ${dept.name}` : (dept.name ?? '');
      if (Array.isArray(dept.channel)) {
        for (const ch of dept.channel) channels.push({ id: ch.id, orgName: orgPath });
      }
      if (Array.isArray(dept.departments)) walk(dept.departments, orgPath);
    }
  }
  walk(data?.data?.departments ?? [], '');
  return channels;
}

// ─── passport ─────────────────────────────────────────────────────────────────

async function generatePassport(): Promise<DahuaPassport> {
  await login();
  const data = await _request('GET', '/obms/api/v1.0/visitors/visitor/passport/generate');
  if (data?.code !== 1000 || !data?.data?.qrcode) {
    throw new Error('[Dahua] generatePassport failed: ' + JSON.stringify(data));
  }
  return { qrcode: data.data.qrcode, passportCardNo: data.data.passportCardNo };
}

// ─── visitor CRUD ─────────────────────────────────────────────────────────────

async function createVisitor(params: CreateVisitorParams): Promise<DahuaVisitorResult> {
  await login();
  const { visitorName, phone, plate, startTs, endTs, acsChannelIds, passport } = params;

  if (!acsChannelIds.length) throw new Error('[Dahua] acsChannelIds must not be empty (code 144025)');

  const pass = passport ?? (await generatePassport());

  // For status='0' (appointment): do NOT send arrivalTime/leaveTime.
  // DSS rejects them with code 1004 — only expectArrivalTime/expectLeaveTime allowed.
  const body = {
    status: '0',
    visitorName,
    visitedName: 'Portería Virtual',
    visitedEmail: '',
    idType: '0',
    idNum: '',
    tel: phone ?? '',
    email: '',
    expectArrivalTime: String(startTs),
    expectLeaveTime: String(endTs),
    plateNo: plate ?? '',
    reason: 'Invitación',
    remark: 'vía API',
    authInfo: {
      qrcode: pass.qrcode,
      passportCardNo: pass.passportCardNo,
      facePictures: [],
      idPicture: '',
    },
    rightInfo: {
      inheritVisitedAuthority: '0',
      acsChannelIds,
      vtoChannelIds: [],
      positionIds: [],
      liftChannels: [],
    },
  };

  const data = await _request('POST', '/obms/api/v1.0/visitors/visitor', body);
  if (data?.code !== 1000) throw new Error('[Dahua] createVisitor failed: ' + JSON.stringify(data));

  const { visitorId, personId } = data.data ?? {};
  let qrcode: string = pass.qrcode;
  if (!qrcode && visitorId) {
    const detail = await getVisitor(visitorId);
    qrcode = detail?.authInfo?.qrcode ?? '';
  }
  return { visitorId, personId, qrcode };
}

async function getVisitor(visitorId: string): Promise<any> {
  await login();
  const data = await _request('GET', `/obms/api/v1.0/visitors/visitor/${visitorId}`);
  if (data?.code !== 1000) throw new Error('[Dahua] getVisitor failed: ' + JSON.stringify(data));
  return data.data;
}

async function deleteVisitor(visitorId: string): Promise<void> {
  await login();
  const data = await _request('DELETE', `/obms/api/v1.0/visitors/visitor/${visitorId}`);
  // code 1000 = success; code 1007 = not found (already deleted) — both are acceptable
  if (data?.code !== 1000 && data?.code !== 1007) {
    throw new Error('[Dahua] deleteVisitor failed: ' + JSON.stringify(data));
  }
}

// ─── exported singleton ───────────────────────────────────────────────────────

const DahuaService = {
  login,
  logout,
  listPersons,
  listAccessChannels,
  generatePassport,
  createVisitor,
  getVisitor,
  deleteVisitor,
  get token() { return _token; },
};

export default DahuaService;
