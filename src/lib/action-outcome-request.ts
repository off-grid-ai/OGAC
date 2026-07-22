import {
  type ActionOutcomeCode,
  type ActionOutcomeMeasurement,
  type ActionOutcomeMutationInput,
  type ActionOutcomeRecordKind,
  isActionOutcomeCode,
  validateActionOutcomeMutation,
} from '@/lib/action-outcome-contract';

interface RequestContext {
  runId: string;
  stepId: string;
  kind: ActionOutcomeRecordKind;
  supersedesId?: string;
  defaultEvidenceLink?: string;
}

export type ParsedActionOutcomeRequest =
  | { ok: true; value: ActionOutcomeMutationInput }
  | { ok: false; errors: string[] };

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanLinks(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback];
  const links = value
    .filter((link): link is string => typeof link === 'string')
    .map((link) => link.trim())
    .filter(Boolean);
  return links.length ? [...new Set(links)] : [fallback];
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseMeasurement(value: unknown): ActionOutcomeMeasurement | undefined {
  const raw = objectValue(value);
  if (Object.keys(raw).length === 0) return undefined;
  const resultValue = optionalFiniteNumber(raw.resultValue);
  if (resultValue === undefined) return undefined;
  const baselineValue = optionalFiniteNumber(raw.baselineValue);
  return {
    metricName: cleanText(raw.metricName),
    metricUnit: cleanText(raw.metricUnit),
    resultValue,
    ...(baselineValue === undefined ? {} : { baselineValue }),
  };
}

/**
 * Browser JSON -> frozen mutation contract. Route locators and record kind always come from the
 * trusted URL/method context. Receipt identity and tenant data are deliberately not accepted.
 */
export function parseActionOutcomeRequest(
  body: unknown,
  context: RequestContext,
): ParsedActionOutcomeRequest {
  const raw = objectValue(body);
  const fallback =
    context.defaultEvidenceLink ?? `/operations/runs/${encodeURIComponent(context.runId)}`;
  const outcomeCode = isActionOutcomeCode(raw.outcomeCode)
    ? (raw.outcomeCode as ActionOutcomeCode)
    : undefined;
  const measurement = parseMeasurement(raw.measurement);
  const value: ActionOutcomeMutationInput = {
    runId: context.runId,
    stepId: context.stepId,
    kind: context.kind,
    ...(context.kind === 'withdrawn' ? {} : { outcomeCode }),
    observedAt: cleanText(raw.observedAt),
    source: {
      // This first product surface records an authenticated person's observation. System/import
      // ingestion uses the store contract directly through its own bounded adapter later.
      kind: 'human',
      eventId: cleanText(raw.eventId),
    },
    note: cleanText(raw.note),
    evidenceLinks: cleanLinks(raw.evidenceLinks, fallback),
    ...(measurement ? { measurement } : {}),
    ...(context.supersedesId ? { supersedesId: context.supersedesId } : {}),
  };
  const errors = validateActionOutcomeMutation(value);
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
