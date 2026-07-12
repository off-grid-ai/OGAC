import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableKindFilters } from '../src/lib/edge-view.ts';

// PURE unit tests for the edge (network gateway) view helpers — no DB, no network. They pin the rule
// that the kind-filter chips are driven by the ACTUAL events present, so a "429" (rate-limit) chip
// never appears when the edge is quiet (which would contradict the "0 blocks / 0 requests" band).
// Real function, no mocks.

test('empty events → only "all" (no waf, no rate-limit chip)', () => {
  const kinds = availableKindFilters([]);
  assert.deepEqual(kinds, ['all']);
  assert.ok(!kinds.includes('rate-limit'), 'must not offer 429 when there are no events');
  assert.ok(!kinds.includes('waf'), 'must not offer WAF when there are no events');
});

test('only waf events → ["all","waf"] (no rate-limit chip)', () => {
  const kinds = availableKindFilters([{ kind: 'waf' }, { kind: 'waf' }]);
  assert.deepEqual(kinds, ['all', 'waf']);
  assert.ok(!kinds.includes('rate-limit'));
});

test('only rate-limit events → ["all","rate-limit"] (no waf chip)', () => {
  const kinds = availableKindFilters([{ kind: 'rate-limit' }]);
  assert.deepEqual(kinds, ['all', 'rate-limit']);
  assert.ok(!kinds.includes('waf'));
});

test('both kinds present → all three chips, in stable order', () => {
  const kinds = availableKindFilters([{ kind: 'rate-limit' }, { kind: 'waf' }]);
  assert.deepEqual(kinds, ['all', 'waf', 'rate-limit']);
});
