// ─── First-party governed tool PRIMITIVES (Builder Epic #117) — PURE catalog, zero-IO ────────────
//
// The founder's ask: an app's agent step can call, as tools, both OTHER built apps AND small built-in
// primitives — "web_search, read_url and stuff like that." This module is the PURE catalog + the
// pure gating rules for those primitives. It holds NO I/O — execution lives behind the thin governed
// adapter `src/lib/adapters/tool-primitives.ts`. Keeping the catalog + gating pure makes both
// unit-testable in isolation (test/tool-primitives.test.ts).
//
// ── AIR-GAP SAFETY (non-negotiable, on-prem default = "nothing leaves the network") ──────────────
// web_search and read_url and http_fetch reach OUT to the public internet. On an air-gapped
// deployment they MUST be OFF by default and clearly labelled — only ever enabled when the org
// explicitly opts in via an env flag. Each primitive declares `reachesInternet` + a `defaultEnabled`
// and the pure `isPrimitiveEnabled(primitive, env)` rule decides availability from env alone. Nothing
// here performs the reach — that's the adapter, which re-checks the same rule before every call.

// ─── ToolParam — one input the primitive takes (rendered as a labeled field in the picker) ────────
export interface ToolParam {
  key: string;
  label: string;
  type: 'text' | 'number' | 'url' | 'select';
  required?: boolean;
  description?: string;
  options?: string[];
}

// ─── ToolPrimitive — one first-party built-in tool ───────────────────────────────────────────────
export interface ToolPrimitive {
  /** Stable id. Referenced from an agent step as the tool ref `prim:<id>` (see toolRef). */
  id: string;
  /** Human name shown in the picker. */
  name: string;
  /** Plain-language "what it does / when to use it" — for the non-technical builder. */
  description: string;
  /** The inputs it takes. */
  params: ToolParam[];
  /** True if invoking it sends a request to the PUBLIC internet (air-gap relevant). */
  reachesInternet: boolean;
  /** On an unconfigured/air-gapped instance, is it on by default? Internet primitives are OFF. */
  defaultEnabled: boolean;
  /**
   * The env flag that OPTS IN an internet-reaching primitive (empty for always-safe ones). When set
   * to a truthy value on the deployment, the primitive becomes available. Documented in SERVER_STATE.
   */
  enableEnv?: string;
  /** A one-line note shown next to the primitive explaining its air-gap posture. */
  airgapNote: string;
}

// The env flag names (single source of truth; also documented in deploy/onprem/SERVER_STATE.md).
export const PRIMITIVE_EGRESS_ENV = 'OFFGRID_TOOL_EGRESS'; // master opt-in for any internet primitive
export const WEB_SEARCH_ENV = 'OFFGRID_TOOL_WEB_SEARCH';   // per-tool opt-in for web_search
export const READ_URL_ENV = 'OFFGRID_TOOL_READ_URL';       // per-tool opt-in for read_url
export const HTTP_FETCH_ENV = 'OFFGRID_TOOL_HTTP_FETCH';   // per-tool opt-in for http_fetch

// ─── THE CATALOG — the first-party primitives ────────────────────────────────────────────────────
// web_search / read_url / http_fetch all reach the internet → OFF by default, opt-in via env. Any
// always-safe on-prem primitive (none reach out) would carry defaultEnabled:true and no enableEnv.
export const TOOL_PRIMITIVES: ToolPrimitive[] = [
  {
    id: 'web_search',
    name: 'Web search',
    description:
      'Search the public web for a query and return the top results (title, url, snippet). Use it when the app needs fresh facts that are not in your knowledge base.',
    params: [
      { key: 'query', label: 'Search query', type: 'text', required: true, description: 'What to search for.' },
      { key: 'count', label: 'Number of results', type: 'number', description: 'How many results to return (default 5).' },
    ],
    reachesInternet: true,
    defaultEnabled: false,
    enableEnv: WEB_SEARCH_ENV,
    airgapNote: 'Reaches the public internet — OFF on an air-gapped deployment until the org opts in.',
  },
  {
    id: 'read_url',
    name: 'Read a web page',
    description:
      'Fetch a single web page by URL and return its readable text. Use it to pull the content of a specific link the app already has.',
    params: [
      { key: 'url', label: 'Page URL', type: 'url', required: true, description: 'The web address to read.' },
    ],
    reachesInternet: true,
    defaultEnabled: false,
    enableEnv: READ_URL_ENV,
    airgapNote: 'Reaches the public internet — OFF on an air-gapped deployment until the org opts in.',
  },
  {
    id: 'http_fetch',
    name: 'HTTP request',
    description:
      'Make an HTTP request to a URL and return the raw response body. A low-level primitive for calling an internal or external API the app needs.',
    params: [
      { key: 'url', label: 'Request URL', type: 'url', required: true, description: 'The endpoint to call.' },
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'], description: 'HTTP method (default GET).' },
      { key: 'body', label: 'Request body', type: 'text', description: 'Optional body for a POST.' },
    ],
    reachesInternet: true,
    defaultEnabled: false,
    enableEnv: HTTP_FETCH_ENV,
    airgapNote:
      'Can reach any host, incl. the public internet — OFF on an air-gapped deployment until the org opts in.',
  },
];

// ─── toolRef / parseToolRef — the ref namespace for primitives ────────────────────────────────────
// An agent step references a primitive as `prim:<id>` (mirrors the registry's `tool:<id>` and
// apps-as-tools' `app:<id>`), so all three tool sources share one ref space the agent pipeline reads.
export const PRIMITIVE_REF_PREFIX = 'prim:';
export function toolRef(id: string): string {
  return `${PRIMITIVE_REF_PREFIX}${id}`;
}
export function isPrimitiveRef(ref: string): boolean {
  return ref.startsWith(PRIMITIVE_REF_PREFIX);
}
export function parsePrimitiveRef(ref: string): string | null {
  return isPrimitiveRef(ref) ? ref.slice(PRIMITIVE_REF_PREFIX.length) : null;
}

export function getPrimitive(id: string): ToolPrimitive | null {
  return TOOL_PRIMITIVES.find((p) => p.id === id) ?? null;
}

// ─── isPrimitiveEnabled — the PURE air-gap gating rule ────────────────────────────────────────────
// A primitive is available iff:
//   • it never reaches the internet (always safe on-prem), OR
//   • the org has OPTED IN via env — either the master egress flag OFFGRID_TOOL_EGRESS is truthy,
//     or the primitive's own enableEnv flag is truthy.
// Env is passed IN (never read from process here) so this is unit-testable and deterministic.
export function isEnvTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function isPrimitiveEnabled(
  primitive: ToolPrimitive,
  env: Record<string, string | undefined> = {},
): boolean {
  if (!primitive.reachesInternet) return true; // always-safe on-prem
  if (isEnvTruthy(env[PRIMITIVE_EGRESS_ENV])) return true; // master opt-in
  if (primitive.enableEnv && isEnvTruthy(env[primitive.enableEnv])) return true; // per-tool opt-in
  return false; // air-gap default: OFF
}

// ─── egress-leash gating for internet primitives (reuses the pipeline egress DECISION) ────────────
//
// The air-gap gate above answers "is this internet primitive turned ON for the deployment at all?".
// It is NOT the whole story: when a run is bound to a pipeline whose egress leash is LOCAL-ONLY (or
// blocked) for the data-class in play, ANY reach to the public internet must be refused — exactly as
// a cloud MODEL call is refused. A web search is external egress, so it is governed by the SAME
// egress verdict `enforceModelCall` already produces (`'local' | 'cloud' | 'block'`). We do NOT
// invent a second, weaker leash here — we CONSUME that decision.
//
// The mapping mirrors the model-call rule:
//   • 'cloud'  → external egress permitted           → web search MAY reach out.
//   • 'local'  → leashed to on-prem only             → web search REFUSED (it would leave the network).
//   • 'block'  → nothing may leave for this class     → web search REFUSED.
// With NO bound pipeline the caller passes 'cloud' (the additive "no new leash" default), so behaviour
// is unchanged from before the leash existed — subject only to the air-gap opt-in above.
export type EgressDecision = 'local' | 'cloud' | 'block';

export interface WebSearchEgressVerdict {
  /** true ⇒ an external web search may proceed for this run's egress posture. */
  allow: boolean;
  /** The egress decision that drove this (echoed for the audit trail). */
  egress: EgressDecision;
  /** Honest reason for the governed result + audit detail. */
  reason: string;
}

/**
 * Decide whether a web_search (external egress) may run given the pipeline's egress DECISION for the
 * data-class in play. PURE — the caller passes the egress already computed by enforceModelCall so this
 * NEVER re-derives (or bypasses) the leash. Any internet primitive can be gated the same way.
 */
export function webSearchEgressAllowed(egress: EgressDecision): WebSearchEgressVerdict {
  if (egress === 'cloud') {
    return { allow: true, egress, reason: 'egress leash permits external egress — web search allowed' };
  }
  const reason =
    egress === 'local'
      ? 'egress leash is LOCAL-ONLY (on-prem) — external web search refused'
      : 'egress leash BLOCKS external egress — web search refused';
  return { allow: false, egress, reason };
}

// ─── PrimitiveCatalogEntry — a primitive + its resolved enabled state, for the picker ─────────────
export interface PrimitiveCatalogEntry {
  id: string;
  ref: string;
  name: string;
  description: string;
  params: ToolParam[];
  reachesInternet: boolean;
  enabled: boolean;
  airgapNote: string;
}

// Build the catalog the builder renders — every primitive, each tagged with its live enabled state
// (from env). A disabled internet primitive still SHOWS (so the builder knows it exists) but is
// clearly marked off + un-pickable at the UI layer.
export function primitiveCatalog(
  env: Record<string, string | undefined> = {},
): PrimitiveCatalogEntry[] {
  return TOOL_PRIMITIVES.map((p) => ({
    id: p.id,
    ref: toolRef(p.id),
    name: p.name,
    description: p.description,
    params: p.params,
    reachesInternet: p.reachesInternet,
    enabled: isPrimitiveEnabled(p, env),
    airgapNote: p.airgapNote,
  }));
}
