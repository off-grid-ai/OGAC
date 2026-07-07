// Superset activation. Server-side IO orchestration; all pure decisions/payloads live in
// superset-provision.ts (zero-IO, unit-tested).
//  1) Guest token (embedded-SDK flow) — mint a short-lived guest token scoped to a dashboard so the
//     browser can embed it without Superset session cookies. VERIFY-OR-FAIL: we confirm the dashboard
//     UUID actually exists before minting, so a stale/missing UUID surfaces as "not provisioned"
//     instead of a valid token pointing at a ghost dashboard (→ blank iframe).
//  2) Provisioning — idempotently build a real starter dashboard (database → dataset → charts →
//     dashboard) over the audit_events table via the Superset REST API.
// Config (S1 = http://offgrid-g6.local:8088):
//   OFFGRID_SUPERSET_URL, OFFGRID_SUPERSET_USERNAME, OFFGRID_SUPERSET_PASSWORD,
//   OFFGRID_SUPERSET_EMBED_UUID (dashboard embed id), OFFGRID_SUPERSET_DB_ID (SQL API database id),
//   OFFGRID_SUPERSET_DB_URI (SQLAlchemy URI Superset uses to reach the console Postgres)
import {
  buildDashboardCreatePayload,
  buildDashboardUpdatePayload,
  buildDatabasePayload,
  buildDatasetPayload,
  buildRequestsOverTimeChart,
  buildTokensByModelChart,
  decideEmbed,
  embeddedUuidMatches,
  findByName,
  findOwnedDashboard,
  OFFGRID_DATASET_TABLE,
  OFFGRID_DB_NAME,
  type EmbedState,
  type SupersetDashboardRow,
  type SupersetEmbeddedConfig,
} from './superset-provision';

const BASE = process.env.OFFGRID_SUPERSET_URL;
const USER = process.env.OFFGRID_SUPERSET_USERNAME;
const PASS = process.env.OFFGRID_SUPERSET_PASSWORD;
const EMBED_UUID = process.env.OFFGRID_SUPERSET_EMBED_UUID;
// SQLAlchemy URI Superset uses to reach the console Postgres. Distinct from the console's own
// DATABASE_URL because Superset may live on another host and needs a routable host, not localhost.
const DB_URI = process.env.OFFGRID_SUPERSET_DB_URI ?? process.env.DATABASE_URL;

export function supersetConfigured(): boolean {
  return Boolean(BASE && USER && PASS);
}

export function supersetEmbedUuid(): string | undefined {
  return EMBED_UUID;
}

export function supersetBase(): string | undefined {
  return BASE;
}

// ─── Authenticated session (bearer + CSRF for mutations) ────────────────────

interface Session {
  access: string;
  csrf: string;
  cookie: string;
}

// Log in via /api/v1/security/login (username/password provider) → bearer access token.
async function login(): Promise<string> {
  if (!BASE || !USER || !PASS) throw new Error('Superset not configured');
  const res = await fetch(`${BASE}/api/v1/security/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, provider: 'db', refresh: true }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Superset login ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Superset login: no access_token');
  return json.access_token;
}

// Full session: bearer + a CSRF token (required by Superset on POST/PUT/DELETE) plus the session
// cookie that the CSRF token is bound to.
async function authSession(): Promise<Session> {
  const access = await login();
  const res = await fetch(`${BASE}/api/v1/security/csrf_token/`, {
    headers: { authorization: `Bearer ${access}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Superset csrf_token ${res.status}`);
  const json = (await res.json()) as { result?: string };
  const csrf = json.result ?? '';
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { access, csrf, cookie };
}

function authHeaders(s: Session, mutate: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${s.access}`,
  };
  if (mutate) {
    h['X-CSRFToken'] = s.csrf;
    if (s.cookie) h.cookie = s.cookie;
  }
  return h;
}

// GET helper that returns the parsed `result` array of a Superset list endpoint.
async function listAll<T>(s: Session, path: string): Promise<T[]> {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(s, false),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  const json = (await res.json()) as { result?: T[] };
  return json.result ?? [];
}

async function post(s: Session, path: string, body: unknown): Promise<{ id?: number; result?: { uuid?: string } }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(s, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function put(s: Session, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: authHeaders(s, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status} ${await res.text()}`);
}

// ─── verify-or-fail ─────────────────────────────────────────────────────────

// GET the embedded config for a dashboard id → the embeddable uuid (or null if not embedded / 404).
// The dashboard LIST endpoint doesn't expose the embed uuid, so this is the authoritative source.
async function embeddedConfig(s: Session, dashboardId: number): Promise<SupersetEmbeddedConfig | null> {
  const res = await fetch(`${BASE}/api/v1/dashboard/${dashboardId}/embedded`, {
    headers: authHeaders(s, false),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null; // dashboard exists but embedding not enabled
  if (!res.ok) throw new Error(`GET /dashboard/${dashboardId}/embedded → ${res.status}`);
  const json = (await res.json()) as { result?: SupersetEmbeddedConfig };
  return json.result ?? null;
}

// Probe whether the configured embed UUID actually exists in Superset. Two-step because the list
// endpoint has no uuid column: find our dashboard by its stable TITLE, then confirm that dashboard's
// /embedded uuid equals the configured one. Returns false when the title isn't found, embedding is
// off, or the uuid drifted — so a stale/missing embed UUID resolves to 'not-provisioned' (never a
// token pointing at a ghost dashboard). Network/auth failures throw and are caught by the caller.
async function dashboardExists(s: Session, uuid: string): Promise<boolean> {
  const rows = await listAll<SupersetDashboardRow>(s, '/api/v1/dashboard/?q=(page_size:100)');
  const owned = findOwnedDashboard(rows);
  if (!owned) return false;
  const config = await embeddedConfig(s, owned.id);
  return embeddedUuidMatches(config, uuid);
}

export interface GuestTokenResult {
  configured: boolean;
  state: EmbedState;
  token?: string;
  embedUuid?: string;
  supersetDomain?: string;
  reason?: string;
  error?: string;
}

// Mint a guest token for the embedded dashboard — ONLY after verifying the dashboard exists. If the
// UUID is missing, returns { state: 'not-provisioned' } with NO token, so the UI shows a provisioning
// CTA rather than a blank iframe. Best-effort: returns an error string rather than throwing.
export async function mintGuestToken(): Promise<GuestTokenResult> {
  const configured = supersetConfigured();
  if (!configured || !EMBED_UUID) {
    return { configured: false, state: 'not-configured' };
  }
  try {
    const s = await authSession();
    const exists = await dashboardExists(s, EMBED_UUID);
    const decision = decideEmbed({ configured, embedUuid: EMBED_UUID, dashboardExists: exists });
    if (decision.state !== 'ready') {
      return {
        configured: true,
        state: decision.state,
        embedUuid: EMBED_UUID,
        supersetDomain: BASE,
        reason: decision.reason,
      };
    }
    const res = await fetch(`${BASE}/api/v1/security/guest_token/`, {
      method: 'POST',
      headers: authHeaders(s, true),
      body: JSON.stringify({
        user: { username: 'offgrid-console', first_name: 'Off', last_name: 'Grid' },
        resources: [{ type: 'dashboard', id: EMBED_UUID }],
        rls: [],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { configured: true, state: 'ready', error: `guest_token ${res.status}` };
    const json = (await res.json()) as { token?: string };
    return {
      configured: true,
      state: 'ready',
      token: json.token,
      embedUuid: EMBED_UUID,
      supersetDomain: BASE,
    };
  } catch (e) {
    return { configured: true, state: 'not-provisioned', error: (e as Error).message };
  }
}

// ─── Provisioning ───────────────────────────────────────────────────────────

interface NamedRow extends Record<string, unknown> {
  id: number;
}

// Find-or-create a resource by name over a Superset list endpoint.
async function findOrCreate(
  s: Session,
  listPath: string,
  nameKey: string,
  name: string,
  createPath: string,
  createBody: unknown,
): Promise<number> {
  const rows = await listAll<NamedRow>(s, listPath);
  const existing = findByName(rows, nameKey, name);
  if (existing) return existing.id;
  const created = await post(s, createPath, createBody);
  if (typeof created.id !== 'number') throw new Error(`create ${createPath}: no id`);
  return created.id;
}

export interface ProvisionResult {
  configured: boolean;
  ok: boolean;
  created: boolean; // false ⇒ reused an already-provisioned dashboard (idempotent no-op)
  dashboardId?: number;
  embedUuid?: string;
  supersetDomain?: string;
  charts?: number[];
  error?: string;
}

// Idempotently provision the starter dashboard: database → dataset → charts → dashboard. Detects and
// reuses an existing Off Grid AI dashboard (matched by stable title) rather than duplicating.
export async function provisionDashboard(): Promise<ProvisionResult> {
  if (!supersetConfigured()) return { configured: false, ok: false, created: false };
  if (!DB_URI) {
    return { configured: true, ok: false, created: false, error: 'OFFGRID_SUPERSET_DB_URI (or DATABASE_URL) not set' };
  }
  try {
    const s = await authSession();

    // Idempotency: if our dashboard already exists, reuse it.
    const dashboards = await listAll<SupersetDashboardRow>(s, '/api/v1/dashboard/?q=(page_size:100)');
    const owned = findOwnedDashboard(dashboards);
    if (owned) {
      return {
        configured: true,
        ok: true,
        created: false,
        dashboardId: owned.id,
        embedUuid: owned.uuid,
        supersetDomain: BASE,
      };
    }

    // 1) database connection
    const databaseId = await findOrCreate(
      s,
      '/api/v1/database/?q=(page_size:100)',
      'database_name',
      OFFGRID_DB_NAME,
      '/api/v1/database/',
      buildDatabasePayload(DB_URI),
    );

    // 2) dataset over audit_events on that database
    const datasetId = await findOrCreate(
      s,
      `/api/v1/dataset/?q=(filters:!((col:table_name,opr:eq,value:${OFFGRID_DATASET_TABLE})),page_size:100)`,
      'table_name',
      OFFGRID_DATASET_TABLE,
      '/api/v1/dataset/',
      buildDatasetPayload(databaseId),
    );

    // 3) charts (find-or-create by slice_name)
    const chart1 = await findOrCreate(
      s,
      `/api/v1/chart/?q=(page_size:100)`,
      'slice_name',
      buildRequestsOverTimeChart(datasetId).slice_name,
      '/api/v1/chart/',
      buildRequestsOverTimeChart(datasetId),
    );
    const chart2 = await findOrCreate(
      s,
      `/api/v1/chart/?q=(page_size:100)`,
      'slice_name',
      buildTokensByModelChart(datasetId).slice_name,
      '/api/v1/chart/',
      buildTokensByModelChart(datasetId),
    );
    const charts = [chart1, chart2];

    // 4) dashboard: create, then attach charts + layout
    const created = await post(s, '/api/v1/dashboard/', buildDashboardCreatePayload());
    if (typeof created.id !== 'number') throw new Error('create dashboard: no id');
    const dashboardId = created.id;
    await put(s, `/api/v1/dashboard/${dashboardId}`, buildDashboardUpdatePayload(charts));

    // fetch the created dashboard to read back its embed uuid
    const after = await listAll<SupersetDashboardRow>(s, '/api/v1/dashboard/?q=(page_size:100)');
    const uuid = findOwnedDashboard(after)?.uuid;

    return {
      configured: true,
      ok: true,
      created: true,
      dashboardId,
      embedUuid: uuid,
      supersetDomain: BASE,
      charts,
    };
  } catch (e) {
    return { configured: true, ok: false, created: false, error: (e as Error).message };
  }
}
