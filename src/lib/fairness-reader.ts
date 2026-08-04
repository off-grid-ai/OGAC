// ─── Assembling an app's decided cases for a fairness test (I/O) ──────────────────────────────────────
//
// Thin: read the app's runs, turn each finished one into a DecidedCase, hand the pure rule the result.
// The judgement all lives in `fairness.ts`.
//
// The awkward part is deciding what "approved" means, and it is not a detail. A run that a person
// REJECTED and a run that FAILED both end without an approval, and counting a crash as a decline would
// invent adverse impact out of an outage. So only runs that actually reached a decision are included, and
// a failure is excluded rather than counted either way.

import { listAppRuns } from './app-run-store';
import { isDeclinedByPerson } from './app-run-progress';
import type { DecidedCase } from './fairness';

/** Attribute keys we never treat as a group: identifiers, amounts, timestamps and free text. */
const NOT_A_GROUP = new Set([
  'id',
  'input',
  'subject',
  'amount',
  'claim_no',
  'submitted_at',
  'created_at',
  'purpose',
  'source',
  'employee_id',
  'customer_id',
  'fy',
]);

/** An attribute value longer than this is prose, not a category. */
const MAX_VALUE_LEN = 40;

/**
 * The case record inside a run's input envelope.
 *
 * Unwrapped with the same shape the run executor uses — `body.case`, then `case`, then the envelope
 * itself — because a second copy of that knowledge here is how the queue lost its case names once before.
 */
function caseRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  const env = input as Record<string, unknown>;
  const body = env.body as Record<string, unknown> | undefined;
  const picked = (body?.case ?? env.case ?? env) as unknown;
  return picked && typeof picked === 'object' && !Array.isArray(picked)
    ? (picked as Record<string, unknown>)
    : null;
}

/** Scalar, short, categorical fields only — the rest cannot group anything. */
function groupableAttributes(rec: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (NOT_A_GROUP.has(k)) continue;
    if (v === null || v === undefined || typeof v === 'object') continue;
    if (typeof v === 'number') continue; // a number is a measure, not a group
    const s = String(v).trim();
    if (!s || s.length > MAX_VALUE_LEN) continue;
    out[k] = s;
  }
  return out;
}

export interface AppFairnessInput {
  cases: DecidedCase[];
  /** Runs excluded because they never reached a decision — reported, never silently dropped. */
  undecided: number;
  /** Runs excluded because they failed. Counting a crash as a decline would invent adverse impact. */
  failed: number;
}

export async function readAppDecidedCases(
  appId: string,
  orgId: string,
  limit = 500,
): Promise<AppFairnessInput> {
  const runs = await listAppRuns(appId, orgId, limit).catch(() => []);
  const cases: DecidedCase[] = [];
  let undecided = 0;
  let failed = 0;

  for (const r of runs) {
    const status = String(r.status);
    const steps = (r as { steps?: { kind?: string; status?: string; detail?: string }[] }).steps;
    const declined = isDeclinedByPerson(steps);

    if (status === 'error' && !declined) {
      failed++;
      continue;
    }
    if (status !== 'done' && !declined) {
      undecided++;
      continue;
    }
    const rec = caseRecord((r as { input?: unknown }).input);
    if (!rec) {
      undecided++;
      continue;
    }
    cases.push({
      id: r.id,
      // A person declining IS a decision, and it is the adverse one — the whole point of the test.
      approved: !declined,
      attributes: groupableAttributes(rec),
    });
  }
  return { cases, undecided, failed };
}
