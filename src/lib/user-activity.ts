// PURE user-activity aggregation — zero I/O, zero app-code imports, fully unit-testable. This is the
// governance/audit lens behind the admin "see exactly what a given user did" surface: every prompt
// they sent, chat turn, retrieval query, and app/agent run, merged into ONE time-ordered stream with
// the governance verdict + a content snippet on each item.
//
// The network reads (OpenSearch audit + Postgres chat/app/agent runs) live in
// `user-activity-reader.ts`; the thin route calls that, then hands the raw rows here. This file NEVER
// fetches. Keeping the merge/normalize/filter/paginate/rollup pure means the whole "what did user X
// do" story is exhaustively testable with plain in-memory rows — no DB, no auth chain, no mocks.

// ── Raw inputs — one loose shape per source, everything optional/defensive ────────────────────────

// A canonical attributed audit event (audit_events_v2 / the shipped OpenSearch doc). This is the
// spine: it carries WHO (actorId), WHAT (action), the VERDICT (outcome), WHEN (ts), and the
// correlation keys (runId, resource) we enrich content from. It does NOT carry prompt text.
export interface RawAuditRow {
  ts?: string; // ISO-8601
  actorId?: string;
  actorLabel?: string;
  org?: string;
  project?: string | null;
  action?: string; // canonical AuditAction (chat.run, agent.run, retrieval.query, policy.change, ...)
  resource?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  outcome?: string; // ok | blocked | redacted | denied | error
  runId?: string | null;
}

// A chat turn (chat_messages joined to chat_conversations). Carries the REAL prompt/answer content.
export interface RawChatRow {
  messageId?: string;
  conversationId?: string;
  conversationTitle?: string | null;
  role?: string; // user | assistant | system
  content?: string | null;
  model?: string | null;
  ts?: string; // created_at ISO
}

// A governed agent run (agent_runs). Carries the query + answer + guardrail checks.
export interface RawAgentRunRow {
  id?: string;
  agentId?: string | null;
  query?: string | null;
  answer?: string | null;
  status?: string;
  model?: string | null;
  checks?: { name?: string; verdict?: string; detail?: string }[] | null;
  ts?: string; // started_at ISO
}

// An app/workflow run (app_runs). Carries the trigger input + aggregated outcome.
export interface RawAppRunRow {
  id?: string;
  appId?: string | null;
  status?: string;
  input?: Record<string, unknown> | null;
  outcome?: string | null;
  ts?: string; // started_at ISO
}

export interface RawUserActivity {
  audit: RawAuditRow[];
  chat: RawChatRow[];
  agentRuns: RawAgentRunRow[];
  appRuns: RawAppRunRow[];
}

// ── Output model ─────────────────────────────────────────────────────────────────────────────────

// The kinds a UI can filter/badge on. `action` is the raw canonical action for the "other" bucket.
export type ActivityKind =
  | 'chat' // a chat prompt/turn the user sent
  | 'agent-run' // a governed agent run the user fired
  | 'app-run' // an app/workflow run the user triggered
  | 'query' // a retrieval / data query
  | 'governance' // a config-change / access / policy action the user performed
  | 'action'; // any other attributed action

export type ActivityVerdict = 'allowed' | 'blocked' | 'redacted' | 'denied' | 'error' | 'unknown';

export interface UserActivity {
  id: string; // stable per-item id (runId / messageId / synthesized)
  ts: string; // ISO-8601, always present after normalization
  kind: ActivityKind;
  action: string; // the raw canonical action (chat.run, retrieval.query, policy.change, ...)
  summary: string; // one-line human summary ("Sent a chat message", "Ran agent invoice-triage")
  content: string; // the REAL content snippet — the prompt text / query / input, verbatim (trimmed)
  resource: string; // what it acted on (conversation:…, agent:…, app:…, policy:…)
  project: string; // project/collection scope, when known
  model: string; // model that served it, when known
  verdict: ActivityVerdict; // the governance outcome
  tokens: number; // total tokens, when known
  costUsd: number; // cost in USD, when known
  runId: string; // correlation id, when this item is a run
  source: 'audit' | 'chat' | 'agent-run' | 'app-run'; // which raw source produced it
}

export interface ActivityFilters {
  kind?: ActivityKind | 'all';
  verdict?: ActivityVerdict | 'all';
  q?: string; // free text over summary + content + resource
  from?: string; // ISO lower bound (inclusive)
  to?: string; // ISO upper bound (inclusive)
  page?: number; // 1-based
  size?: number;
}

export interface ActivityRollup {
  total: number; // total items (after filtering)
  byKind: Record<ActivityKind, number>;
  blocked: number; // guardrail/policy refusals (blocked + denied + error)
  redacted: number; // PII-masked turns
  tokens: number;
  costUsd: number;
  firstTs: string | null; // earliest activity in the set
  lastTs: string | null; // most recent
  models: string[]; // distinct models the user touched
}

export interface ActivityPage {
  items: UserActivity[]; // this page, newest-first
  total: number; // total after filtering (drives pagination)
  page: number;
  size: number;
  rollup: ActivityRollup; // rollup over the FILTERED set (minus pagination)
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
const SNIPPET_MAX = 600;

// ── Helpers (pure) ───────────────────────────────────────────────────────────────────────────────

function toIso(ts: string | undefined | null): string {
  if (typeof ts === 'string' && ts.trim()) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}

function trim(s: string | null | undefined): string {
  return typeof s === 'string' ? s.trim() : '';
}

function snippet(s: string | null | undefined): string {
  const v = trim(s).replace(/\s+/g, ' ');
  return v.length > SNIPPET_MAX ? v.slice(0, SNIPPET_MAX) + '…' : v;
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Normalize any producer's outcome string onto the canonical verdict the UI badges.
export function normalizeVerdict(raw: string | null | undefined): ActivityVerdict {
  const v = trim(raw).toLowerCase();
  if (['ok', 'allow', 'allowed', 'success', 'succeeded', 'done', 'completed', 'permit'].includes(v))
    return 'allowed';
  if (['redact', 'redacted', 'masked'].includes(v)) return 'redacted';
  if (['block', 'blocked', 'quarantined'].includes(v)) return 'blocked';
  if (['deny', 'denied', 'reject', 'rejected', 'forbidden', 'unauthorized', 'cancelled'].includes(v))
    return 'denied';
  if (['error', 'failed', 'failure', 'exception'].includes(v)) return 'error';
  return 'unknown';
}

// Map a canonical audit action onto an activity kind. The content-bearing sources (chat/agent/app)
// have their own kinds; the audit-only actions fall into query / governance / action buckets.
export function kindFromAction(action: string | null | undefined): ActivityKind {
  const a = trim(action).toLowerCase();
  if (a === 'chat.run' || a === 'chat.send') return 'chat';
  if (a === 'agent.run') return 'agent-run';
  if (a === 'workflow.run' || a === 'app.run.review') return 'app-run';
  if (a === 'retrieval.query' || a === 'connector.sync') return 'query';
  // Everything that mutates governed config / access / policy is a governance action.
  if (
    a.startsWith('policy.') ||
    a.startsWith('abac.') ||
    a.startsWith('guardrail.') ||
    a.startsWith('masking.') ||
    a.startsWith('routing.') ||
    a.startsWith('access.') ||
    a.startsWith('pipeline.') ||
    a.startsWith('team.') ||
    a.startsWith('gateway.') ||
    a.startsWith('exporter.') ||
    a.startsWith('connector.') ||
    a.startsWith('org.') ||
    a.startsWith('tenant.') ||
    a.startsWith('fleet.') ||
    a === 'secret.write' ||
    a === 'flag.toggle' ||
    a === 'budget.deny' ||
    a === 'data.erasure' ||
    a === 'device.kill' ||
    a === 'backup.run'
  )
    return 'governance';
  return 'action';
}

// A readable, product-language summary of an audit action (NO OSS engine names — product terms only).
function summarizeAction(action: string, kind: ActivityKind, resource: string): string {
  const a = trim(action).toLowerCase();
  const on = resource ? ` on ${resource}` : '';
  switch (a) {
    case 'chat.run':
    case 'chat.send':
      return 'Sent a chat message';
    case 'agent.run':
      return `Ran an agent${on}`;
    case 'workflow.run':
      return `Ran a workflow${on}`;
    case 'retrieval.query':
      return 'Ran a knowledge query';
    case 'connector.sync':
      return `Synced a data source${on}`;
    case 'budget.deny':
      return 'Blocked by a spend limit';
    case 'data.erasure':
      return 'Ran a data-erasure request';
    case 'secret.write':
      return 'Wrote a secret';
    case 'flag.toggle':
      return 'Toggled a feature flag';
  }
  if (kind === 'governance') return `Changed configuration (${action})${on}`;
  return `${action}${on}`;
}

// ── Normalizers: one raw source → UserActivity[] ─────────────────────────────────────────────────

// Audit is the spine. Every attributed action becomes an item; content is filled by merge with a
// content-bearing source (chat/agent/app) sharing the same runId when that source is present.
export function normalizeAuditRows(rows: RawAuditRow[]): UserActivity[] {
  const out: UserActivity[] = [];
  for (const r of rows) {
    const ts = toIso(r.ts);
    if (!ts) continue;
    const action = trim(r.action) || 'action';
    const kind = kindFromAction(action);
    const resource = trim(r.resource);
    out.push({
      id: trim(r.runId) || `audit:${ts}:${action}:${resource}`,
      ts,
      kind,
      action,
      summary: summarizeAction(action, kind, resource),
      content: '',
      resource,
      project: trim(r.project),
      model: trim(r.model),
      verdict: normalizeVerdict(r.outcome),
      tokens: num(r.totalTokens),
      costUsd: num(r.costUsd),
      runId: trim(r.runId),
      source: 'audit',
    });
  }
  return out;
}

function verdictFromChecks(
  checks: { verdict?: string }[] | null | undefined,
  status: string | undefined,
): ActivityVerdict {
  if (Array.isArray(checks)) {
    const verdicts = checks.map((c) => trim(c.verdict).toLowerCase());
    if (verdicts.some((v) => ['block', 'blocked', 'fail', 'failed'].includes(v))) return 'blocked';
    if (verdicts.some((v) => ['redact', 'redacted', 'masked'].includes(v))) return 'redacted';
  }
  return normalizeVerdict(status);
}

export function normalizeChatRows(rows: RawChatRow[]): UserActivity[] {
  const out: UserActivity[] = [];
  for (const r of rows) {
    // Only the user's OWN prompts are "what the user did" — assistant/system turns are the reply.
    if (trim(r.role).toLowerCase() !== 'user') continue;
    const ts = toIso(r.ts);
    if (!ts) continue;
    const convo = trim(r.conversationId);
    const title = trim(r.conversationTitle);
    out.push({
      id: trim(r.messageId) || `chat:${ts}:${convo}`,
      ts,
      kind: 'chat',
      action: 'chat.send',
      summary: title ? `Chat: ${title}` : 'Sent a chat message',
      content: snippet(r.content),
      resource: convo ? `conversation:${convo}` : '',
      project: '',
      model: trim(r.model),
      verdict: 'allowed',
      tokens: 0,
      costUsd: 0,
      runId: '',
      source: 'chat',
    });
  }
  return out;
}

export function normalizeAgentRunRows(rows: RawAgentRunRow[]): UserActivity[] {
  const out: UserActivity[] = [];
  for (const r of rows) {
    const ts = toIso(r.ts);
    if (!ts) continue;
    const id = trim(r.id);
    const agent = trim(r.agentId);
    out.push({
      id: id || `agent-run:${ts}`,
      ts,
      kind: 'agent-run',
      action: 'agent.run',
      summary: agent ? `Ran agent ${agent}` : 'Ran an agent',
      content: snippet(r.query),
      resource: agent ? `agent:${agent}` : '',
      project: '',
      model: trim(r.model),
      verdict: verdictFromChecks(r.checks, r.status),
      tokens: 0,
      costUsd: 0,
      runId: id,
      source: 'agent-run',
    });
  }
  return out;
}

function appInputSnippet(input: Record<string, unknown> | null | undefined): string {
  if (!input || typeof input !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}: ${val}`);
  }
  return snippet(parts.join(' · '));
}

export function normalizeAppRunRows(rows: RawAppRunRow[]): UserActivity[] {
  const out: UserActivity[] = [];
  for (const r of rows) {
    const ts = toIso(r.ts);
    if (!ts) continue;
    const id = trim(r.id);
    const app = trim(r.appId);
    out.push({
      id: id || `app-run:${ts}`,
      ts,
      kind: 'app-run',
      action: 'workflow.run',
      summary: app ? `Ran app ${app}` : 'Ran an app',
      content: appInputSnippet(r.input),
      resource: app ? `app:${app}` : '',
      project: '',
      model: '',
      verdict: normalizeVerdict(r.status),
      tokens: 0,
      costUsd: 0,
      runId: id,
      source: 'app-run',
    });
  }
  return out;
}

// ── Merge: dedupe by runId, prefer the content-bearing source, keep the audit verdict ─────────────
// The audit spine and the content sources overlap on runId (a chat.run audit event AND the chat
// messages; an agent.run audit event AND the agent_runs row). We MERGE those into one item so the
// stream isn't doubled: the content source supplies the prompt/query text; the audit event supplies
// the governance verdict + tokens + cost. When only one side exists, that item stands alone.
export function mergeActivity(raw: RawUserActivity): UserActivity[] {
  const audit = normalizeAuditRows(raw.audit);
  const content = [
    ...normalizeChatRows(raw.chat),
    ...normalizeAgentRunRows(raw.agentRuns),
    ...normalizeAppRunRows(raw.appRuns),
  ];

  // Index audit items by runId (only the ones that carry a runId can correlate to a content row).
  const auditByRun = new Map<string, UserActivity>();
  for (const a of audit) if (a.runId) auditByRun.set(a.runId, a);

  const merged: UserActivity[] = [];
  const consumedAuditRuns = new Set<string>();

  for (const c of content) {
    const a = c.runId ? auditByRun.get(c.runId) : undefined;
    if (a) {
      consumedAuditRuns.add(c.runId);
      // Content wins for the prompt/query text + model; audit wins for verdict + tokens + cost.
      merged.push({
        ...c,
        summary: c.summary || a.summary,
        content: c.content || a.content,
        project: c.project || a.project,
        model: c.model || a.model,
        verdict: a.verdict !== 'unknown' ? a.verdict : c.verdict,
        tokens: a.tokens || c.tokens,
        costUsd: a.costUsd || c.costUsd,
        resource: c.resource || a.resource,
      });
    } else {
      merged.push(c);
    }
  }

  // Audit items with no content counterpart stand alone (governance actions, queries, and any run
  // whose content row wasn't fetched — e.g. content source down).
  for (const a of audit) {
    if (a.runId && consumedAuditRuns.has(a.runId)) continue;
    merged.push(a);
  }

  // Newest-first, stable on id for equal timestamps.
  merged.sort((x, y) => {
    const d = y.ts.localeCompare(x.ts);
    return d !== 0 ? d : x.id.localeCompare(y.id);
  });
  return merged;
}

// ── Filter (pure) ────────────────────────────────────────────────────────────────────────────────
export function filterActivity(items: UserActivity[], f: ActivityFilters): UserActivity[] {
  const kind = f.kind && f.kind !== 'all' ? f.kind : null;
  const verdict = f.verdict && f.verdict !== 'all' ? f.verdict : null;
  const q = trim(f.q).toLowerCase();
  const from = f.from && !Number.isNaN(Date.parse(f.from)) ? new Date(f.from).toISOString() : null;
  const to = f.to && !Number.isNaN(Date.parse(f.to)) ? new Date(f.to).toISOString() : null;
  return items.filter((it) => {
    if (kind && it.kind !== kind) return false;
    if (verdict && it.verdict !== verdict) return false;
    if (from && it.ts < from) return false;
    if (to && it.ts > to) return false;
    if (q) {
      const hay = `${it.summary} ${it.content} ${it.resource} ${it.action}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ── Rollup (pure) — the summary band over the filtered set ────────────────────────────────────────
export function rollupActivity(items: UserActivity[]): ActivityRollup {
  const byKind: Record<ActivityKind, number> = {
    chat: 0,
    'agent-run': 0,
    'app-run': 0,
    query: 0,
    governance: 0,
    action: 0,
  };
  let blocked = 0;
  let redacted = 0;
  let tokens = 0;
  let costUsd = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  const models = new Set<string>();

  for (const it of items) {
    byKind[it.kind] += 1;
    if (it.verdict === 'blocked' || it.verdict === 'denied' || it.verdict === 'error') blocked += 1;
    if (it.verdict === 'redacted') redacted += 1;
    tokens += it.tokens;
    costUsd += it.costUsd;
    if (it.model) models.add(it.model);
    if (!firstTs || it.ts < firstTs) firstTs = it.ts;
    if (!lastTs || it.ts > lastTs) lastTs = it.ts;
  }

  return {
    total: items.length,
    byKind,
    blocked,
    redacted,
    tokens,
    costUsd: Number(costUsd.toFixed(4)),
    firstTs,
    lastTs,
    models: [...models].sort(),
  };
}

// ── The one entry point: merge → filter → rollup → paginate ───────────────────────────────────────
export function buildActivityPage(raw: RawUserActivity, f: ActivityFilters = {}): ActivityPage {
  const merged = mergeActivity(raw);
  const filtered = filterActivity(merged, f);
  const rollup = rollupActivity(filtered);

  const page = f.page && f.page >= 1 ? Math.trunc(f.page) : 1;
  const size = Math.min(Math.max(1, Math.trunc(f.size ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);
  const start = (page - 1) * size;
  const items = filtered.slice(start, start + size);

  return { items, total: filtered.length, page, size, rollup };
}
