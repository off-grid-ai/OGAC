// ─── Kestra low-level HTTP primitives (I/O only) ─────────────────────────────────────────────────
// The base-URL / tenant / basic-auth / timed-fetch pattern the console uses to reach the Kestra REST
// API, factored out so more than one adapter can share it without re-deriving env handling. kestra.ts
// (the flow/orchestration port, proven live) keeps its own module-private copy of this pattern; this
// file exists so the NEW catalog adapter (kestra-catalog.ts) reuses the SAME env + auth contract
// rather than editing the proven-live kestra.ts. Reads the identical env keys documented there:
//   OFFGRID_KESTRA_URL       base URL (default = the on-box loopback the edge-Caddy fronts)
//   OFFGRID_KESTRA_TENANT    tenant segment for tenant-scoped endpoints (default 'main')
//   OFFGRID_KESTRA_USER/…_PASSWORD   Kestra OSS Basic Auth (0.24+ requires it), omitted when unset

const env = process.env;

// Production default is the on-box loopback the edge-Caddy fronts (8945 → offgrid-s2:8090).
const DEFAULT_URL = 'http://127.0.0.1:8945';
const TIMEOUT_MS = 8000;

export function kestraBaseUrl(): string {
  return (env.OFFGRID_KESTRA_URL || DEFAULT_URL).replace(/\/$/, '');
}

export function kestraTenant(): string {
  return env.OFFGRID_KESTRA_TENANT || 'main';
}

// "Configured" = an explicit engine URL is set; unset falls back to the loopback default, which is
// only live once the edge proxy + box are provisioned. The catalog surfaces this to render an honest
// "not wired" vs "wired but down" state.
export function kestraConfigured(): boolean {
  return Boolean(env.OFFGRID_KESTRA_URL);
}

export function kestraAuthHeaders(): Record<string, string> {
  const u = env.OFFGRID_KESTRA_USER;
  const p = env.OFFGRID_KESTRA_PASSWORD;
  if (u && p) {
    const token = Buffer.from(`${u}:${p}`).toString('base64');
    return { authorization: `Basic ${token}` };
  }
  return {};
}

// fetch() hides the useful errno (ECONNREFUSED/ETIMEDOUT) on err.cause.code, not err.message.
export function describeKestraError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: unknown } }).cause;
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
    return code ? `${err.message} (cause: ${String(code)})` : err.message;
  }
  return String(err);
}

export interface KestraResponse {
  ok: boolean;
  status: number;
  text: string;
}

// One timed request against the engine. Never throws for a non-2xx — returns {ok:false,status} so
// callers render honest states; throws only on a transport failure (unreachable/timeout).
export async function kestraReq(
  method: string,
  path: string,
  init: { body?: BodyInit; contentType?: string; accept?: string } = {},
): Promise<KestraResponse> {
  const headers: Record<string, string> = { ...kestraAuthHeaders() };
  if (init.contentType) headers['content-type'] = init.contentType;
  headers['accept'] = init.accept ?? 'application/json';
  const res = await fetch(`${kestraBaseUrl()}${path}`, {
    method,
    headers,
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}
