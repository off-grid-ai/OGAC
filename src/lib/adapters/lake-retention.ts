// ─── Apply the org's retention policy to the buckets its runs WRITE to (I/O bridge) ───────────────
//
// All the judgement is pure, in lake-retention-policy.ts. This resolves the real apps, domains and
// bucket lifecycle state, then pushes the window down to the store.
//
// WHY PUSH IT DOWN INSTEAD OF DELETING HERE: the object store already expires objects on a schedule.
// A delete loop in the console would be a SECOND clock with its own failure mode, and the promise
// would only hold while our process happened to be running. A lifecycle rule on the bucket keeps
// holding when we are not.

import { seaweedfsObjectStore } from '@/lib/adapters/s3-object-store';
import { listAppsForGovernance } from '@/lib/apps-store';
import { listDomains } from '@/lib/data-domains-store';
import {
  describeRetentionState,
  desiredLakeRule,
  lakeWriteTargets,
  mergeLakeRule,
  retentionStateFor,
  type LakeWriteTarget,
  type RetentionState,
} from '@/lib/lake-retention-policy';

export interface LakeRetentionOutcome {
  target: LakeWriteTarget;
  /** What the bucket said BEFORE we touched it — the evidence that the change was needed. */
  before: RetentionState;
  /** What it says after. Re-read from the store, never assumed from what we sent. */
  after: RetentionState | null;
  applied: boolean;
  line: string;
  error?: string;
}

export interface LakeRetentionReport {
  retainDays: number;
  outcomes: LakeRetentionOutcome[];
  /** True only when every target ends up matching the policy. */
  complete: boolean;
  summary: string;
}

/**
 * Bring every lake destination the console writes to in line with `retainDays`.
 *
 * `apply: false` inspects without changing anything, so an operator can see the drift before deciding.
 */
export async function applyLakeRetention(
  orgId: string,
  retainDays: number,
  opts: { apply?: boolean } = {},
): Promise<LakeRetentionReport> {
  const apply = opts.apply !== false;
  // UNFILTERED deliberately: listApps hides `[autotest]` apps on demo tenants for presentation, and an
  // app hidden from a list still writes files. A retention answer computed off a filtered list would
  // exclude those writes and still report itself complete.
  const [apps, domains] = await Promise.all([listAppsForGovernance(orgId), listDomains(orgId)]);
  const targets = lakeWriteTargets(
    apps as unknown as Parameters<typeof lakeWriteTargets>[0],
    domains as unknown as Parameters<typeof lakeWriteTargets>[1],
  );

  const outcomes: LakeRetentionOutcome[] = [];
  for (const target of targets) {
    try {
      const current = await seaweedfsObjectStore.getLifecycle(target.bucket);
      if (!current.supported) {
        outcomes.push({
          target,
          before: { state: 'absent' },
          after: null,
          applied: false,
          line: `${target.domainLabel}: this store cannot expire files on a schedule (${current.note ?? 'unsupported'}), so retention here is not enforced.`,
          error: current.note ?? 'lifecycle unsupported',
        });
        continue;
      }
      const before = retentionStateFor(target, current.rules, retainDays);
      if (before.state === 'unrepresentable') {
        // REFUSE TO APPLY. Writing this rule would make the store delete files after wouldBecome days
        // instead of the window that was asked for — records destroyed years early, while the surface
        // reported the policy applied. Between a false compliance claim that loses data and an honest
        // gap, the honest gap is correct: leave the bucket unbounded and say so loudly.
        outcomes.push({
          target,
          before,
          after: null,
          applied: false,
          line: describeRetentionState(target, before),
          error: `this store cannot hold a ${retainDays}-day window (it would become ${before.wouldBecome} days)`,
        });
        continue;
      }
      if (before.state === 'matches' || !apply) {
        outcomes.push({
          target,
          before,
          after: before,
          applied: false,
          line: describeRetentionState(target, before),
        });
        continue;
      }
      const merged = mergeLakeRule(current.rules, desiredLakeRule(target.prefix, retainDays));
      const written = await seaweedfsObjectStore.setLifecycle(target.bucket, merged);
      // RE-READ, not assumed: the store may rename or rewrite a rule, and reporting what we sent
      // would claim a state the bucket does not hold.
      const after = written.supported
        ? retentionStateFor(target, written.rules, retainDays)
        : null;
      outcomes.push({
        target,
        before,
        after,
        applied: after?.state === 'matches',
        line: after
          ? `${describeRetentionState(target, before)} Now ${describeRetentionState(target, after).replace(/^[^:]+: /, '')}`
          : `${describeRetentionState(target, before)} The change was refused: ${written.note ?? 'unknown reason'}.`,
        error: after ? undefined : (written.note ?? 'the retention rule was refused'),
      });
    } catch (e) {
      // A failure must never present as "this destination is compliant".
      outcomes.push({
        target,
        before: { state: 'absent' },
        after: null,
        applied: false,
        line: `${target.domainLabel}: retention could not be checked or applied.`,
        error: e instanceof Error ? e.message : 'unknown failure',
      });
    }
  }

  const complete =
    outcomes.length === 0 ||
    outcomes.every((o) => o.after?.state === 'matches');
  return {
    retainDays,
    outcomes,
    complete,
    summary: summarise(outcomes, retainDays),
  };
}

function summarise(outcomes: readonly LakeRetentionOutcome[], retainDays: number): string {
  if (outcomes.length === 0) {
    // Genuinely nothing to bound, said plainly — not dressed up as a pass.
    return 'No workflow writes files to the object store, so there is nothing here to keep or remove.';
  }
  const ok = outcomes.filter((o) => o.after?.state === 'matches').length;
  const changed = outcomes.filter((o) => o.applied).length;
  const failed = outcomes.filter((o) => o.error).length;
  const parts = [`${ok}/${outcomes.length} destinations keep files ${retainDays} days`];
  if (changed) parts.push(`${changed} corrected`);
  if (failed) parts.push(`${failed} could NOT be set`);
  return `${parts.join('; ')}.`;
}
