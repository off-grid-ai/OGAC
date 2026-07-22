// LiteLLM Proxy read adapter. LiteLLM is the professional router/LB/budget layer that sits behind the
// console's GATEWAY_URL seam (OpenAI-compatible, drop-in for the hand-rolled aggregator). This reads
// its management endpoints back so the Router view shows real deployment health + budgets. IDENTICAL
// contract to victoria-metrics.ts / langfuse.ts: an env base URL, injectable fetch, a typed empty view
// + `configured:false` when unset/unreachable, and it NEVER throws into a page.
//
//   OFFGRID_LITELLM_URL         — e.g. http://127.0.0.1:4000 (the LiteLLM proxy)
//   OFFGRID_LITELLM_MASTER_KEY  — the master key; sent as Bearer to the /model|/key management APIs
//
// All response SHAPING is the pure litellm-config.ts (deployment types) — this file only does I/O.
const BASE = process.env.OFFGRID_LITELLM_URL;
const MASTER_KEY = process.env.OFFGRID_LITELLM_MASTER_KEY;

// Injectable fetch so the adapter is testable without a live proxy (mirrors the injected-fetch
// pattern in victoria-metrics.ts). Defaults to global fetch.
type Fetcher = typeof fetch;

export function litellmConfigured(): boolean {
  return Boolean(BASE);
}

function authHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    ...(MASTER_KEY ? { authorization: `Bearer ${MASTER_KEY}` } : {}),
  };
}

async function get(base: string, fetcher: Fetcher, path: string): Promise<unknown> {
  const res = await fetcher(`${base}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`LiteLLM ${res.status}`);
  return res.json();
}

/** One deployment (a fleet node or a cloud model) as the Router view shows it. */
export interface LiteLLMDeployment {
  /** The deployment id (fleet node name / provider id) from model_info.id. */
  id: string;
  /** The public model_name callers route to. */
  modelName: string;
  /** on-prem | cloud — mirrors the console egress class for grouping. */
  egress: 'on-prem' | 'cloud' | 'unknown';
  /** Upstream base URL (…/v1). */
  apiBase: string;
  /** Live health: 'healthy' | 'unhealthy' | 'unknown'. */
  health: 'healthy' | 'unhealthy' | 'unknown';
  /** Whether the deployment accepts image input (from model_info.vision). */
  vision: boolean;
}

/** One virtual key's budget snapshot from /key/info. */
export interface LiteLLMKeyBudget {
  keyAlias: string | null;
  /** Total $ spent on this key. */
  spend: number;
  /** The $ budget ceiling, or null when unbounded. */
  maxBudget: number | null;
  /** Requests-per-minute limit, or null when unset. */
  rpmLimit: number | null;
  /** Tokens-per-minute limit, or null when unset. */
  tpmLimit: number | null;
}

/** The complete Router view the console renders — always safe, never throws. */
export interface LiteLLMRouterView {
  configured: boolean;
  /** True iff /health/liveliness answered ok (the proxy is up). */
  live: boolean;
  deployments: LiteLLMDeployment[];
  budgets: LiteLLMKeyBudget[];
  error?: string;
}

// ─── pure shapers for the management-API JSON (kept beside the adapter; small + fixed shapes) ───────

interface RawModelInfo {
  model_name?: string;
  litellm_params?: { api_base?: string };
  model_info?: { id?: string; egress?: string; vision?: boolean };
}
interface RawHealthEndpoint {
  model_name?: string;
  litellm_params?: { model?: string };
  model_info?: { id?: string };
}

/** Merge /model/info deployments with the /health healthy|unhealthy split into the view rows. PURE. */
export function shapeDeployments(
  models: RawModelInfo[],
  healthy: RawHealthEndpoint[],
  unhealthy: RawHealthEndpoint[],
): LiteLLMDeployment[] {
  const healthyIds = new Set(
    healthy.map((h) => h.model_info?.id ?? h.model_name).filter((x): x is string => Boolean(x)),
  );
  const unhealthyIds = new Set(
    unhealthy.map((h) => h.model_info?.id ?? h.model_name).filter((x): x is string => Boolean(x)),
  );
  return models.map((m) => {
    const id = m.model_info?.id ?? m.model_name ?? 'unknown';
    const egressRaw = m.model_info?.egress;
    const egress: LiteLLMDeployment['egress'] =
      egressRaw === 'on-prem' || egressRaw === 'cloud' ? egressRaw : 'unknown';
    let health: LiteLLMDeployment['health'] = 'unknown';
    if (unhealthyIds.has(id)) health = 'unhealthy';
    else if (healthyIds.has(id)) health = 'healthy';
    return {
      id,
      modelName: m.model_name ?? id,
      egress,
      apiBase: m.litellm_params?.api_base ?? '',
      health,
      vision: m.model_info?.vision === true,
    };
  });
}

interface RawKeyInfo {
  key_alias?: string | null;
  spend?: number;
  max_budget?: number | null;
  rpm_limit?: number | null;
  tpm_limit?: number | null;
}

/** Shape a /key/info info block → the budget row. PURE. */
export function shapeKeyBudget(info: RawKeyInfo): LiteLLMKeyBudget {
  const n = (v: unknown): number | null => {
    // null/undefined are "unset" (→ null), NOT 0 — Number(null) is 0, which would fake a ceiling.
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    keyAlias: info.key_alias ?? null,
    spend: n(info.spend) ?? 0,
    maxBudget: n(info.max_budget),
    rpmLimit: n(info.rpm_limit),
    tpmLimit: n(info.tpm_limit),
  };
}

/**
 * Best-effort combined read-back for the Router view — NEVER throws. Unset env ⇒ configured:false +
 * empty view. Proxy unreachable ⇒ configured:true, live:false, empty deployments (graceful, not a
 * page error). A per-endpoint failure degrades that section only.
 */
export async function safeRouterView(fetcher: Fetcher = fetch): Promise<LiteLLMRouterView> {
  if (!BASE) return { configured: false, live: false, deployments: [], budgets: [] };

  // Liveliness first — if the proxy is down, report honestly and stop (no point probing the rest).
  let live = false;
  try {
    await get(BASE, fetcher, '/health/liveliness');
    live = true;
  } catch (e) {
    return {
      configured: true,
      live: false,
      deployments: [],
      budgets: [],
      error: (e as Error).message,
    };
  }

  let deployments: LiteLLMDeployment[] = [];
  try {
    const models = (await get(BASE, fetcher, '/model/info')) as { data?: RawModelInfo[] };
    const health = (await get(BASE, fetcher, '/health')) as {
      healthy_endpoints?: RawHealthEndpoint[];
      unhealthy_endpoints?: RawHealthEndpoint[];
    };
    deployments = shapeDeployments(
      Array.isArray(models.data) ? models.data : [],
      Array.isArray(health.healthy_endpoints) ? health.healthy_endpoints : [],
      Array.isArray(health.unhealthy_endpoints) ? health.unhealthy_endpoints : [],
    );
  } catch {
    deployments = [];
  }

  let budgets: LiteLLMKeyBudget[] = [];
  try {
    // /key/info with no key returns the caller's (master) key info; a deployment may expose more via
    // /key/list, but the single master budget is enough for the honest "budgets are enforced" signal.
    const info = (await get(BASE, fetcher, '/key/info')) as { info?: RawKeyInfo };
    if (info.info) budgets = [shapeKeyBudget(info.info)];
  } catch {
    budgets = [];
  }

  return { configured: true, live, deployments, budgets };
}

// ─── virtual-key lifecycle (management writes) ──────────────────────────────────────────────────
// LiteLLM's DB-backed FinOps: create/update/delete/list virtual keys with per-key budget + rpm/tpm.
// These POST to the /key/* management API with the master key. They THROW on failure so the route
// surfaces a real error (unlike safeRouterView which is a never-throw read for a page).

async function mgmt(path: string, body: unknown, fetcher: Fetcher = fetch): Promise<unknown> {
  if (!BASE) throw new Error('LiteLLM not configured (OFFGRID_LITELLM_URL unset)');
  const res = await fetcher(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LiteLLM ${path} ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return res.json().catch(() => ({}));
}

/** List virtual keys (raw rows for the pure shaper). Never throws → [] on any failure. */
export async function listVirtualKeys(fetcher: Fetcher = fetch): Promise<unknown> {
  if (!BASE) return [];
  try {
    // return_full_object gives budgets/limits per key; large deployments would paginate.
    return await get(BASE, fetcher, '/key/list?return_full_object=true&size=100');
  } catch {
    return [];
  }
}

/** Create a virtual key. Returns the raw response (contains the generated `key`). Throws on failure. */
export function generateVirtualKey(body: Record<string, unknown>, fetcher: Fetcher = fetch): Promise<unknown> {
  return mgmt('/key/generate', body, fetcher);
}

/** Update a virtual key's budget/limits. Throws on failure. */
export function updateVirtualKey(body: Record<string, unknown>, fetcher: Fetcher = fetch): Promise<unknown> {
  return mgmt('/key/update', body, fetcher);
}

/** Delete virtual keys by token. Throws on failure. */
export function deleteVirtualKeys(keys: string[], fetcher: Fetcher = fetch): Promise<unknown> {
  return mgmt('/key/delete', { keys }, fetcher);
}

// ─── model deployment / provider-pool lifecycle (management writes) ─────────────────────────────
// DB-backed model management (the g5 proxy runs STORE_MODEL_IN_DB=True): add/remove fleet + cloud
// model deployments in the routing pool as VALIDATED transactions via /model/new + /model/delete
// (master-key auth). This is the console-owned "publish" the routing surface needs — config-file
// models stay the base; these layer on top and persist in the LiteLLM DB (creds encrypted by the
// salt key). Writes THROW so the route surfaces a real error; the list is a never-throw read.

/** List model deployments (raw /model/info for the pure shaper). Never throws → {data:[]}. */
export async function listModelDeployments(fetcher: Fetcher = fetch): Promise<unknown> {
  if (!BASE) return { data: [] };
  try {
    return await get(BASE, fetcher, '/model/info');
  } catch {
    return { data: [] };
  }
}

/** Add a model deployment to the pool (/model/new). Returns the raw response. Throws on failure. */
export function addModelDeployment(
  body: Record<string, unknown>,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  return mgmt('/model/new', body, fetcher);
}

/** Remove a model deployment by its LiteLLM model id (/model/delete). Throws on failure. */
export function deleteModelDeployment(id: string, fetcher: Fetcher = fetch): Promise<unknown> {
  return mgmt('/model/delete', { id }, fetcher);
}
