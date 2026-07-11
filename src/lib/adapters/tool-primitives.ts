// ─── Tool-primitive execution adapter (Builder Epic #117) — the governed I/O seam ────────────────
//
// The thin I/O layer that actually EXECUTES a first-party primitive (web_search / read_url /
// http_fetch) and, via `maybeRunComposableTool`, dispatches any composable tool ref the agent
// pipeline routes to (a primitive `prim:<id>` or an app `app:<id>`). The pure catalog + gating rules
// live in tool-primitives.ts; the pure app→app cycle logic in app-tools.ts. This file:
//
//   • re-checks the AIR-GAP gate before EVERY internet reach (isPrimitiveEnabled over process.env) —
//     a disabled primitive degrades HONESTLY ({ ok:false, detail: 'disabled' }), it never reaches out;
//   • honors the tool ACTION-POLICY (allow | approval | blocked) — a blocked/approval primitive does
//     NOT execute autonomously (approval ⇒ deferred to a human, blocked ⇒ refused), mirroring the
//     registry tool policy already enforced elsewhere;
//   • returns a STRUCTURED result the caller records; never throws.
//
// SOLID: no business rules here — gating + cycle rules are imported from the pure modules. Only the
// reach itself (fetch) + the org policy lookup are I/O.

import { governedWebSearch, WEBSEARCH_URL_ENV } from '@/lib/adapters/web-search';
import {
  buildAppToolGraph,
  detectAppToolCycles,
  isAppToolRef,
  parseAppToolRef,
  wouldCreateCycle,
} from '@/lib/app-tools';
import {
  getPrimitive,
  isPrimitiveEnabled,
  isPrimitiveRef,
  parsePrimitiveRef,
  type EgressDecision,
  type ToolPrimitive,
} from '@/lib/tool-primitives';

// ─── env-var reconciliation (web_search endpoint) ─────────────────────────────────────────────────
// Two names for the SAME on-prem search endpoint existed: this adapter's legacy OFFGRID_WEB_SEARCH_URL
// and the governed seam's canonical OFFGRID_WEBSEARCH_URL (web-search.ts). We standardise on the
// CANONICAL name (WEBSEARCH_URL_ENV = OFFGRID_WEBSEARCH_URL) and keep OFFGRID_WEB_SEARCH_URL as a
// back-compat ALIAS: if only the legacy var is set, its value is copied onto the canonical key in the
// env snapshot handed to governedWebSearch, so existing deployments keep working unchanged.
export const WEBSEARCH_URL_ENV_LEGACY = 'OFFGRID_WEB_SEARCH_URL';

function reconcileWebSearchEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const canonical = (env[WEBSEARCH_URL_ENV] ?? '').trim();
  const legacy = (env[WEBSEARCH_URL_ENV_LEGACY] ?? '').trim();
  if (!canonical && legacy) {
    return { ...env, [WEBSEARCH_URL_ENV]: legacy };
  }
  return env;
}

// ─── The structured result of running a primitive ────────────────────────────────────────────────
export interface PrimitiveResult {
  ok: boolean;
  /** 'ran' | 'disabled' | 'blocked' | 'approval' | 'error' — the reason, honestly. */
  status: 'ran' | 'disabled' | 'blocked' | 'approval' | 'error';
  primitiveId: string;
  output?: string;
  detail: string;
}

// The action-policy a primitive inherits. Primitives default to 'approval' (safe): an operator can
// promote a specific primitive to 'allow' via the registry once they trust it. Passed in so the pure
// gate stays testable; the caller resolves it (e.g. from a registered tool row of the same name).
export type PrimitiveActionPolicy = 'allow' | 'approval' | 'blocked';

export interface RunPrimitiveOpts {
  params?: Record<string, unknown>;
  /** Action policy (allow|approval|blocked). Defaults to 'approval' — no autonomous egress. */
  policy?: PrimitiveActionPolicy;
  /** Env snapshot for the air-gap gate (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Injected fetch for testability (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * The pipeline EGRESS decision for this run's data-class (from enforceModelCall). Governs any
   * internet-reaching primitive (web_search) exactly like a cloud model call: 'local'/'block' REFUSE
   * external egress, 'cloud' permits it. Defaults to 'cloud' — the additive "no bound pipeline" rule
   * used across the run path, so behaviour is unchanged when no contract is threaded.
   */
  egress?: EgressDecision;
}

// ─── runPrimitive — execute ONE primitive under governance ────────────────────────────────────────
export async function runPrimitive(
  primitiveId: string,
  opts: RunPrimitiveOpts = {},
): Promise<PrimitiveResult> {
  const primitive = getPrimitive(primitiveId);
  if (!primitive) {
    return { ok: false, status: 'error', primitiveId, detail: `unknown primitive "${primitiveId}"` };
  }
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const policy = opts.policy ?? 'approval';

  // 1. Action policy — blocked never runs; approval is not run autonomously (a human must approve).
  if (policy === 'blocked') {
    return { ok: false, status: 'blocked', primitiveId, detail: `primitive "${primitive.id}" is blocked by policy` };
  }
  if (policy === 'approval') {
    return {
      ok: false,
      status: 'approval',
      primitiveId,
      detail: `primitive "${primitive.id}" needs approval before it runs (policy: approval)`,
    };
  }

  // 2. AIR-GAP gate — re-checked before every reach. A disabled internet primitive degrades honestly.
  if (!isPrimitiveEnabled(primitive, env)) {
    return {
      ok: false,
      status: 'disabled',
      primitiveId,
      detail: `${primitive.name} reaches the internet and is OFF on this deployment — set ${primitive.enableEnv ?? 'OFFGRID_TOOL_EGRESS'} to opt in`,
    };
  }

  // 3. Execute.
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    switch (primitive.id) {
      case 'web_search':
        return await execWebSearch(primitive, opts.params ?? {}, env, fetchImpl, opts.egress ?? 'cloud');
      case 'read_url':
        return await execReadUrl(primitive, opts.params ?? {}, fetchImpl);
      case 'http_fetch':
        return await execHttpFetch(primitive, opts.params ?? {}, fetchImpl);
      default:
        return { ok: false, status: 'error', primitiveId, detail: `primitive "${primitive.id}" has no executor` };
    }
  } catch (err) {
    return { ok: false, status: 'error', primitiveId, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ─── web_search — delegate to the FULLY GOVERNED seam (governedWebSearch) ─────────────────────────
// This no longer re-implements the reach inline. It delegates to governedWebSearch, which composes,
// in order, the SAME three gates that govern any internet reach:
//   1. the air-gap gate (opted in on this deploy?),
//   2. the pipeline EGRESS leash (webSearchEgressAllowed(egress) — a local-only/blocked pipeline
//      REFUSES the search exactly as it refuses a cloud model call),
//   3. the reach itself against the org-configured search endpoint.
// The `egress` decision is threaded down from enforceModelCall by the run path; 'cloud' is the
// additive default (no bound pipeline). The endpoint env name is reconciled to the canonical
// OFFGRID_WEBSEARCH_URL (OFFGRID_WEB_SEARCH_URL kept as a back-compat alias — see reconcileWebSearchEnv).
async function execWebSearch(
  primitive: ToolPrimitive,
  params: Record<string, unknown>,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  egress: EgressDecision,
): Promise<PrimitiveResult> {
  const query = String(params.query ?? '').trim();
  if (!query) return { ok: false, status: 'error', primitiveId: primitive.id, detail: 'web_search needs a query' };
  const count = Number(params.count ?? 5) || 5;

  const resp = await governedWebSearch(query, {
    egress,
    env: reconcileWebSearchEnv(env),
    fetchImpl,
    count,
  });

  // Map the governed response onto the primitive result contract. egress_blocked/disabled are
  // honest refusals ('blocked'/'disabled'); a configured-but-failed reach is 'error'; ok ⇒ 'ran'.
  if (resp.status === 'egress_blocked') {
    return { ok: false, status: 'blocked', primitiveId: primitive.id, detail: resp.detail };
  }
  if (resp.status === 'disabled') {
    return { ok: false, status: 'disabled', primitiveId: primitive.id, detail: resp.detail };
  }
  if (!resp.ok) {
    return { ok: false, status: 'error', primitiveId: primitive.id, detail: resp.detail };
  }
  const output = resp.results
    .map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet.slice(0, 200)}`)
    .join('\n');
  return {
    ok: true,
    status: 'ran',
    primitiveId: primitive.id,
    output: output || 'No results.',
    detail: `web_search: ${resp.results.length} result(s)`,
  };
}

// ─── read_url — fetch a single page, return readable-ish text (tags stripped) ─────────────────────
async function execReadUrl(
  primitive: ToolPrimitive,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<PrimitiveResult> {
  const url = String(params.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: 'error', primitiveId: primitive.id, detail: 'read_url needs an http(s) URL' };
  }
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { ok: false, status: 'error', primitiveId: primitive.id, detail: `read_url: ${res.status}` };
  const html = await res.text();
  const text = stripHtml(html).slice(0, 4000);
  return { ok: true, status: 'ran', primitiveId: primitive.id, output: text, detail: `read_url: ${text.length} chars` };
}

// ─── http_fetch — raw HTTP GET/POST, body returned verbatim (truncated) ───────────────────────────
async function execHttpFetch(
  primitive: ToolPrimitive,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<PrimitiveResult> {
  const url = String(params.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: 'error', primitiveId: primitive.id, detail: 'http_fetch needs an http(s) URL' };
  }
  const method = String(params.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  const body = method === 'POST' ? String(params.body ?? '') : undefined;
  const res = await fetchImpl(url, { method, body, signal: AbortSignal.timeout(8000) });
  const out = (await res.text()).slice(0, 4000);
  return { ok: res.ok, status: res.ok ? 'ran' : 'error', primitiveId: primitive.id, output: out, detail: `http_fetch ${method}: ${res.status}` };
}

// Minimal HTML → text: drop script/style, strip tags, collapse whitespace. Not a full reader, but
// enough for an agent to reason over a page's content.
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── invokeAppTool — the I/O bridge: run an app-as-tool, return a structured result ──────────────
// Server-only (imports the store + executor). It:
//   1. loads the target app (org-scoped) — refuses if missing/unpublished,
//   2. re-checks the PURE cycle guards (from app-tools.ts) against the org's apps — a saved cyclic
//      spec can NEVER actually recurse,
//   3. runs the app via submitAppRun (the SAME governed entry point every trigger uses),
//   4. returns the app's aggregate outcome as a structured tool result.
// NEVER throws — a failure returns { ok:false, detail } so the caller records an honest miss.
export interface AppToolResult {
  ok: boolean;
  appId: string;
  runId?: string;
  output?: string;
  detail: string;
}

export interface InvokeAppToolCtx {
  orgId: string;
  actor?: string;
  /** The id of the app whose step is invoking this tool — used for the run-time cycle guard. */
  callerAppId?: string;
  /** Bound on how deep app→app composition may go, belt-and-braces against runaway nesting. */
  depth?: number;
}

const MAX_APP_TOOL_DEPTH = 3;

export async function invokeAppTool(
  appId: string,
  query: string,
  ctx: InvokeAppToolCtx,
): Promise<AppToolResult> {
  try {
    if (ctx.depth !== undefined && ctx.depth >= MAX_APP_TOOL_DEPTH) {
      return { ok: false, appId, detail: `app-tool depth limit (${MAX_APP_TOOL_DEPTH}) reached — refusing to nest deeper` };
    }
    const { getApp, listApps } = await import('@/lib/apps-store');
    const target = await getApp(appId, ctx.orgId);
    if (!target) return { ok: false, appId, detail: `app tool "${appId}" not found in org` };
    if (!target.published) return { ok: false, appId, detail: `app tool "${appId}" is not published` };

    // Run-time cycle guard: rebuild the graph over the org's apps and refuse if invoking this app
    // from the caller would loop (or if the target itself sits on a cycle).
    const specs = await listApps(ctx.orgId);
    const graph = buildAppToolGraph(specs);
    if (ctx.callerAppId) {
      if (!graph.has(ctx.callerAppId)) graph.set(ctx.callerAppId, new Set());
      if (wouldCreateCycle(graph, ctx.callerAppId, appId)) {
        return { ok: false, appId, detail: `refused: invoking app "${appId}" from "${ctx.callerAppId}" would create a cycle` };
      }
    }
    const cycles = detectAppToolCycles(graph);
    if (cycles.some((c) => c.includes(appId))) {
      return { ok: false, appId, detail: `refused: app "${appId}" is part of a composition cycle (${cycles[0].join(' → ')})` };
    }

    const { submitAppRun } = await import('@/lib/adapters/apprun');
    const { newAppRunId } = await import('@/lib/app-run');
    const runId = newAppRunId();
    const handle = await submitAppRun(target, { query }, { orgId: ctx.orgId, actor: ctx.actor, runId });
    const output = handle.outcome?.outcome;
    return {
      ok: handle.outcome ? handle.outcome.status === 'done' : handle.submitted,
      appId,
      runId: handle.runId,
      output,
      detail: `ran app "${target.title}" → ${handle.outcome?.status ?? handle.status ?? 'submitted'}`,
    };
  } catch (err) {
    return { ok: false, appId, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ─── maybeRunComposableTool — THE ONE-LINE HOOK for the agent pipeline ────────────────────────────
//
// The least-invasive wiring. The agent pipeline (agentrun.ts) already routes to a `tool:<id>` hit and
// calls `maybeRunSandboxTool(ref, mark)`. To make PRIMITIVES + APPS callable through the same seam,
// the app-run/agentrun owner adds ONE call next to that line:
//
//     await maybeRunComposableTool(ref, { orgId, actor, callerAppId }, mark);
//
// This function no-ops for a `tool:<id>` (registry tool — handled by maybeRunSandboxTool) and for any
// unknown ref, and only acts on `prim:<id>` (run the primitive) or `app:<id>` (run the app-as-tool).
// It resolves the action-policy for a primitive from the registry (a registered tool of the same name
// may set allow/approval/blocked), defaulting to 'approval'. `mark` is the same tracer the pipeline
// uses so the reach shows up as a step in the run trace.
export type Mark = (kind: string, label: string, detail: string, refs: string[], start: number) => void;

export interface ComposableToolCtx {
  orgId: string;
  actor?: string;
  /** The id of the app whose agent step is calling — enables the app→app cycle guard. */
  callerAppId?: string;
  /**
   * The pipeline EGRESS decision for this run (from the caller's enforceModelCall verdict). Threaded
   * into any internet-reaching primitive so web_search is leashed identically to a cloud model call.
   * Default 'cloud' — the additive "no bound pipeline" rule (unchanged behaviour when unset).
   */
  egress?: EgressDecision;
}

export async function maybeRunComposableTool(
  ref: string,
  ctx: ComposableToolCtx,
  mark?: Mark,
  query = '',
): Promise<PrimitiveResult | { ok: boolean; detail: string } | null> {
  const t = Date.now();
  // Primitive?
  if (isPrimitiveRef(ref)) {
    const id = parsePrimitiveRef(ref)!;
    const policy = await resolvePrimitivePolicy(id, ctx.orgId);
    const result = await runPrimitive(id, { policy, egress: ctx.egress ?? 'cloud' });
    mark?.('tool', `prim:${id}`, result.detail, [ref], t);
    return result;
  }
  // App-as-tool?
  if (isAppToolRef(ref)) {
    const appId = parseAppToolRef(ref)!;
    const result = await invokeAppTool(appId, query, {
      orgId: ctx.orgId,
      actor: ctx.actor,
      callerAppId: ctx.callerAppId,
    });
    mark?.('tool', `app:${appId}`, result.detail, [ref], t);
    return { ok: result.ok, detail: result.detail };
  }
  // A registry `tool:<id>` or anything else — not ours (maybeRunSandboxTool owns tool refs).
  return null;
}

// Resolve a primitive's action-policy: if the org registered a tool whose name matches the primitive
// id (or `prim:<id>`), use its policy; otherwise the safe default 'approval'. Lazy import keeps this
// adapter off the default bundle + testable.
async function resolvePrimitivePolicy(
  primitiveId: string,
  orgId: string,
): Promise<PrimitiveActionPolicy> {
  try {
    const { listTools } = await import('@/lib/store');
    const tools = await listTools(orgId);
    const match = tools.find(
      (x) => x.id === primitiveId || x.name === primitiveId || x.endpoint === `prim:${primitiveId}`,
    );
    return (match?.policy as PrimitiveActionPolicy) ?? 'approval';
  } catch {
    return 'approval';
  }
}
