import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RETAINABLE_CLASSES,
  isRetainableClass,
  planSweep,
  summariseSweep,
  type RetentionRule,
} from '../src/lib/retention-sweep.ts';

const NOW = new Date('2026-08-05T00:00:00.000Z');
const rule = (over: Partial<RetentionRule> = {}): RetentionRule => ({
  recordClass: 'app_runs',
  retainDays: 30,
  action: 'delete',
  ...over,
});

test('FILES WRITTEN TO THE OBJECT STORE ARE A RETAINABLE CLASS', () => {
  // Added when apps gained the ability to WRITE there. Before that the surface said lake purging was
  // deferred to the data engine — honest then, a hole once a governed run could accumulate files that
  // no policy bounded while the console still claimed a retention limit.
  assert.equal(isRetainableClass('lake_objects'), true);
  assert.ok(RETAINABLE_CLASSES.some((c) => c.id === 'lake_objects'));
  // Described in the reader's words, with no storage vocabulary.
  const c = RETAINABLE_CLASSES.find((x) => x.id === 'lake_objects')!;
  assert.doesNotMatch(`${c.label} ${c.detail}`, /S3|bucket|lifecycle|SeaweedFS/i);
});

test('A CLASS WITH NO RULE READS AS A GAP, never as compliance', () => {
  // The whole point of the skip list: "nothing happened" must never be indistinguishable from "nothing
  // needed to happen".
  const plan = planSweep([rule()], NOW);
  const skippedIds = plan.skipped.map((s) => s.recordClass);
  for (const c of RETAINABLE_CLASSES) {
    if (c.id === 'app_runs') continue;
    assert.ok(skippedIds.includes(c.id), `${c.id} must be reported as unset`);
  }
  assert.match(plan.skipped[0].reason, /kept forever by default/i);
});

test('the window is carried as DAYS as well as a cutoff instant', () => {
  // A database sweep needs the instant. A store that expires files on its own schedule needs the
  // number of days, because that is what its rule says — and deriving days back out of a cutoff would
  // drift by one depending on when the sweep happened to run.
  const [target] = planSweep([rule({ retainDays: 3650 })], NOW).targets;
  assert.equal(target.retainDays, 3650);
  assert.equal(target.cutoff.toISOString(), new Date(NOW.getTime() - 3650 * 86_400_000).toISOString());
});

test('legal hold and keep-indefinitely are DIFFERENT reasons, not one silence', () => {
  const held = planSweep([rule({ legalHold: true })], NOW);
  assert.equal(held.targets.length, 0);
  assert.match(held.skipped.find((s) => s.recordClass === 'app_runs')!.reason, /legal hold/i);

  const forever = planSweep([rule({ retainDays: 0 })], NOW);
  assert.equal(forever.targets.length, 0);
  assert.match(forever.skipped.find((s) => s.recordClass === 'app_runs')!.reason, /indefinitely/i);

  // A nonsense window is not treated as a window.
  assert.equal(planSweep([rule({ retainDays: Number.NaN })], NOW).targets.length, 0);
  assert.equal(planSweep([rule({ retainDays: -5 })], NOW).targets.length, 0);
});

test('an unfinished sweep does not summarise as done', () => {
  const line = summariseSweep([
    { recordClass: 'lake_objects', action: 'delete', affected: 1, remaining: 2 },
  ]);
  // `remaining > 0` means the policy is not yet true; the sentence must not read as a clean pass.
  assert.doesNotMatch(line, /^Nothing was out of retention$/);
  assert.equal(summariseSweep([]), 'Nothing was out of retention');
});
