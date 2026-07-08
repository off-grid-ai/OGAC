// ─── Runs monitor — PURE aggregation/normalization for the unified Operations → Runs surface ─────
//
// The console runs jobs on three planes — Apps (multi-step workflows), Agents (single agent
// answers), and Chat (governed chat turns) — each with its OWN durable record shape and its own
// status vocabulary. This module is the ZERO-I/O rule layer that MERGES those three shapes into one
// normalized `RunRow[]`, normalizes every source's status into ONE product-facing vocabulary, and
// provides the sort / filter / paginate helpers the list surface + API use.
//
// It imports NOTHING (no DB, no Next, no adapters) so it is unit-testable in isolation and client-
// safe. The thin I/O reader (runs-monitor-reader.ts) queries the three sources and feeds their rows
// through the `from*` mappers here; the page + API only ever see `RunRow`.
//
// Status vocabulary (product language — NO engine/Temporal terms):
//   queued | running | paused | succeeded | failed | cancelled
// "paused" is the human-in-the-loop hold (an app step awaiting a reviewer). Anything unrecognized
// falls back to 'running' if the row looks live, else surfaces the raw value verbatim (honest).

export type RunKind = 'app' | 'agent' | 'chat';

export type RunStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';

// ─── The one normalized row every consumer sees ──────────────────────────────────────────────────
export interface RunRow {
  /** Unique within its kind; the API key is `${kind}:${id}`, exposed as `key`. */
  id: string;
  key: string;
  kind: RunKind;
  /** Human name for the job — the app title / agent id / conversation, resolved by the reader. */
  name: string;
  /** Normalized product status. */
  status: RunStatus;
  /** Raw source status, kept for honesty/debugging (never shown as the primary label). */
  rawStatus: string;
  /** ISO start; null when unknown. */
  startedAt: string | null;
  /** ISO finish; null while live or unknown. */
  finishedAt: string | null;
  /** Duration ms when both ends known; null otherwise. */
  durationMs: number | null;
  /** The pipeline / workflow this run belongs to (app id, agent id, or conversation ref). */
  pipeline: string;
  /** Who ran it — user email / actor label / 'system'; '' when unknown. */
  actor: string;
  /** Deep-link to the run's detail. App runs reuse the per-app run page; agent/chat use the
   *  generic Operations run detail. Computed by the mapper so the row is self-describing. */
  href: string;
}

// ─── Status normalization — each plane's vocabulary → the one product vocabulary ─────────────────
// App runs:   queued|running|awaiting_human|done|error|cancelled
// Agent runs: done|error|blocked|running (mostly 'done' today)
// Chat runs:  (audit outcome) ok|blocked|redacted  +  run status done|blocked|error
const TERMINAL_OK = new Set(['done', 'ok', 'succeeded', 'complete', 'completed', 'redacted']);
const TERMINAL_FAIL = new Set(['error', 'failed', 'blocked', 'denied']);
const CANCELLED = new Set(['cancelled', 'canceled', 'aborted']);
const PAUSED = new Set(['awaiting_human', 'paused', 'awaiting_review', 'awaiting-review']);
const QUEUED = new Set(['queued', 'pending', 'scheduled']);
const RUNNING = new Set(['running', 'in_progress', 'in-progress', 'active']);

export function normalizeStatus(raw: string | null | undefined): RunStatus {
  const s = (raw ?? '').trim().toLowerCase();
  if (CANCELLED.has(s)) return 'cancelled';
  if (PAUSED.has(s)) return 'paused';
  if (TERMINAL_FAIL.has(s)) return 'failed';
  if (TERMINAL_OK.has(s)) return 'succeeded';
  if (QUEUED.has(s)) return 'queued';
  if (RUNNING.has(s)) return 'running';
  // Unknown status: don't crash and don't lie — treat as running (it's some live state we don't
  // model yet); the rawStatus field preserves the truth for the UI to show verbatim.
  return 'running';
}

const STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Awaiting review',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function statusLabel(status: RunStatus): string {
  return STATUS_LABELS[status];
}

const KIND_LABELS: Record<RunKind, string> = { app: 'App', agent: 'Agent', chat: 'Chat' };
export function kindLabel(kind: RunKind): string {
  return KIND_LABELS[kind];
}

export function isLive(status: RunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}

// ─── Duration — ms between two ISO timestamps, or null when either is missing/invalid ─────────────
export function computeDurationMs(
  startedAt: string | null,
  finishedAt: string | null,
): number | null {
  if (!startedAt || !finishedAt) return null;
  const a = Date.parse(startedAt);
  const b = Date.parse(finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

export function describeDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

// ─── Source row shapes the mappers accept (mirror the DB rows; kept local so this stays import-free) ─

export interface AppRunSource {
  id: string;
  appId: string;
  status: string;
  /** Steps let us count progress AND detect a mid-workflow human pause the top-level status missed. */
  steps?: { status?: string }[];
  startedAt?: string | null;
  finishedAt?: string | null;
  /** The trigger actor / input owner, when the reader can resolve one. */
  actor?: string | null;
  /** Resolved app title; falls back to the app id. */
  title?: string | null;
}

export interface AgentRunSource {
  id: string;
  agentId: string;
  status: string;
  startedAt?: string | null;
  /** Agent runs record no explicit finish; the reader may pass one, else duration is unknown. */
  finishedAt?: string | null;
  actor?: string | null;
}

export interface ChatRunSource {
  /** The run id (audit run_id). May be absent on legacy events; the reader filters those out. */
  runId: string;
  /** conversation ref / title, when known. */
  conversation?: string | null;
  /** audit outcome (ok|blocked|redacted) OR a run status — normalized the same way. */
  outcome: string;
  ts?: string | null;
  actor?: string | null;
  model?: string | null;
}

// ─── from* mappers — one source row → one normalized RunRow ───────────────────────────────────────

/** An app run has a human pause if the top status says so OR any step is awaiting_human. */
function appRunStatus(src: AppRunSource): { status: RunStatus; raw: string } {
  const top = src.status.toLowerCase();
  const stepPaused = (src.steps ?? []).some((s) => PAUSED.has((s.status ?? '').toLowerCase()));
  if (stepPaused && !CANCELLED.has(top) && !TERMINAL_FAIL.has(top)) {
    return { status: 'paused', raw: src.status };
  }
  return { status: normalizeStatus(src.status), raw: src.status };
}

export function fromAppRun(src: AppRunSource): RunRow {
  const { status, raw } = appRunStatus(src);
  const startedAt = src.startedAt ?? null;
  const finishedAt = src.finishedAt ?? null;
  return {
    id: src.id,
    key: `app:${src.id}`,
    kind: 'app',
    name: (src.title ?? '').trim() || src.appId,
    status,
    rawStatus: raw,
    startedAt,
    finishedAt,
    durationMs: computeDurationMs(startedAt, finishedAt),
    pipeline: src.appId,
    actor: (src.actor ?? '').trim(),
    href: `/build/apps/${encodeURIComponent(src.appId)}/runs/${encodeURIComponent(src.id)}`,
  };
}

export function fromAgentRun(src: AgentRunSource): RunRow {
  const startedAt = src.startedAt ?? null;
  const finishedAt = src.finishedAt ?? null;
  return {
    id: src.id,
    key: `agent:${src.id}`,
    kind: 'agent',
    name: src.agentId,
    status: normalizeStatus(src.status),
    rawStatus: src.status,
    startedAt,
    finishedAt,
    durationMs: computeDurationMs(startedAt, finishedAt),
    pipeline: src.agentId,
    actor: (src.actor ?? '').trim(),
    href: `/operations/runs/${encodeURIComponent(`agent:${src.id}`)}`,
  };
}

export function fromChatRun(src: ChatRunSource): RunRow {
  const startedAt = src.ts ?? null;
  return {
    id: src.runId,
    key: `chat:${src.runId}`,
    kind: 'chat',
    name: (src.conversation ?? '').trim() || 'Chat',
    status: normalizeStatus(src.outcome),
    rawStatus: src.outcome,
    startedAt,
    // A chat turn is a single audited event — we leave finishedAt null so we don't fabricate a
    // duration for a near-instant ledger event.
    finishedAt: null,
    durationMs: null,
    pipeline: (src.model ?? '').trim() || 'chat',
    actor: (src.actor ?? '').trim(),
    href: `/operations/runs/${encodeURIComponent(`chat:${src.runId}`)}`,
  };
}

// ─── merge — three source lists → one RunRow[], newest first ──────────────────────────────────────
export function mergeRuns(input: {
  app?: AppRunSource[];
  agent?: AgentRunSource[];
  chat?: ChatRunSource[];
}): RunRow[] {
  const rows: RunRow[] = [
    ...(input.app ?? []).map(fromAppRun),
    ...(input.agent ?? []).map(fromAgentRun),
    ...(input.chat ?? []).map(fromChatRun),
  ];
  return sortRuns(rows);
}

// ─── sort — newest first; rows with no start sink to the bottom (stable by key) ───────────────────
export function sortRuns(rows: RunRow[]): RunRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.startedAt ? Date.parse(a.startedAt) : -Infinity;
    const tb = b.startedAt ? Date.parse(b.startedAt) : -Infinity;
    if (tb !== ta) return tb - ta;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// ─── filter — by kind, status, and a free-text query over name/pipeline/actor/id ──────────────────
export interface RunFilter {
  kind?: RunKind | 'all';
  status?: RunStatus | 'all';
  q?: string;
}

export function filterRuns(rows: RunRow[], f: RunFilter): RunRow[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.kind && f.kind !== 'all' && r.kind !== f.kind) return false;
    if (f.status && f.status !== 'all' && r.status !== f.status) return false;
    if (q) {
      const hay = `${r.name} ${r.pipeline} ${r.actor} ${r.id} ${r.rawStatus}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ─── paginate — offset/limit window + total, for the list surface + API ───────────────────────────
export interface Page<T> {
  rows: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export function paginate<T>(rows: T[], offset = 0, limit = 50): Page<T> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;
  const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const window = rows.slice(safeOffset, safeOffset + safeLimit);
  return {
    rows: window,
    total: rows.length,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + window.length < rows.length,
  };
}

// ─── summarize — counts by status, for the header band ────────────────────────────────────────────
export function summarizeRuns(rows: RunRow[]): {
  total: number;
  live: number;
  byStatus: Record<RunStatus, number>;
  byKind: Record<RunKind, number>;
} {
  const byStatus: Record<RunStatus, number> = {
    queued: 0,
    running: 0,
    paused: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  const byKind: Record<RunKind, number> = { app: 0, agent: 0, chat: 0 };
  let live = 0;
  for (const r of rows) {
    byStatus[r.status] += 1;
    byKind[r.kind] += 1;
    if (isLive(r.status)) live += 1;
  }
  return { total: rows.length, live, byStatus, byKind };
}

// ─── parse helpers for the API/page (defensive coercion of query params) ──────────────────────────
export const RUN_KINDS: RunKind[] = ['app', 'agent', 'chat'];
export const RUN_STATUSES: RunStatus[] = [
  'queued',
  'running',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
];

export function parseKind(v: string | null | undefined): RunKind | 'all' {
  return v && (RUN_KINDS as string[]).includes(v) ? (v as RunKind) : 'all';
}

export function parseStatus(v: string | null | undefined): RunStatus | 'all' {
  return v && (RUN_STATUSES as string[]).includes(v) ? (v as RunStatus) : 'all';
}
