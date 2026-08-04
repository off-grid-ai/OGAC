import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FILTERED_PAYLOAD_FIELDS,
  SCAN_TOLERANCE_POINTS,
  describePayloadIndexes,
  parsePayloadIndexes,
  recommendPayloadIndexes,
  validateIndexRequest,
} from '../src/lib/qdrant-payload-index.ts';

// The shapes here are the REAL ones the deployed Qdrant returned on 2026-08-04 — before any index existed
// (`payload_schema: {}`) and after creating them (`org_id` keyword / `text` text, 3 points each).

test('parses the payload_schema Qdrant actually returns', () => {
  const parsed = parsePayloadIndexes({
    points_count: 3,
    payload_schema: {
      org_id: { data_type: 'keyword', points: 3 },
      text: { data_type: 'text', points: 3 },
    },
  });
  assert.deepEqual(parsed.map((p) => [p.field, p.type, p.points]), [
    ['org_id', 'keyword', 3],
    ['text', 'text', 3],
  ]);
});

test('an empty or absent schema is no indexes, not a crash', () => {
  assert.deepEqual(parsePayloadIndexes({ payload_schema: {} }), []);
  assert.deepEqual(parsePayloadIndexes({}), []);
  assert.deepEqual(parsePayloadIndexes(null), []);
});

test('an unexpected schema value degrades to unknown rather than throwing', () => {
  const parsed = parsePayloadIndexes({ payload_schema: { weird: 'not-an-object' } });
  assert.deepEqual(parsed, [{ field: 'weird', type: 'unknown', points: null }]);
});

test('the tenant-isolation field is recommended when missing — this was the live finding', () => {
  const recs = recommendPayloadIndexes([], 3);
  assert.deepEqual(recs.map((r) => r.field).sort(), ['org_id', 'text']);
  const org = recs.find((r) => r.field === 'org_id')!;
  assert.equal(org.type, 'keyword');
  // Reported even on a tiny collection — a recommendation that appears only once the store is slow
  // arrives after the problem.
  assert.equal(org.smallForNow, true);
  assert.match(org.why, /every governed retrieval/);
});

test('a large collection drops the not-urgent flag and the copy sharpens', () => {
  const recs = recommendPayloadIndexes([], SCAN_TOLERANCE_POINTS + 1);
  assert.ok(recs.every((r) => r.smallForNow === false));
  const s = describePayloadIndexes([], recs, SCAN_TOLERANCE_POINTS + 1);
  assert.match(s, /are scanning/);
  assert.doesNotMatch(s, /still cheap/);
});

test('nothing is recommended once every filtered field is indexed', () => {
  const present = FILTERED_PAYLOAD_FIELDS.map((f) => ({ field: f.field, type: f.type, points: 3 }));
  assert.deepEqual(recommendPayloadIndexes(present, 3), []);
  assert.match(describePayloadIndexes(present, [], 3), /Every field this platform filters on is indexed/);
});

test('an index we do not query is not recommended — an index costs memory and writes', () => {
  const recs = recommendPayloadIndexes([], 3, []);
  assert.deepEqual(recs, []);
  assert.match(describePayloadIndexes([], recs, 3), /needs no payload indexes/);
});

test('a field name that would reach a REST path is refused, with something actionable', () => {
  for (const bad of ['', '  ', 'org id', '1org', 'org/../id', 'a'.repeat(80)]) {
    const r = validateIndexRequest(bad, 'keyword');
    assert.equal(r.ok, false, `"${bad}" must be refused`);
    if (!r.ok) assert.ok(r.error.length > 10, 'the error must tell the person what is allowed');
  }
  const good = validateIndexRequest(' org_id ', 'KEYWORD');
  assert.deepEqual(good.ok ? [good.field, good.type] : null, ['org_id', 'keyword']);
});

test('an unknown index type is refused and the valid ones are named', () => {
  const r = validateIndexRequest('org_id', 'nope');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /keyword/);
});
