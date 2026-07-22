// ─── LiteLLM base-URL / master-key resolver (thin I/O seam) ───────────────────────────────────────
//
// litellm.ts reads the same env into module-level constants but does NOT export a reusable resolver,
// so the new spend adapter would otherwise duplicate the base-URL + Bearer-auth wiring. This module
// is the single place that resolution lives, reused by adapters that talk to the LiteLLM proxy
// management/analytics APIs. It mirrors litellm.ts's contract EXACTLY (same env vars, same Bearer
// header, injectable fetch, no-store) so behavior can't drift between the two callers.
//
//   OFFGRID_LITELLM_URL         — e.g. http://127.0.0.1:4000 (the LiteLLM proxy)
//   OFFGRID_LITELLM_MASTER_KEY  — the master key, sent as Bearer to the management/analytics APIs

export type Fetcher = typeof fetch;

/** True iff the proxy base URL is configured. */
export function litellmHttpConfigured(): boolean {
  return Boolean(process.env.OFFGRID_LITELLM_URL);
}

/** The configured base URL (trailing slash trimmed), or null when unset. */
export function litellmBaseUrl(): string | null {
  const raw = process.env.OFFGRID_LITELLM_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const key = process.env.OFFGRID_LITELLM_MASTER_KEY;
  return {
    accept: 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  };
}

/** Raised when a GET fails; carries the HTTP status so callers can distinguish 404 (unavailable). */
export class LiteLLMHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LiteLLMHttpError';
    this.status = status;
  }
}

/**
 * Authenticated GET against the LiteLLM proxy. Throws LiteLLMHttpError on a non-2xx or when the
 * proxy is unconfigured. `timeoutMs` defaults to 8s (spend rollups can be heavier than a health
 * ping). The caller decides how to degrade (never-throw view vs. surfaced error).
 */
export async function litellmGet(
  path: string,
  fetcher: Fetcher = fetch,
  timeoutMs = 8000,
): Promise<unknown> {
  const base = litellmBaseUrl();
  if (!base) throw new LiteLLMHttpError(0, 'LiteLLM not configured (OFFGRID_LITELLM_URL unset)');
  const res = await fetcher(`${base}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new LiteLLMHttpError(
      res.status,
      `LiteLLM ${path} ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  return res.json();
}
