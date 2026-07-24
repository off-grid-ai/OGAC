// Thin OpenSearch REST transport — the ONE place the console decides how to authenticate to the SIEM
// cluster. Mirrors the qdrant-http.ts / langfuse-http.ts convention (same broker seam, same shape).
//
// WHY THIS EXISTS: the OpenSearch call sites (siem.ts, analytics.ts, accounting.ts,
// opensearch-alerting.ts) each did a RAW `fetch` with no Authorization header. That works only while
// the cluster runs with its security plugin DISABLED. The moment auth is turned on (Phase-D OIDC
// cutover) every one of those calls 401s, and flipping the credential PLAN alone would not have fixed
// it — the header has to actually be sent. Routing them through here means the cutover is a
// one-line plan flip plus zero call-site changes.
//
// FORWARD-COMPATIBLE + BEHAVIOUR-PRESERVING: while `credentialPlan('opensearch')` is 'none' the broker
// returns no credential and we send exactly the headers the raw fetches sent before (no auth), so the
// current no-auth cluster keeps working byte-identically. Flip the plan to 'oidc-jwt' and every call
// starts carrying a Keycloak service JWT with zero further edits.

import { getServiceCredential } from '@/lib/service-credentials';

/** OpenSearch base URL — identical default + env var the call sites already used. */
export function opensearchBaseUrl(): string {
  return process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
}

/** True when an OpenSearch URL is configured (the call sites' existing "is it wired" check). */
export function opensearchConfigured(): boolean {
  return Boolean(process.env.OFFGRID_OPENSEARCH_URL);
}

/**
 * Resolve the Authorization header for the cluster, or undefined when the service is not on the
 * credential plan (today's no-auth deployment). Never throws — a broker failure must degrade to the
 * previous no-auth behaviour rather than break audit/analytics reads.
 */
export async function opensearchAuthHeader(): Promise<Record<string, string>> {
  try {
    const cred = await getServiceCredential('opensearch');
    if (cred.kind === 'bearer' && cred.token) return { authorization: `Bearer ${cred.token}` };
    // 'basic' covers the break-glass internal-user path the security config keeps enabled.
    if (cred.kind === 'basic' && cred.publicKey && cred.secretKey) {
      const basic = Buffer.from(`${cred.publicKey}:${cred.secretKey}`).toString('base64');
      return { authorization: `Basic ${basic}` };
    }
  } catch {
    /* broker best-effort — fall through to no auth (the pre-cutover behaviour) */
  }
  return {};
}

/** Headers for a JSON request: the caller's content-type plus brokered auth when present. */
export async function opensearchHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  return { ...extra, ...(await opensearchAuthHeader()) };
}

/**
 * Issue an OpenSearch REST call. `path` is a leading-slash path (e.g. `/index/_search`). The caller
 * owns status handling; this only adds auth + a timeout, so each call site keeps its own error
 * semantics (fail-open reads vs. fail-closed writes) exactly as before.
 */
export async function opensearchFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, headers, ...rest } = init;
  return fetch(`${opensearchBaseUrl()}${path}`, {
    ...rest,
    headers: await opensearchHeaders((headers as Record<string, string>) ?? {}),
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
