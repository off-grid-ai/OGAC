// Outcome Observation Plane — PURE shared contract.
//
// App Run remains the execution owner and ActionReceipt remains the immutable proof of mutation.
// This contract owns only post-action business facts. A browser supplies the run/step locator; the
// store must resolve the canonical receipt under the active org and copy its immutable correlation
// fields. It must never trust receipt metadata supplied by a client.

import type { ActionId, ActionReceipt } from '@/lib/action-contract';

export const ACTION_OUTCOME_CODES = [
  'accepted',
  'rejected',
  'converted',
  'cured',
  'settled',
] as const;

export type ActionOutcomeCode = (typeof ACTION_OUTCOME_CODES)[number];
export type ActionOutcomeRecordKind = 'observed' | 'corrected' | 'withdrawn';
export type ActionOutcomeSourceKind = 'human' | 'system' | 'import';

export interface ActionOutcomeMeasurement {
  metricName: string;
  metricUnit: string;
  /** Optional point-in-time comparator retained with the observed result. */
  baselineValue?: number;
  resultValue: number;
}

export interface ActionOutcomeMutationInput {
  /** The server resolves this tenant-scoped run and its canonical stored ActionReceipt. */
  runId: string;
  /** The action step containing the receipt. */
  stepId: string;
  kind: ActionOutcomeRecordKind;
  /** Required for observed/corrected; absent for a withdrawal. */
  outcomeCode?: ActionOutcomeCode;
  observedAt: string;
  source: {
    kind: ActionOutcomeSourceKind;
    /** Stable upstream event or client mutation id used for retry idempotency. */
    eventId: string;
  };
  note: string;
  evidenceLinks: string[];
  measurement?: ActionOutcomeMeasurement;
  /** Correction/withdrawal points to the fact it supersedes; original facts are never rewritten. */
  supersedesId?: string;
}

export interface ActionOutcomeReceiptRef {
  appId: string;
  runId: string;
  stepId: string;
  receiptIdempotencyKey: string;
  actionId: ActionId;
  target: string;
  actionExecutedAt: string;
}

export interface ActionOutcomeRecord extends ActionOutcomeReceiptRef {
  id: string;
  orgId: string;
  kind: ActionOutcomeRecordKind;
  outcomeCode: ActionOutcomeCode | null;
  observedAt: string;
  source: {
    kind: ActionOutcomeSourceKind;
    eventId: string;
    /** sha256(orgId | receiptIdempotencyKey | source kind | source event id). */
    idempotencyKey: string;
  };
  /** Canonical signed receipt copied by the store; never accepted from browser input. */
  actionReceipt: ActionReceipt;
  note: string;
  evidenceLinks: string[];
  measurement: ActionOutcomeMeasurement | null;
  supersedesId: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface OutcomeWindowSummary {
  actionsExecuted: number;
  actionsWithObservedResult: number;
  actionsWithSuccess: number;
  observationRatePct: number | null;
  successRatePct: number | null;
  counts: Record<ActionOutcomeCode, number>;
}

export interface OutcomeBaselineComparison {
  baseline: OutcomeWindowSummary;
  result: OutcomeWindowSummary;
  successRateChangePctPoints: number | null;
}

const SAFE_ID = /^[A-Za-z0-9:_-]{1,256}$/;
const OUTCOME_CODE_SET = new Set<string>(ACTION_OUTCOME_CODES);

export function isActionOutcomeCode(value: unknown): value is ActionOutcomeCode {
  return typeof value === 'string' && OUTCOME_CODE_SET.has(value);
}

/** Canonical input rules shared by UI readiness and the write route. */
export function validateActionOutcomeMutation(input: ActionOutcomeMutationInput): string[] {
  const errors: string[] = [];
  if (!SAFE_ID.test(input.runId)) errors.push('run id is invalid');
  if (!SAFE_ID.test(input.stepId)) errors.push('step id is invalid');
  if (!['observed', 'corrected', 'withdrawn'].includes(input.kind)) {
    errors.push('record kind is invalid');
  }
  if (!['human', 'system', 'import'].includes(input.source.kind)) {
    errors.push('source kind is invalid');
  }
  if (!SAFE_ID.test(input.source.eventId)) errors.push('source event id is invalid');
  if (!Number.isFinite(Date.parse(input.observedAt))) errors.push('observed time is invalid');
  if (input.note.trim().length === 0) errors.push('a plain-language note is required');
  if (input.note.length > 2_000) errors.push('note must be 2000 characters or fewer');
  if (!Array.isArray(input.evidenceLinks)) errors.push('evidence links must be a list');
  else if (input.evidenceLinks.length === 0) errors.push('supporting evidence is required');
  else if (input.evidenceLinks.some((link) => !validEvidenceLink(link))) {
    errors.push('evidence links must be relative or HTTP URLs');
  }

  if (input.kind === 'withdrawn') {
    if (input.outcomeCode !== undefined) errors.push('withdrawal cannot declare an outcome');
    if (!input.supersedesId || !SAFE_ID.test(input.supersedesId)) {
      errors.push('withdrawal must identify the observation it withdraws');
    }
  } else {
    if (!isActionOutcomeCode(input.outcomeCode)) errors.push('business outcome is invalid');
    if (input.kind === 'corrected') {
      if (!input.supersedesId || !SAFE_ID.test(input.supersedesId)) {
        errors.push('correction must identify the observation it corrects');
      }
    } else if (input.supersedesId !== undefined) {
      errors.push('an initial observation cannot supersede another observation');
    }
  }

  if (input.measurement) {
    if (!input.measurement.metricName.trim()) errors.push('measurement name is required');
    if (!input.measurement.metricUnit.trim()) errors.push('measurement unit is required');
    if (!Number.isFinite(input.measurement.resultValue)) {
      errors.push('measurement result must be finite');
    }
    if (
      input.measurement.baselineValue !== undefined &&
      !Number.isFinite(input.measurement.baselineValue)
    ) {
      errors.push('measurement baseline must be finite');
    }
  }
  return errors;
}

function validEvidenceLink(link: string): boolean {
  const clean = link.trim();
  return clean.startsWith('/') || /^https?:\/\//.test(clean);
}

/**
 * Returns the currently effective facts without deleting the retained audit history. A correction
 * or withdrawal supersedes one earlier fact; accepted -> converted remains two independent facts.
 */
export function effectiveActionOutcomes(records: ActionOutcomeRecord[]): ActionOutcomeRecord[] {
  const superseded = new Set(
    records.map((record) => record.supersedesId).filter((id): id is string => Boolean(id)),
  );
  return records.filter((record) => record.kind !== 'withdrawn' && !superseded.has(record.id));
}

/** Baseline/result periods use the same denominator: canonical executed receipt keys. */
export function summarizeOutcomeWindow(
  receiptIdempotencyKeys: Iterable<string>,
  records: ActionOutcomeRecord[],
  successCodes: ReadonlySet<ActionOutcomeCode>,
): OutcomeWindowSummary {
  const receipts = new Set(receiptIdempotencyKeys);
  const effective = effectiveActionOutcomes(records).filter((record) =>
    receipts.has(record.receiptIdempotencyKey),
  );
  const observedReceipts = new Set(effective.map((record) => record.receiptIdempotencyKey));
  const successfulReceipts = new Set(
    effective
      .filter(
        (record): record is ActionOutcomeRecord & { outcomeCode: ActionOutcomeCode } =>
          record.outcomeCode !== null && successCodes.has(record.outcomeCode),
      )
      .map((record) => record.receiptIdempotencyKey),
  );
  const receiptsByCode = Object.fromEntries(
    ACTION_OUTCOME_CODES.map((code) => [code, new Set<string>()]),
  ) as Record<ActionOutcomeCode, Set<string>>;
  for (const record of effective) {
    if (record.outcomeCode) receiptsByCode[record.outcomeCode].add(record.receiptIdempotencyKey);
  }
  const counts = Object.fromEntries(
    ACTION_OUTCOME_CODES.map((code) => [code, receiptsByCode[code].size]),
  ) as Record<
    ActionOutcomeCode,
    number
  >;
  const actionsExecuted = receipts.size;
  return {
    actionsExecuted,
    actionsWithObservedResult: observedReceipts.size,
    actionsWithSuccess: successfulReceipts.size,
    observationRatePct: rate(observedReceipts.size, actionsExecuted),
    successRatePct: rate(successfulReceipts.size, actionsExecuted),
    counts,
  };
}

export function compareOutcomeWindows(
  baseline: OutcomeWindowSummary,
  result: OutcomeWindowSummary,
): OutcomeBaselineComparison {
  return {
    baseline,
    result,
    successRateChangePctPoints:
      baseline.successRatePct === null || result.successRatePct === null
        ? null
        : round2(result.successRatePct - baseline.successRatePct),
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round2((numerator / denominator) * 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
