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
import { api } from '../lib/apiBase';

const IS_PROD = import.meta.env.PROD === true;

// Dev-only credentials (empty strings in prod build — Vite strips undefined VITE_* vars)
const DEV_USER = (import.meta.env.VITE_DAHUA_USER as string) ?? '';
const DEV_PASS = (import.meta.env.VITE_DAHUA_PASS as string) ?? '';

// All requests go to /dahua/ — Vite proxy (dev) or Express proxy (prod) handles forwarding.
// On Capacitor builds, api() prepends VITE_API_BASE_URL so the device hits Hostinger directly.
const BASE_URL = api('/dahua');

// ─── types ────────────────────────────────────────────────────────────────────

export interface DahuaChannel {
  id: string;
  orgName: string;
}

/** Person group from DSS Pro — maps 1-to-1 to a Condominio in this app.
 *  Group names often encode both condo and unit: "Torre Norte - 101" or "Edificio A/B-205".
 *  baseName = condo portion; unitNo = unit/room portion (if present in the name). */
export interface DahuaPersonGroup {
  id: string;
  /** Full group name as stored in DSS */
  name: string;
  /** Condo portion of the name (everything before the separator + unit) */
  baseName: string;
  /** Room/unit extracted from the group name, if any (e.g. "101", "B-205") */
  unitNo?: string;
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
  /** Room / apartment number as configured in DSS (Room No field) */
  roomNo?: string;
  /** Primary access group ID (used for condo mapping) */
  accessGroupId?: string;
  /**
   * Non-empty when the person has at least one access group configured.
   * Used to detect QR-capable persons.
   */
  accessGroupIds?: string[];
  /** Raw access group objects from DSS (v1.1 API) */
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
  hostName?: string;
  phone?: string;
  plate?: string;
  startTs: number;
  endTs: number;
  acsChannelIds: string[];
  passport?: DahuaPassport;
}

export interface CreatePersonParams {
  firstName: string;
  lastName?: string;
  orgCode?: string;
  tel?: string;
  email?: string;
  unit?: string;
  plates?: string[];
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
  { skipAuth = false }: { skipAuth?: boolean } = {}
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
  const res = await fetch(api('/api/dahua/login'), { method: 'POST' });
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

    // Normalise each raw person into our DahuaPerson shape.
    // DSS Pro V8.5 /obms/api/v1.1/acs/person/page wraps fields under baseInfo/extensionInfo/etc.
    for (const raw of pageData) {
      const base = raw.baseInfo ?? raw;                  // v1.1 nests under baseInfo; v1.0 is flat
      const ext  = raw.extensionInfo ?? {};
      const res  = raw.residentInfo  ?? {};
      const entr = raw.entranceInfo  ?? {};

      // Name: v1.1 uses firstName+lastName; v1.0 / flat uses personName
      const firstName = (base.firstName ?? '').trim();
      const lastName  = (base.lastName  ?? '').trim();
      const fullName  = lastName ? `${firstName} ${lastName}`.trim() : (firstName || raw.personName || raw.name || '');

      // Access groups — may be in accessGroupList or accessGroupInfoList
      const rawGroups: any[] = raw.accessGroups ?? raw.accessGroupList ?? raw.accessGroupInfoList ?? [];
      const groupIds: string[] = [
        ...(raw.accessGroupId  ? [String(raw.accessGroupId)]  : []),
        ...(base.accessGroupId ? [String(base.accessGroupId)] : []),
        ...rawGroups.map((g: any) => (typeof g === 'string' ? g : String(g?.id ?? g?.accessGroupId ?? ''))).filter(Boolean),
        ...(Array.isArray(raw.accessGroupIds) ? raw.accessGroupIds.map(String) : []),
      ].filter((v, i, arr) => v && arr.indexOf(v) === i);

      // Plates from entranceInfo.vehicles or top-level
      const plates: string[] = [
        ...(raw.plateNos ?? raw.plateNoList ?? []),
        ...((entr.vehicles ?? []) as any[]).map((v: any) => v.plateNo ?? v.plate ?? '').filter(Boolean),
      ].filter((v, i, arr) => v && arr.indexOf(v) === i);

      // Room No: try personCode, then residentInfo.sipId, then userDefineFields 'Room No'
      const userRoomField = (raw.userDefineFields ?? []).find(
        (f: any) => /room|unit|casa|depto/i.test(f.name ?? f.fieldName ?? '')
      );
      const roomNo = raw.roomNo ?? base.roomNo ?? (res.sipId || userRoomField?.value || raw.personCode || base.personCode || undefined);

      const person: DahuaPerson = {
        id:            String(base.personId ?? raw.personId ?? raw.id ?? ''),
        personCode:    String(base.personCode ?? raw.personCode ?? ''),
        personName:    fullName,
        orgCode:       String(base.orgCode ?? raw.orgCode ?? ''),
        orgName:       String(base.orgName ?? raw.orgName ?? ''),
        gender:        base.gender ?? raw.gender,
        phoneNum:      base.tel ?? base.phoneNum ?? raw.phoneNum ?? raw.phone,
        email:         base.email ?? raw.email,
        roomNo:        roomNo ? String(roomNo) : undefined,
        plateNos:      plates,
        accessGroups:  rawGroups,
        accessGroupId: groupIds[0],
        accessGroupIds: groupIds,
      };
      all.push(person);
    }

    if (all.length >= total || all.length >= maxCount || pageData.length < PAGE_SIZE) break;
    page++;
  }

  return { list: all, total };
}

// ─── person groups (each group = one Condominio) ─────────────────────────────

async function listPersonGroups(): Promise<DahuaPersonGroup[]> {
  await login();
  const data = await _request('GET', '/obms/api/v1.1/acs/person-group/list', null);
  if (data?.code !== 1000) throw new Error('[Dahua] listPersonGroups failed: ' + JSON.stringify(data));
  const list: any[] = data?.data ?? [];
  // Separators that DSS operators commonly use: " - ", " / ", " | ", "_"
  // Pattern: "Condo Name - 101"  →  baseName="Condo Name", unitNo="101"
  const UNIT_PATTERN = /^(.+?)\s*[-\/|_]\s*([A-Za-z]?\d[\w-]*)$/;
  return list.map((g: any) => {
    const id   = String(g.id   ?? g.groupId   ?? g.accessGroupId ?? '');
    const name = String(g.name ?? g.groupName ?? g.accessGroupName ?? '');
    const match = UNIT_PATTERN.exec(name);
    return match
      ? { id, name, baseName: match[1].trim(), unitNo: match[2].trim() }
      : { id, name, baseName: name };
  }).filter(g => g.id);
}

// ─── person CRUD ─────────────────────────────────────────────────────────────

/**
 * Creates a new person in DSS Pro.
 * Returns the new DSS personId on success.
 */
async function createPerson(params: CreatePersonParams): Promise<string> {
  await login();
  const { firstName, lastName = '', orgCode = '001', tel = '', email = '', unit = '', plates = [] } = params;
  const body = {
    baseInfo: {
      firstName,
      lastName,
      orgCode,
      orgCodes: [orgCode],
      tel,
      email,
      source: '0',
      facePictures: [],
    },
    residentInfo: { sipId: unit, houseHolder: '0' },
    entranceInfo: { vehicles: plates.map(p => ({ plateNo: p })) },
  };
  const data = await _request('POST', '/obms/api/v1.1/acs/person', body);
  if (data?.code !== 1000) throw new Error('[Dahua] createPerson failed: ' + JSON.stringify(data));
  return String(data.data?.personId ?? '');
}

/**
 * Searches DSS for persons matching the given name (keyword search).
 * Used for duplicate detection before creating a new person.
 */
async function searchPersonsByName(name: string): Promise<DahuaPerson[]> {
  await login();
  const qs = new URLSearchParams({
    page: '1', pageSize: '20',
    orgCode: '001', keyword: name,
    containChild: '1', accessGroupId: '',
    personId: '', liftGroupId: '', cardNo: '', personName: name,
  }).toString();
  const data = await _request('GET', `/obms/api/v1.1/acs/person/page?${qs}`, null);
  if (data?.code !== 1000) return [];
  const payload = data?.data ?? data;
  const pageData: any[] = payload?.list ?? payload?.pageData ?? [];
  return pageData.map((raw: any) => {
    const base = raw.baseInfo ?? raw;
    const firstName = (base.firstName ?? '').trim();
    const lastName  = (base.lastName  ?? '').trim();
    const fullName  = lastName ? `${firstName} ${lastName}`.trim() : (firstName || raw.personName || '');
    return {
      id: String(base.personId ?? raw.personId ?? ''),
      personCode: String(base.personCode ?? raw.personCode ?? ''),
      personName: fullName,
      orgCode: String(base.orgCode ?? raw.orgCode ?? ''),
      orgName: String(base.orgName ?? raw.orgName ?? ''),
      email: base.email ?? raw.email,
      phoneNum: base.tel ?? raw.phoneNum,
      plateNos: [],
      accessGroupIds: [],
    };
  });
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
  const { visitorName, hostName, phone, plate, startTs, endTs, acsChannelIds, passport } = params;

  if (!acsChannelIds.length) throw new Error('[Dahua] acsChannelIds must not be empty (code 144025)');

  const pass = passport ?? (await generatePassport());

  // For status='0' (appointment): do NOT send arrivalTime/leaveTime.
  // DSS rejects them with code 1004 — only expectArrivalTime/expectLeaveTime allowed.
  const body = {
    status: '0',
    visitorName,
    visitedName: hostName || 'Portería Virtual',
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

/**
 * Best-effort "leave" — marks a visitor as exited in DSS (status → 4).
 *
 * Only works if the visitor has already arrived (status = 1). In our flow
 * visitors arrive when they scan the QR at a Dahua reader; DSS flips status
 * automatically. For visitors still in appointment state (status = 0), DSS
 * returns code 1001 "Failed" and there is no HTTP API to cancel them —
 * the cancel/delete endpoints we probed all reject with code 1004, 100006
 * or 1010 regardless of method, arg name, or body format.
 *
 * Consequence: this function is a no-op in most UI flows. We still call it
 * so that when a visitor HAS arrived we close the loop correctly in DSS.
 * Errors are swallowed — the UI reflects the Firestore state, which is the
 * source of truth for the app.
 */
async function terminateVisitor(visitorId: string): Promise<void> {
  try {
    await login();
    const data = await _request('POST', '/obms/api/v1.0/visitors/visitor/leave', { visitorId });
    if (data?.code === 1000 || data?.code === 1007) return;
    console.info('[Dahua] terminateVisitor no-op (visitor not in arrived state):', data?.code, data?.desc);
  } catch (err) {
    console.warn('[Dahua] terminateVisitor best-effort failed:', (err as Error).message);
  }
}

/**
 * DSS Pro V8.5 HTTP API does NOT expose a working DELETE for visitors.
 * We use the "sign off / clear" endpoint instead which works for both arrived and
 * appointment-state visitors (overdue/clear).
 */
async function deleteVisitor(visitorId: string): Promise<void> {
  await login();
  const data = await _request('POST', '/obms/api/v1.0/visitors/visitor/overdue/clear', { visitorIds: [visitorId] });
  // code 1000 = success; code 1007 = not found (already cleared) — both are acceptable
  if (data?.code !== 1000 && data?.code !== 1007) {
    throw new Error('[Dahua] deleteVisitor failed: ' + JSON.stringify(data));
  }
}

// ─── remote door open ─────────────────────────────────────────────────────────

async function openDoor(channelId: string): Promise<void> {
  await login();
  // status "1" = unlock (from DSS V8.5 HTTP API — accessControl/door/control)
  const data = await _request('POST', '/obms/api/v1.0/accessControl/door/control',
    { status: '1', channelId });
  if (data?.code !== 1000) {
    throw new Error('[Dahua] openDoor failed: ' + JSON.stringify(data));
  }
}

// ─── exported singleton ───────────────────────────────────────────────────────

const DahuaService = {
  login,
  logout,
  listPersons,
  listPersonGroups,
  listAccessChannels,
  generatePassport,
  createPerson,
  searchPersonsByName,
  createVisitor,
  getVisitor,
  deleteVisitor,
  terminateVisitor,
  openDoor,
  get token() { return _token; },
};

export default DahuaService;
