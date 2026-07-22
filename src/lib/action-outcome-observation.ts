import { createHash } from 'node:crypto';
import type { ActionReceipt } from '@/lib/action-contract';
import type {
  ActionOutcomeMutationInput,
  ActionOutcomeRecord,
} from '@/lib/action-outcome-contract';

export function deriveActionOutcomeIdempotencyKey(
  orgId: string,
  receiptIdempotencyKey: string,
  source: ActionOutcomeMutationInput['source'],
): string {
  return createHash('sha256')
    .update([orgId, receiptIdempotencyKey, source.kind, source.eventId].join('|'))
    .digest('hex');
}

export function validateCanonicalOutcomeTiming(
  observedAt: string,
  receipt: ActionReceipt,
  now: Date = new Date(),
): string[] {
  const observed = Date.parse(observedAt);
  const executed = Date.parse(receipt.executedAt);
  const errors: string[] = [];
  if (!Number.isFinite(executed)) errors.push('canonical action receipt has an invalid execution time');
  if (Number.isFinite(observed) && Number.isFinite(executed) && observed < executed) {
    errors.push('business outcome cannot predate the governed action');
  }
  if (Number.isFinite(observed) && observed > now.valueOf()) {
    errors.push('business outcome cannot be in the future');
  }
  return errors;
}

export function isExactOutcomeReplay(
  existing: ActionOutcomeRecord,
  input: ActionOutcomeMutationInput,
): boolean {
  return (
    existing.runId === input.runId &&
    existing.stepId === input.stepId &&
    existing.kind === input.kind &&
    existing.outcomeCode === (input.outcomeCode ?? null) &&
    existing.observedAt === new Date(input.observedAt).toISOString() &&
    existing.source.kind === input.source.kind &&
    existing.source.eventId === input.source.eventId &&
    existing.note === input.note &&
    sameList(existing.evidenceLinks, input.evidenceLinks) &&
    sameMeasurement(existing.measurement, input.measurement ?? null) &&
    existing.supersedesId === (input.supersedesId ?? null)
  );
}

function sameList(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameMeasurement(
  left: ActionOutcomeRecord['measurement'],
  right: ActionOutcomeRecord['measurement'],
): boolean {
  return (
    left?.metricName === right?.metricName &&
    left?.metricUnit === right?.metricUnit &&
    left?.resultValue === right?.resultValue &&
    left?.baselineValue === right?.baselineValue
  );
}
