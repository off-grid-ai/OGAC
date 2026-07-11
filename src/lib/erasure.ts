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

// ── TENANT SCOPING (SECURITY #236 fix 3 — RTBF cross-tenant) ─────────────────────────────────────
// A DSAR erasure runs under ONE org (the requesting admin's). Historically the DELETE matched ONLY
// the subject value (an email/user_id), so erasing a subject in org A also deleted that subject's
// rows in org B — and an admin of A could wipe B's data. Every step now carries HOW it is scoped to
// the requesting org, so the executor can never reach a foreign tenant's rows:
//   • { kind:'column' }     — the table has its own org column → the DELETE ANDs `<col> = <org>`.
//   • { kind:'parent' }     — the table has no org column but a FK to an org-scoped parent → the
//                              DELETE ANDs `<childKey> IN (SELECT <parentKey> FROM <parentTable>
//                              WHERE org_id = <org>)`, so only rows whose parent is in THIS org go.
//   • { kind:'membership' } — a user-GLOBAL table (per-person preferences, no org column and no
//                              org-scoped parent). It is erased ONLY when the subject is a MEMBER of
//                              the requesting org (they own at least one org-scoped row here), so an
//                              admin of A can never wipe the global prefs of a person who exists only
//                              in B. When the subject is not a member of the org, the step is skipped.
export type OrgScope =
  | { kind: 'column'; column: string }
  | {
      kind: 'parent';
      parentTable: string;
      parentKey: string;
      childKey: string;
      /**
       * Where the SUBJECT is matched. 'child' (default) — the child table has its own subject column
       * (the step's `column`) and the parent supplies only the org scope. 'parent' — the child has NO
       * subject column (e.g. chat_messages has no user_id), so BOTH the subject AND the org are matched
       * on the parent (delete every child whose parent is the subject's + in this org).
       */
      subjectOn?: 'child' | 'parent';
      /** The subject column ON THE PARENT (only used when subjectOn === 'parent'). */
      parentSubjectColumn?: string;
    }
  | { kind: 'membership' };

export interface ErasureTarget {
  /** Human label for the store (what the operator sees). */
  store: string;
  /** Physical table name. */
  table: string;
  /** Column that holds the subject reference. */
  column: string;
  /** How the subject id maps onto the column value. */
  match: MatchKind;
  /** How this table's DELETE is confined to the requesting org (RTBF cross-tenant guard). */
  orgScope: OrgScope;
}

// The subject-bearing tables the console owns and CAN erase via its own db handle. Every entry maps
// a subject (email/id) onto a concrete table+column AND declares its org scope. Ordered so dependent
// rows (messages) are listed before their parents (conversations) — the executor deletes in order.
export const ERASURE_CATALOG: readonly ErasureTarget[] = [
  // chat_messages has NO org column AND no subject column — match the subject AND the org on its
  // parent conversation (delete every message whose conversation is the subject's, in this org).
  { store: 'Chat messages', table: 'chat_messages', column: 'user_id', match: 'email', orgScope: { kind: 'parent', parentTable: 'chat_conversations', parentKey: 'id', childKey: 'conversation_id', subjectOn: 'parent', parentSubjectColumn: 'user_id' } },
  { store: 'Chat conversations', table: 'chat_conversations', column: 'user_id', match: 'email', orgScope: { kind: 'column', column: 'org_id' } },
  { store: 'Chat memory', table: 'chat_memory', column: 'user_id', match: 'email', orgScope: { kind: 'column', column: 'org_id' } },
  // chat_documents has no org column — scope through its project's org.
  { store: 'Chat documents', table: 'chat_documents', column: 'user_id', match: 'email', orgScope: { kind: 'parent', parentTable: 'chat_projects', parentKey: 'id', childKey: 'project_id' } },
  // chat_settings / chat_prefs are user-GLOBAL (per-person, no org) — erase only for an org member.
  { store: 'Chat settings', table: 'chat_settings', column: 'user_id', match: 'email', orgScope: { kind: 'membership' } },
  { store: 'Chat preferences', table: 'chat_prefs', column: 'user_id', match: 'email', orgScope: { kind: 'membership' } },
  // chat_project_members has no org column — scope through the project's org.
  { store: 'Project membership', table: 'chat_project_members', column: 'user_id', match: 'email', orgScope: { kind: 'parent', parentTable: 'chat_projects', parentKey: 'id', childKey: 'project_id' } },
  { store: 'API keys (subject)', table: 'api_keys', column: 'subject', match: 'email', orgScope: { kind: 'column', column: 'org_id' } },
  { store: 'Audit attribution', table: 'audit_events', column: 'key_id', match: 'email', orgScope: { kind: 'column', column: 'org_id' } },
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
  /** The org this erasure is confined to (RTBF cross-tenant guard). */
  orgId: string;
  /** How this step is scoped to `orgId`. */
  orgScope: OrgScope;
}

export interface ErasurePlan {
  subject: string;
  orgId: string;
  steps: PlanStep[];
  deferred: string[];
}

/**
 * Build the erasure plan for a subject WITHIN an org. PURE — never throws; trims/validates inputs.
 * `orgId` confines every step to one tenant (RTBF cross-tenant, SECURITY #236 fix 3) so an erasure
 * can never reach another tenant's rows. It is stamped onto each step and bound into the org filter
 * at execution. A blank org is inherently fail-closed at execution: the org filter becomes
 * `org_id = ''` (matches nothing) and the membership probe finds no member (skips), so no row is ever
 * deleted unscoped. Defaults to '' so scope-display callers (which only read table names) still work.
 */
export function planErasure(
  subject: string,
  orgId: string = '',
  catalog: readonly ErasureTarget[] = ERASURE_CATALOG,
  deferred: readonly string[] = DEFERRED_STORES,
): ErasurePlan {
  const s = (subject ?? '').trim();
  const org = (orgId ?? '').trim();
  if (!s) return { subject: '', orgId: org, steps: [], deferred: [...deferred] };
  const steps: PlanStep[] = catalog.map((t) => ({
    store: t.store,
    table: t.table,
    column: t.column,
    match: t.match,
    // actorPrefixed columns store `actor:<id>`; email columns store the id verbatim.
    value: t.match === 'actorPrefixed' ? `actor:${s}` : s,
    orgId: org,
    orgScope: t.orgScope,
  }));
  return { subject: s, orgId: org, steps, deferred: [...deferred] };
}

// ── Pure SQL shaping — the org-scoped WHERE, in ONE testable place ──────────────────────────────
// The route builds the actual `sql` template; this decides the SHAPE of the org confinement so the
// "never reach a foreign tenant" rule is unit-testable without a DB. Table/column/parent identifiers
// come only from the catalog (never user input); the subject VALUE + org are always bound params.
export interface ErasureWhere {
  /** The SQL WHERE clause with `%SUBJECT%` and `%ORG%` placeholders for the bound params. */
  clause: string;
  /**
   * For a 'membership' step: the subject IS erased only when a member of the org — this is the probe
   * the executor must run first (does the subject own any org-scoped row in this org?). null for
   * non-membership steps (they are always org-confined by their own clause).
   */
  membershipProbe: string | null;
}

/**
 * Build the org-confined WHERE shape for a plan step. PURE. `%SUBJECT%`/`%ORG%` are placeholders the
 * executor replaces with BOUND parameters (never string-interpolated). Identifiers are catalog
 * constants (safe). This is the whole cross-tenant confinement rule, isolated for unit tests:
 *   • column               → `<subjectCol> = %SUBJECT% AND <orgCol> = %ORG%`
 *   • parent (subjectOn     → `<subjectCol> = %SUBJECT% AND <childKey> IN (SELECT <parentKey> FROM
 *     'child')                <parent> WHERE org_id = %ORG%)`
 *   • parent (subjectOn     → `<childKey> IN (SELECT <parentKey> FROM <parent> WHERE
 *     'parent')              <parentSubjectColumn> = %SUBJECT% AND org_id = %ORG%)` — the child has NO
 *                            subject column (e.g. chat_messages), so subject AND org match the parent.
 *   • membership           → `<subjectCol> = %SUBJECT%` guarded by a membership probe (member only).
 */
export function buildErasureWhere(step: PlanStep): ErasureWhere {
  const subj = `${step.column} = %SUBJECT%`;
  if (step.orgScope.kind === 'column') {
    return { clause: `${subj} AND ${step.orgScope.column} = %ORG%`, membershipProbe: null };
  }
  if (step.orgScope.kind === 'parent') {
    const { parentTable, parentKey, childKey, subjectOn, parentSubjectColumn } = step.orgScope;
    if (subjectOn === 'parent') {
      // The child has no subject column — match subject AND org on the parent so only the subject's
      // children in THIS org are deleted (never another tenant's, never another person's).
      const psc = parentSubjectColumn ?? 'user_id';
      return {
        clause: `${childKey} IN (SELECT ${parentKey} FROM ${parentTable} WHERE ${psc} = %SUBJECT% AND org_id = %ORG%)`,
        membershipProbe: null,
      };
    }
    return {
      clause: `${subj} AND ${childKey} IN (SELECT ${parentKey} FROM ${parentTable} WHERE org_id = %ORG%)`,
      membershipProbe: null,
    };
  }
  // membership: a user-global table. The executor deletes the subject's row ONLY when the membership
  // probe finds the subject owns at least one org-scoped row in this org (a conversation).
  return {
    clause: subj,
    membershipProbe: `SELECT 1 FROM chat_conversations WHERE user_id = %SUBJECT% AND org_id = %ORG% LIMIT 1`,
  };
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

// ── External-plane PROPAGATION orchestrator (thin I/O) ────────────────────────────────────────────
// Phase S6: the vector index, external lake, and device replicas are no longer merely "deferred" —
// this orchestrates the REAL propagation. It builds the PURE plan (planPropagation), calls each
// configured adapter, and folds an HONEST report (summarizePropagation) where an unconfigured/failed
// target is `deferred` with a reason, never counted as erased. Adapters are injected (default = the
// real ones) so the orchestrator is integration-testable with fakes over the real plan.

import { eraseSubjectDeviceReplicas } from '@/lib/adapters/erasure-device';
import { eraseSubjectLakeObjects, isLakeConfigured } from '@/lib/adapters/erasure-lake';
import { eraseSubjectVectors, isVectorConfigured } from '@/lib/adapters/erasure-vector';
import {
  planPropagation,
  summarizePropagation,
  type PropagationConfig,
  type PropagationReport,
  type PropagationResult,
} from '@/lib/erasure-plan';

/** The adapter surface the orchestrator drives — injectable so tests can supply fakes. */
export interface PropagationAdapters {
  isVectorConfigured: () => Promise<boolean>;
  eraseVectors: (subjectKey: string) => Promise<{ ok: boolean; removed: number | null; error: string | null }>;
  isLakeConfigured: () => Promise<boolean>;
  eraseLake: (subjectKey: string) => Promise<{ ok: boolean; removed: number; error: string | null }>;
  eraseDevice: (
    subjectKey: string,
    requestedBy: string,
    orgId: string,
  ) => Promise<{ ok: boolean; removed: number; error: string | null }>;
}

const REAL_ADAPTERS: PropagationAdapters = {
  isVectorConfigured,
  eraseVectors: eraseSubjectVectors,
  isLakeConfigured,
  eraseLake: eraseSubjectLakeObjects,
  eraseDevice: eraseSubjectDeviceReplicas,
};

/**
 * Propagate a subject-erasure to the external planes. Thin orchestration: probe config → build the
 * pure plan → run each configured adapter → aggregate honestly. Device propagation is ALWAYS
 * actionable (it records a durable tombstone), so it's never a silent skip. Returns the honest
 * {propagated, deferred} report.
 */
export async function propagateErasure(
  subject: string,
  requestedBy: string,
  orgId: string,
  adapters: PropagationAdapters = REAL_ADAPTERS,
): Promise<PropagationReport> {
  // Probe which external targets are reachable/configured (device is always available via the queue).
  const [vector, lake] = await Promise.all([
    adapters.isVectorConfigured().catch(() => false),
    adapters.isLakeConfigured().catch(() => false),
  ]);
  const config: PropagationConfig = { vector, lake, device: true };

  const plan = planPropagation(subject, config);
  const executed: PropagationResult[] = [];

  for (const step of plan.steps) {
    if (step.target === 'vector') {
      const r = await adapters.eraseVectors(step.subjectKey);
      executed.push({
        target: 'vector',
        label: step.label,
        outcome: r.ok ? 'erased' : 'error',
        removed: r.removed ?? 0,
        reason: r.ok ? null : r.error,
      });
    } else if (step.target === 'lake') {
      const r = await adapters.eraseLake(step.subjectKey);
      executed.push({
        target: 'lake',
        label: step.label,
        outcome: r.ok ? 'erased' : 'error',
        removed: r.removed,
        reason: r.ok ? null : r.error,
      });
    } else {
      const r = await adapters.eraseDevice(step.subjectKey, requestedBy, orgId);
      executed.push({
        target: 'device',
        label: step.label,
        outcome: r.ok ? 'erased' : 'error',
        removed: r.removed,
        reason: r.ok ? null : r.error,
      });
    }
  }

  return summarizePropagation(plan.subject, executed, plan.notConfigured);
}
