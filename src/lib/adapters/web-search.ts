// ─── Web-search provider ADAPTER (Online Search as a governed tool, §14 Exa/Tavily parity) ────────
//
// The pluggable I/O seam that turns a query into real-time web results. It is the ONLY place the
// web_search primitive reaches a search provider — everything upstream (the pure catalog, the air-gap
// gate, the pipeline egress leash) decides WHETHER the reach is allowed; this file performs the reach
// once it is.
//
// SOLID / ports-and-adapters, mirroring the connector adapters:
//   • the provider is configured by ENV alone (OFFGRID_WEBSEARCH_URL + OFFGRID_WEBSEARCH_KEY), so the
//     org points it at their own search endpoint — SearXNG, a Tavily/Exa-compatible proxy, or any
//     HTTP search API that returns a JSON result list. No provider is hard-coded.
//   • `fetch` is INJECTED (defaults to global fetch) so the whole adapter is unit-testable against a
//     fake provider with zero network.
//   • HONEST degradation: unconfigured ⇒ { ok:false, status:'not_configured' } (never fabricated
//     results); provider error ⇒ { ok:false, status:'error', detail }. The caller records the miss.
//
// This adapter does NOT re-implement governance — the air-gap gate (isPrimitiveEnabled) and the
// pipeline egress leash (webSearchEgressAllowed) are checked by the caller BEFORE it ever runs.

// ─── The normalized result shape every provider is mapped to ──────────────────────────────────────
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type WebSearchStatus = 'ok' | 'not_configured' | 'error';

export interface WebSearchResponse {
  ok: boolean;
  status: WebSearchStatus;
  query: string;
  results: WebSearchResult[];
  /** Honest human-readable detail — configured?/how many results?/what failed? */
  detail: string;
}

// ─── env → provider config (PURE) ─────────────────────────────────────────────────────────────────
// The generic search-API contract: a base URL to POST/GET the query to, an optional bearer/api key,
// and an optional method. Kept a plain resolver so it is trivially testable.
export const WEBSEARCH_URL_ENV = 'OFFGRID_WEBSEARCH_URL';
export const WEBSEARCH_KEY_ENV = 'OFFGRID_WEBSEARCH_KEY';
export const WEBSEARCH_METHOD_ENV = 'OFFGRID_WEBSEARCH_METHOD'; // 'GET' (default) | 'POST'

export interface WebSearchConfig {
  url: string;
  key?: string;
  method: 'GET' | 'POST';
}

/** Resolve provider config from an env snapshot. Returns null when no endpoint is configured. PURE. */
export function resolveWebSearchConfig(
  env: Record<string, string | undefined> = {},
): WebSearchConfig | null {
  const url = (env[WEBSEARCH_URL_ENV] ?? '').trim();
  if (!url) return null;
  const key = (env[WEBSEARCH_KEY_ENV] ?? '').trim() || undefined;
  const method = (env[WEBSEARCH_METHOD_ENV] ?? 'GET').trim().toUpperCase() === 'POST' ? 'POST' : 'GET';
  return { url, key, method };
}

// ─── provider response → normalized results (PURE) ────────────────────────────────────────────────
// Accept the common shapes so ONE adapter fits SearXNG (`results`), Tavily (`results`), and generic
// APIs (`data`/`items`). Each entry maps title/url/snippet from the usual field aliases. Never throws
// on a malformed entry — a bad row is skipped, not fabricated.
export function normalizeSearchResults(data: unknown, limit: number): WebSearchResult[] {
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  const raw =
    (Array.isArray(obj.results) && obj.results) ||
    (Array.isArray(obj.data) && obj.data) ||
    (Array.isArray(obj.items) && obj.items) ||
    [];
  const out: WebSearchResult[] = [];
  for (const entry of raw as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const title = str(r.title ?? r.name ?? r.heading);
    const url = str(r.url ?? r.link ?? r.href);
    const snippet = str(r.snippet ?? r.content ?? r.description ?? r.text ?? r.summary);
    if (!url && !title) continue; // nothing usable — skip, don't fabricate
    out.push({ title: title || '(untitled)', url, snippet: snippet.slice(0, 400) });
    if (out.length >= limit) break;
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}

// ─── searchWeb — the reach (I/O) ──────────────────────────────────────────────────────────────────
export interface SearchWebOpts {
  count?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Perform a real-time web search against the configured provider. NEVER throws — a missing config or
 * a provider failure returns a structured, honest response the caller records verbatim.
 *
 * The caller MUST have already cleared the air-gap gate AND the pipeline egress leash before calling
 * this — this adapter is the reach, not the policy.
 */
export async function searchWeb(query: string, opts: SearchWebOpts = {}): Promise<WebSearchResponse> {
  const q = (query ?? '').trim();
  const count = Math.max(1, Math.min(Number(opts.count ?? 5) || 5, 25));
  if (!q) {
    return { ok: false, status: 'error', query: q, results: [], detail: 'web_search needs a non-empty query' };
  }
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const cfg = resolveWebSearchConfig(env);
  if (!cfg) {
    return {
      ok: false,
      status: 'not_configured',
      query: q,
      results: [],
      detail: `web search is not configured on this deployment — set ${WEBSEARCH_URL_ENV} (and optionally ${WEBSEARCH_KEY_ENV}) to a search API endpoint`,
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.key) headers.authorization = `Bearer ${cfg.key}`;

  let res: Response;
  try {
    const signal = AbortSignal.timeout(opts.timeoutMs ?? 8000);
    if (cfg.method === 'POST') {
      headers['content-type'] = 'application/json';
      res = await fetchImpl(cfg.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: q, q, count, max_results: count }),
        signal,
      });
    } else {
      const sep = cfg.url.includes('?') ? '&' : '?';
      const url = `${cfg.url}${sep}q=${encodeURIComponent(q)}&query=${encodeURIComponent(q)}&count=${count}&format=json`;
      res = await fetchImpl(url, { method: 'GET', headers, signal });
    }
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      query: q,
      results: [],
      detail: `web search request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    return { ok: false, status: 'error', query: q, results: [], detail: `web search provider returned ${res.status}` };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      query: q,
      results: [],
      detail: `web search provider returned non-JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const results = normalizeSearchResults(data, count);
  return {
    ok: true,
    status: 'ok',
    query: q,
    results,
    detail: `web search returned ${results.length} result(s)`,
  };
}

// ─── formatResults — a compact text block for the agent's context (PURE) ──────────────────────────
export function formatSearchResults(resp: WebSearchResponse): string {
  if (resp.results.length === 0) return 'No results.';
  return resp.results
    .map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
    .join('\n');
}

// ─── governedWebSearch — the FULLY GOVERNED entry point the agent pipeline calls ──────────────────
//
// This is the seam the run path uses to perform a web search as a governed tool. It composes, in
// order, the SAME three gates that govern any internet reach — never inventing a bypass:
//   1. AIR-GAP gate      — isPrimitiveEnabled(web_search, env): is the tool opted in on this deploy?
//   2. EGRESS leash      — webSearchEgressAllowed(egress): does the bound pipeline's egress decision
//                          (the one enforceModelCall computed) permit EXTERNAL egress? A local-only or
//                          blocked leash REFUSES the search, exactly as it refuses a cloud model call.
//   3. the REACH         — searchWeb() against the configured provider (honest 'not_configured').
//
// The `egress` argument is the pipeline egress DECISION the caller already derived (pass 'cloud' when
// no pipeline is bound — the additive default). Everything is honest: a blocked/disabled/unconfigured
// search returns a structured status, never fabricated results. NEVER throws.
import {
  getPrimitive,
  isPrimitiveEnabled,
  webSearchEgressAllowed,
  type EgressDecision,
} from '@/lib/tool-primitives';

export interface GovernedWebSearchOpts extends SearchWebOpts {
  /** The pipeline egress decision for this run's data-class (from enforceModelCall). Default 'cloud'. */
  egress?: EgressDecision;
}

export type GovernedWebSearchStatus = WebSearchStatus | 'disabled' | 'egress_blocked';

export interface GovernedWebSearchResponse extends Omit<WebSearchResponse, 'status'> {
  status: GovernedWebSearchStatus;
}

export async function governedWebSearch(
  query: string,
  opts: GovernedWebSearchOpts = {},
): Promise<GovernedWebSearchResponse> {
  const q = (query ?? '').trim();
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const egress = opts.egress ?? 'cloud';

  // 1. AIR-GAP gate — is web_search opted in on this deployment at all?
  const primitive = getPrimitive('web_search');
  if (!primitive || !isPrimitiveEnabled(primitive, env)) {
    return {
      ok: false,
      status: 'disabled',
      query: q,
      results: [],
      detail: `web search reaches the internet and is OFF on this deployment — set ${primitive?.enableEnv ?? 'OFFGRID_TOOL_WEB_SEARCH'} (or OFFGRID_TOOL_EGRESS) to opt in`,
    };
  }

  // 2. EGRESS leash — the pipeline egress decision governs external egress (same rule as a cloud call).
  const verdict = webSearchEgressAllowed(egress);
  if (!verdict.allow) {
    return { ok: false, status: 'egress_blocked', query: q, results: [], detail: verdict.reason };
  }

  // 3. The reach.
  return searchWeb(q, opts);
}
