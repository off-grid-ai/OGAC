// DSAR / right-to-erasure — the PURE erasure PLANNER, plus an executor seam.
//
// A data-subject-access request to erase a subject must cross every store that references that
// subject. Historically the console only REPORTED the sensitive-dataset scope (eraseSubjectScope in
// store.ts) and left propagation stubbed. This module makes erasure honest:
//
//   1. planErasure(subject, catalog) — PURE, zero-I/O, unit-testable. Given a subject id and the
//      catalog of subject-bearing tables (table + the column that holds the subject reference + the
//      match kind), it returns the erasure PLAN: exactly which tables/columns will be matched and
//      how. The plan is the auditable, reviewable artifact — you can show an operator precisely what
//      an erasure WILL touch before it runs, and it is fully testable without a DB.
//
//   2. The route (src/app/api/v1/admin/erasure/route.ts) executes the plan against the tables it can
//      reach through the console's own drizzle `db` handle — WITHOUT editing store.ts (owned by the
//      store/schema agent). Vector-index + external-lake propagation that genuinely requires new
//      store.ts seams is reported as `deferred` in the plan rather than silently skipped.
//
// SOLID: the rule (what erasure means) lives here, pure; the I/O (running the DELETEs) is a thin
// executor in the route. DRY: one catalog, one matcher.

// ── The catalog: which columns hold a subject reference, and how they match ────────────────────
// `email`   — the column stores the subject's email/id verbatim (exact match).
// `deviceId`— legacy audit docs key the subject as `actor:<id>` in device_id; we match by suffix.
export type MatchKind = 'email' | 'actorPrefixed';

export interface ErasureTarget {
  /** Human label for the store (what the operator sees). */
  store: string;
  /** Physical table name. */
  table: string;
  /** Column that holds the subject reference. */
  column: string;
  /** How the subject id maps onto the column value. */
  match: MatchKind;
}

// The subject-bearing tables the console owns and CAN erase via its own db handle. Every entry maps
// a subject (email/id) onto a concrete table+column. Ordered so dependent rows (messages) are listed
// before their parents (conversations) — the executor deletes in this order.
export const ERASURE_CATALOG: readonly ErasureTarget[] = [
  { store: 'Chat messages', table: 'chat_messages', column: 'user_id', match: 'email' },
  { store: 'Chat conversations', table: 'chat_conversations', column: 'user_id', match: 'email' },
  { store: 'Chat memory', table: 'chat_memory', column: 'user_id', match: 'email' },
  { store: 'Chat documents', table: 'chat_documents', column: 'user_id', match: 'email' },
  { store: 'Chat settings', table: 'chat_settings', column: 'user_id', match: 'email' },
  { store: 'Chat preferences', table: 'chat_prefs', column: 'user_id', match: 'email' },
  { store: 'Project membership', table: 'chat_project_members', column: 'user_id', match: 'email' },
  { store: 'API keys (subject)', table: 'api_keys', column: 'subject', match: 'email' },
  { store: 'Audit attribution', table: 'audit_events', column: 'key_id', match: 'email' },
] as const;

// Stores whose erasure genuinely needs a new store.ts / external-service seam this module can't
// reach without editing files owned by other agents. Reported honestly as deferred, never hidden.
export const DEFERRED_STORES: readonly string[] = [
  'Vector index (embedded/qdrant) — subject-scoped chunks',
  'External data lake / connectors — source-system rows',
  'Long-term device memory (mobile/desktop replicas)',
] as const;

// ── Pure plan ──────────────────────────────────────────────────────────────────
export interface PlanStep {
  store: string;
  table: string;
  column: string;
  match: MatchKind;
  /** The literal value to match the column against. */
  value: string;
}

export interface ErasurePlan {
  subject: string;
  steps: PlanStep[];
  deferred: string[];
}

/** Build the erasure plan for a subject. PURE — never throws; trims/validates the subject. */
export function planErasure(
  subject: string,
  catalog: readonly ErasureTarget[] = ERASURE_CATALOG,
  deferred: readonly string[] = DEFERRED_STORES,
): ErasurePlan {
  const s = (subject ?? '').trim();
  if (!s) return { subject: '', steps: [], deferred: [...deferred] };
  const steps: PlanStep[] = catalog.map((t) => ({
    store: t.store,
    table: t.table,
    column: t.column,
    match: t.match,
    // actorPrefixed columns store `actor:<id>`; email columns store the id verbatim.
    value: t.match === 'actorPrefixed' ? `actor:${s}` : s,
  }));
  return { subject: s, steps, deferred: [...deferred] };
}

// ── Executor result shaping (pure) ──────────────────────────────────────────────
export interface StepResult {
  store: string;
  table: string;
  deleted: number;
  error: string | null;
}

export interface ErasureReport {
  subject: string;
  status: 'completed' | 'partial';
  erasedRows: number; // total rows deleted across reachable stores
  results: StepResult[]; // per-store outcome
  deferred: string[]; // stores requiring seams this path can't reach
}

/** Fold executed step results into a report. PURE — status is 'partial' iff any step errored. */
export function summarizeErasure(
  subject: string,
  results: StepResult[],
  deferred: string[],
): ErasureReport {
  const erasedRows = results.reduce((n, r) => n + (r.deleted > 0 ? r.deleted : 0), 0);
  const status = results.some((r) => r.error) ? 'partial' : 'completed';
  return { subject, status, erasedRows, results, deferred };
}
