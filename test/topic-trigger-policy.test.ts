import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceCursor,
  deliveryKey,
  describeTopicTrigger,
  dispositionFor,
  mayCommitOffset,
  parseTopicTriggerConfig,
  planTopicConsume,
  type StreamRecord,
} from '../src/lib/topic-trigger-policy.ts';

const rec = (over: Partial<StreamRecord> = {}): StreamRecord => ({
  topic: 'offgrid.claims.submitted',
  partition: 0,
  offset: '41',
  value: '{"claimId":"CLM-9931"}',
  ...over,
});

test('THE RULE THIS EXISTS FOR: an offset is never committed before the run is DURABLE', () => {
  // Commit-then-run silently destroys enterprise work: the record leaves the queue and no run exists.
  const d = dispositionFor(rec(), new Set());
  assert.equal(d.act, 'run');
  assert.equal(mayCommitOffset(d, false), false); // ran but not persisted → do NOT commit
  assert.equal(mayCommitOffset(d, true), true);
});

test('a duplicate and a parked record MUST commit, or the partition jams forever', () => {
  const dup = dispositionFor(rec(), new Set([deliveryKey(rec())]));
  assert.equal(dup.act, 'skip-duplicate');
  // Even with nothing persisted this commits — withholding it redelivers the same record endlessly.
  assert.equal(mayCommitOffset(dup, false), true);

  const parked = dispositionFor(rec({ value: '   ' }), new Set());
  assert.equal(parked.act, 'park');
  assert.equal(mayCommitOffset(parked, false), true);
});

test('duplicates are keyed on the broker triple, NOT the payload', () => {
  // Two identical instructions sent deliberately are two units of work. Collapsing them by content
  // would silently drop one — the failure mode is invisible and unrecoverable.
  const first = rec({ offset: '41' });
  const second = rec({ offset: '42' }); // same value, different offset
  const seen = new Set([deliveryKey(first)]);
  assert.equal(dispositionFor(first, seen).act, 'skip-duplicate');
  assert.equal(dispositionFor(second, seen).act, 'run');
});

test('the same offset on a different partition is a different record', () => {
  const seen = new Set([deliveryKey(rec({ partition: 0, offset: '7' }))]);
  assert.equal(dispositionFor(rec({ partition: 1, offset: '7' }), seen).act, 'run');
});

test('offsets are compared as given, so a value beyond 2^53 stays exact', () => {
  // Carried as strings deliberately: as numbers these two collapse to the same value.
  const a = rec({ offset: '9007199254740993' });
  const b = rec({ offset: '9007199254740992' });
  assert.notEqual(deliveryKey(a), deliveryKey(b));
  assert.equal(dispositionFor(a, new Set([deliveryKey(b)])).act, 'run');
});

test('an oversized record is parked on BYTE length, not character count', () => {
  // 400k multibyte characters is over a 1MB cap while `length` says otherwise.
  const multibyte = '₹'.repeat(400_000); // 3 bytes each = 1.2MB
  const d = dispositionFor(rec({ value: multibyte }), new Set());
  assert.equal(d.act, 'park');
  assert.match(d.reason, /1200000 bytes/);
  // And a payload that is long but within the cap still runs.
  assert.equal(dispositionFor(rec({ value: 'a'.repeat(999_999) }), new Set()).act, 'run');
});

test('a missing consumer group is refused, with the reason that matters stated', () => {
  const r = parseTopicTriggerConfig({ topic: 'offgrid.claims.submitted' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.problems, ['group-missing']);
  // Without a group every process consumes every record — indistinguishable from a duplicate bug.
  assert.match(r.sentence, /run more than once/);
});

test('every problem is reported at once, not one per attempt', () => {
  const r = parseTopicTriggerConfig({});
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.problems, ['topic-missing', 'group-missing']);
});

test('broker-illegal names are refused here rather than at subscribe time', () => {
  for (const bad of ['has space', 'slash/name', 'a'.repeat(250), 'quote"name']) {
    const r = parseTopicTriggerConfig({ topic: bad, groupId: 'ok-group' });
    assert.equal(r.ok, false, `expected ${bad} to be refused`);
    if (!r.ok) assert.ok(r.problems.includes('topic-invalid'));
  }
});

test('a valid config is trimmed and accepted', () => {
  const r = parseTopicTriggerConfig({ topic: '  offgrid.claims.submitted  ', groupId: ' console-claims ' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.config, { topic: 'offgrid.claims.submitted', groupId: 'console-claims' });
});

test('a non-object config does not throw', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.equal(parseTopicTriggerConfig(bad).ok, false);
  }
});

test('the copy says nothing is listening when no broker is configured', () => {
  const config = { topic: 'offgrid.claims.submitted', groupId: 'g' };
  const off = describeTopicTrigger(config, false);
  assert.match(off, /nothing is listening yet/);
  // It must not promise once-each processing when there is no consumer at all.
  assert.doesNotMatch(off, /processed once each/);
  assert.match(describeTopicTrigger(config, true), /processed once each/);
  // No broker vocabulary leaks into the surface.
  for (const s of [off, describeTopicTrigger(config, true)]) {
    assert.doesNotMatch(s, /Kafka|Redpanda|offset|partition|consumer group/i);
  }
});

// ─── the cursor plan ────────────────────────────────────────────────────────────────────────────

const part = (partition: number, lowOffset: string, highOffset: string) => ({
  partition,
  lowOffset,
  highOffset,
});

test('A NEVER-SEEN PARTITION STARTS AT THE LIVE EDGE — turning a trigger on is not a backfill', () => {
  // 40k historical records must NOT become 40k governed runs the moment someone saves the trigger.
  const plan = planTopicConsume([part(0, '0', '40000')], []);
  assert.deepEqual(plan.windows, []);
  assert.deepEqual(plan.initialised, [{ partition: 0, nextOffset: '40000' }]);
});

test('an initialised partition then reads only what arrives after it', () => {
  const plan = planTopicConsume([part(0, '0', '40003')], [{ partition: 0, nextOffset: '40000' }]);
  assert.deepEqual(plan.windows, [{ partition: 0, fromOffset: '40000', toOffset: '40002' }]);
});

test('caught up means no window at all, not an empty read', () => {
  assert.deepEqual(
    planTopicConsume([part(0, '0', '12')], [{ partition: 0, nextOffset: '12' }]).windows,
    [],
  );
});

test('records deleted by retention before we read them are REPORTED, never silently skipped', () => {
  // The cursor is behind the earliest surviving record: work was lost. Saying nothing would present
  // data loss as a normal quiet cycle.
  const plan = planTopicConsume([part(0, '900', '1000')], [{ partition: 0, nextOffset: '500' }]);
  assert.deepEqual(plan.lost, [{ partition: 0, from: '500', to: '900', missed: '400' }]);
  // And it resumes from the earliest record that still exists rather than stalling forever.
  assert.deepEqual(plan.windows, [{ partition: 0, fromOffset: '900', toOffset: '999' }]);
});

test('A BUSY PARTITION CANNOT STARVE THE OTHERS — every partition progresses every cycle', () => {
  // Spending the budget in partition order would mean a permanently busy partition 0 consumes it all,
  // and a record on partition 2 waits forever. Each gets an equal share instead.
  const plan = planTopicConsume(
    [part(0, '0', '100000'), part(1, '0', '100000'), part(2, '0', '100000')],
    [0, 1, 2].map((partition) => ({ partition, nextOffset: '0' })),
    9,
  );
  assert.deepEqual(plan.windows, [
    { partition: 0, fromOffset: '0', toOffset: '2' },
    { partition: 1, fromOffset: '0', toOffset: '2' },
    { partition: 2, fromOffset: '0', toOffset: '2' },
  ]);
});

test('a quiet partition hands its unused share to one with a backlog', () => {
  // Fairness must not become waste: partition 1 has a single record, so the other 9 slots go to 0.
  const plan = planTopicConsume(
    [part(0, '0', '100000'), part(1, '0', '1')],
    [
      { partition: 0, nextOffset: '0' },
      { partition: 1, nextOffset: '0' },
    ],
    10,
  );
  assert.deepEqual(plan.windows, [
    { partition: 0, fromOffset: '0', toOffset: '8' },
    { partition: 1, fromOffset: '0', toOffset: '0' },
  ]);
});

test('an unread remainder is left for the next cycle, never dropped', () => {
  const first = planTopicConsume([part(0, '0', '100')], [{ partition: 0, nextOffset: '0' }], 10);
  assert.deepEqual(first.windows, [{ partition: 0, fromOffset: '0', toOffset: '9' }]);
  const second = planTopicConsume([part(0, '0', '100')], [{ partition: 0, nextOffset: '10' }], 10);
  assert.deepEqual(second.windows, [{ partition: 0, fromOffset: '10', toOffset: '19' }]);
});

test('offsets past 2^53 are planned exactly', () => {
  const plan = planTopicConsume(
    [part(0, '0', '9007199254740995')],
    [{ partition: 0, nextOffset: '9007199254740993' }],
  );
  assert.deepEqual(plan.windows, [
    { partition: 0, fromOffset: '9007199254740993', toOffset: '9007199254740994' },
  ]);
});

test('the cursor never rewinds, so a late acknowledgement cannot re-run finished work', () => {
  assert.equal(advanceCursor(undefined, '7'), '8');
  assert.equal(advanceCursor('8', '9'), '10');
  assert.equal(advanceCursor('10', '3'), '10'); // out-of-order ack is ignored
  assert.equal(advanceCursor('9007199254740993', '9007199254740993'), '9007199254740994');
});
