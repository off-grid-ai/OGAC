import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  actionOutcomeObservations,
  appRuns,
  type ActionOutcomeObservationRow,
} from '@/db/schema';
import { isActionId, type ActionReceipt } from '@/lib/action-contract';
import {
  validateActionOutcomeMutation,
  type ActionOutcomeMutationInput,
  type ActionOutcomeRecord,
} from '@/lib/action-outcome-contract';
import {
  deriveActionOutcomeIdempotencyKey,
  isExactOutcomeReplay,
  validateCanonicalOutcomeTiming,
} from '@/lib/action-outcome-observation';

export class ActionOutcomeValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join('; '));
    this.name = 'ActionOutcomeValidationError';
    this.errors = errors;
  }
}

export class ActionOutcomeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionOutcomeNotFoundError';
  }
}

export class ActionOutcomeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionOutcomeConflictError';
  }
}

function toRecord(row: ActionOutcomeObservationRow): ActionOutcomeRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    appId: row.appId,
    runId: row.runId,
    stepId: row.stepId,
    receiptIdempotencyKey: row.receiptIdempotencyKey,
    actionId: row.actionId,
    target: row.actionTarget,
    actionExecutedAt: row.actionExecutedAt.toISOString(),
    actionReceipt: row.actionReceipt,
    kind: row.kind,
    outcomeCode: row.outcomeCode,
    observedAt: row.observedAt.toISOString(),
    source: {
      kind: row.sourceKind,
      eventId: row.sourceEventId,
      idempotencyKey: row.sourceIdempotencyKey,
    },
    note: row.note,
    evidenceLinks: row.evidenceLinks,
    measurement: row.measurement,
    supersedesId: row.supersedesId,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function canonicalReceipt(run: typeof appRuns.$inferSelect, stepId: string): ActionReceipt | null {
  const step = run.steps.find((candidate) => candidate.id === stepId && candidate.kind === 'action');
  const receipt = step?.actionReceipt;
  if (!receipt || !isActionId(receipt.actionId)) return null;
  if (
    receipt.orgId !== run.orgId ||
    receipt.runId !== run.id ||
    receipt.stepId !== stepId ||
    (receipt.status !== 'executed' && receipt.status !== 'replayed')
  ) {
    return null;
  }
  return receipt;
}

export async function recordActionOutcome(
  input: ActionOutcomeMutationInput,
  orgId: string,
  recordedBy: string,
): Promise<{ observation: ActionOutcomeRecord; replayed: boolean }> {
  const inputErrors = validateActionOutcomeMutation(input);
  if (!orgId.trim()) inputErrors.push('organisation is required');
  if (!recordedBy.trim()) inputErrors.push('recorder identity is required');
  if (input.kind === 'withdrawn' && input.measurement) {
    inputErrors.push('withdrawal cannot declare a measurement');
  }
  if (inputErrors.length) throw new ActionOutcomeValidationError(inputErrors);

  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(appRuns)
      .where(and(eq(appRuns.id, input.runId), eq(appRuns.orgId, orgId)))
      .limit(1);
    if (!run) throw new ActionOutcomeNotFoundError('App run not found');

    const receipt = canonicalReceipt(run, input.stepId);
    if (!receipt) {
      throw new ActionOutcomeNotFoundError('Governed action receipt not found');
    }
    const timingErrors = validateCanonicalOutcomeTiming(input.observedAt, receipt);
    if (timingErrors.length) throw new ActionOutcomeValidationError(timingErrors);

    const sourceIdempotencyKey = deriveActionOutcomeIdempotencyKey(
      orgId,
      receipt.idempotencyKey,
      input.source,
    );
    const [existingRow] = await tx
      .select()
      .from(actionOutcomeObservations)
      .where(
        and(
          eq(actionOutcomeObservations.orgId, orgId),
          eq(actionOutcomeObservations.sourceIdempotencyKey, sourceIdempotencyKey),
        ),
      )
      .limit(1);
    if (existingRow) {
      const existing = toRecord(existingRow);
      if (!isExactOutcomeReplay(existing, input)) {
        throw new ActionOutcomeConflictError(
          'This source event was already used for different outcome evidence',
        );
      }
      return { observation: existing, replayed: true };
    }

    if (input.supersedesId) {
      const [prior] = await tx
        .select()
        .from(actionOutcomeObservations)
        .where(
          and(
            eq(actionOutcomeObservations.id, input.supersedesId),
            eq(actionOutcomeObservations.orgId, orgId),
            eq(actionOutcomeObservations.runId, run.id),
            eq(actionOutcomeObservations.stepId, input.stepId),
            eq(actionOutcomeObservations.receiptIdempotencyKey, receipt.idempotencyKey),
          ),
        )
        .limit(1);
      if (!prior) {
        throw new ActionOutcomeNotFoundError('Observation to supersede was not found');
      }
      if (prior.kind === 'withdrawn') {
        throw new ActionOutcomeConflictError('A withdrawal cannot be corrected or withdrawn again');
      }
      const [alreadySuperseded] = await tx
        .select({ id: actionOutcomeObservations.id })
        .from(actionOutcomeObservations)
        .where(
          and(
            eq(actionOutcomeObservations.supersedesId, prior.id),
            eq(actionOutcomeObservations.orgId, orgId),
            eq(actionOutcomeObservations.receiptIdempotencyKey, receipt.idempotencyKey),
          ),
        )
        .limit(1);
      if (alreadySuperseded) {
        throw new ActionOutcomeConflictError('This observation was already corrected or withdrawn');
      }
    }

    const [inserted] = await tx
      .insert(actionOutcomeObservations)
      .values({
        id: `aout_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        orgId,
        appId: run.appId,
        runId: run.id,
        stepId: input.stepId,
        receiptIdempotencyKey: receipt.idempotencyKey,
        actionId: receipt.actionId,
        actionTarget: receipt.target,
        actionExecutedAt: new Date(receipt.executedAt),
        actionReceipt: receipt,
        kind: input.kind,
        outcomeCode: input.outcomeCode ?? null,
        observedAt: new Date(input.observedAt),
        sourceKind: input.source.kind,
        sourceEventId: input.source.eventId,
        sourceIdempotencyKey,
        note: input.note,
        evidenceLinks: input.evidenceLinks,
        measurement: input.measurement ?? null,
        supersedesId: input.supersedesId ?? null,
        recordedBy,
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted) {
      const [raced] = await tx
        .select()
        .from(actionOutcomeObservations)
        .where(
          and(
            eq(actionOutcomeObservations.sourceIdempotencyKey, sourceIdempotencyKey),
            eq(actionOutcomeObservations.orgId, orgId),
          ),
        )
        .limit(1);
      if (raced) {
        const existing = toRecord(raced);
        if (isExactOutcomeReplay(existing, input)) {
          return { observation: existing, replayed: true };
        }
      }
      throw new ActionOutcomeConflictError('Outcome evidence conflicts with an existing record');
    }
    return { observation: toRecord(inserted), replayed: false };
  });
}

export async function listActionOutcomes(
  runId: string,
  stepId: string,
  orgId: string,
): Promise<ActionOutcomeRecord[]> {
  return (
    await db
      .select()
      .from(actionOutcomeObservations)
      .where(
        and(
          eq(actionOutcomeObservations.runId, runId),
          eq(actionOutcomeObservations.stepId, stepId),
          eq(actionOutcomeObservations.orgId, orgId),
        ),
      )
      .orderBy(asc(actionOutcomeObservations.observedAt), asc(actionOutcomeObservations.recordedAt))
  ).map(toRecord);
}

export async function getActionOutcome(
  id: string,
  runId: string,
  stepId: string,
  orgId: string,
): Promise<ActionOutcomeRecord | null> {
  const [row] = await db
    .select()
    .from(actionOutcomeObservations)
    .where(
      and(
        eq(actionOutcomeObservations.id, id),
        eq(actionOutcomeObservations.runId, runId),
        eq(actionOutcomeObservations.stepId, stepId),
        eq(actionOutcomeObservations.orgId, orgId),
      ),
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

/** Audit evidence is retained; App deletion must surface a deliberate conflict instead of an FK 500. */
export async function hasActionOutcomesForApp(appId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: actionOutcomeObservations.id })
    .from(actionOutcomeObservations)
    .where(
      and(
        eq(actionOutcomeObservations.appId, appId),
        eq(actionOutcomeObservations.orgId, orgId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
