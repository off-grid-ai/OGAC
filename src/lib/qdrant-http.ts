// Thin Qdrant REST transport used ONLY by the snapshot/collection-admin adapter.
//
// `src/lib/qdrant.ts` (the retrieval backend) keeps its own private fetch helper and exports no
// client, so there is nothing to import for DRY reuse without editing that file (which is off-limits).
// This resolver mirrors its base-URL/api-key convention exactly — same env vars, same header shape —
// so the two agree, and additionally consults the service-credential broker so that if `qdrant` is
// ever added to the credential plan its brokered key is preferred over the static env key.

import { getServiceCredential } from '@/lib/service-credentials';

/** Qdrant base URL — identical default + env var to the retrieval backend (qdrant.ts). */
export function qdrantBaseUrl(): string {
  return process.env.OFFGRID_QDRANT_URL ?? 'http://127.0.0.1:6333';
}

// Resolve the api-key: prefer a brokered bearer (forward-compatible if `qdrant` joins the credential
// plan), else the static OFFGRID_QDRANT_API_KEY that qdrant.ts already uses. Never throws.
async function resolveApiKey(): Promise<string | undefined> {
  try {
    const cred = await getServiceCredential('qdrant');
    if (cred.kind === 'bearer' && cred.token) return cred.token;
  } catch {
    /* broker best-effort — fall back to the static env key below */
  }
  return process.env.OFFGRID_QDRANT_API_KEY;
}

async function qdrantHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const key = await resolveApiKey();
  return {
    'content-type': 'application/json',
    ...(key ? { 'api-key': key } : {}),
    ...extra,
  };
}

const TIMEOUT_MS = 15_000;

/**
 * Issue a Qdrant REST call. `path` is a leading-slash path (e.g. `/collections`). The caller owns
 * status handling; this only performs the fetch with auth + a timeout. Snapshot creation/recovery can
 * be slow, hence a generous timeout relative to qdrant.ts's read path.
 */
export async function qdrantFetch(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${qdrantBaseUrl()}${path}`, {
    method,
    headers: await qdrantHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Fetch a raw snapshot file (no JSON content-type) for the download proxy. Streams the body. */
export async function qdrantFetchRaw(path: string): Promise<Response> {
  const key = await resolveApiKey();
  return fetch(`${qdrantBaseUrl()}${path}`, {
    method: 'GET',
    headers: key ? { 'api-key': key } : {},
    signal: AbortSignal.timeout(60_000),
  });
}
