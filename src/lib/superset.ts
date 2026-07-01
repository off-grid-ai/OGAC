// Superset activation. Two modes, both server-side:
//  1) Guest token (embedded-SDK flow) — mint a short-lived guest token scoped to a dashboard so the
//     browser can embed it without Superset session cookies. Wired into the Analytics page.
//  2) SQL API — run a governed read-only SQL query against a Superset database for a native view.
// Config (S1 = http://192.168.1.60:8088):
//   OFFGRID_SUPERSET_URL, OFFGRID_SUPERSET_USERNAME, OFFGRID_SUPERSET_PASSWORD,
//   OFFGRID_SUPERSET_EMBED_UUID (dashboard embed id), OFFGRID_SUPERSET_DB_ID (SQL API database id)
const BASE = process.env.OFFGRID_SUPERSET_URL;
const USER = process.env.OFFGRID_SUPERSET_USERNAME;
const PASS = process.env.OFFGRID_SUPERSET_PASSWORD;
const EMBED_UUID = process.env.OFFGRID_SUPERSET_EMBED_UUID;

export function supersetConfigured(): boolean {
  return Boolean(BASE && USER && PASS);
}

export function supersetEmbedUuid(): string | undefined {
  return EMBED_UUID;
}

export function supersetBase(): string | undefined {
  return BASE;
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

export interface GuestTokenResult {
  configured: boolean;
  token?: string;
  embedUuid?: string;
  supersetDomain?: string;
  error?: string;
}

// Mint a guest token for the embedded dashboard. The embedded SDK in the browser exchanges this to
// render the dashboard iframe. Best-effort: returns an error string rather than throwing.
export async function mintGuestToken(): Promise<GuestTokenResult> {
  if (!supersetConfigured() || !EMBED_UUID) {
    return { configured: false };
  }
  try {
    const access = await login();
    const res = await fetch(`${BASE}/api/v1/security/guest_token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
      body: JSON.stringify({
        user: { username: 'offgrid-console', first_name: 'Off', last_name: 'Grid' },
        resources: [{ type: 'dashboard', id: EMBED_UUID }],
        rls: [],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { configured: true, error: `guest_token ${res.status}` };
    const json = (await res.json()) as { token?: string };
    return {
      configured: true,
      token: json.token,
      embedUuid: EMBED_UUID,
      supersetDomain: BASE,
    };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
}
