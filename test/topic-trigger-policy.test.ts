import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deliveryKey,
  describeTopicTrigger,
  dispositionFor,
  mayCommitOffset,
  parseTopicTriggerConfig,
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
