import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  consumerChip,
  isDanglingBinding,
  lookupIn,
} from '../src/lib/pipeline-chip-policy.ts';
import { explicitConsumerPipelineId } from '../src/lib/pipeline-chip.ts';

test('App and runtime-agent chips never inherit the org Chat default', () => {
  assert.equal(explicitConsumerPipelineId(null), null);
  assert.equal(explicitConsumerPipelineId(undefined), null);
  assert.equal(explicitConsumerPipelineId('   '), null);
  assert.equal(explicitConsumerPipelineId(' pl_claims '), 'pl_claims');
});

// ─── G-COH-PIPE-404: a dangling binding must be distinguishable from a healthy one ────────────────
//
// The shipped defect: the resolver did `name ?? id`, so a pipeline that did not exist produced a chip
// identical in shape to a real binding — labelled with its own id, linking to a page that 404'd. These
// tests lock the distinction that fix depends on.

test('a bound id whose pipeline exists is a healthy chip', () => {
  assert.deepEqual(consumerChip('pl_claims', { found: true, name: 'Claims triage' }), {
    id: 'pl_claims',
    name: 'Claims triage',
    inherited: false,
  });
});

test('a bound id with NO matching pipeline is marked missing, not silently labelled with its id', () => {
  const chip = consumerChip('pl_seed_org_bharat_cross-sell-advisor', { found: false });
  assert.equal(chip.missing, true);
  assert.equal(chip.id, 'pl_seed_org_bharat_cross-sell-advisor');
  // The id is still exposed — an operator repairing the binding needs to see what it points at.
  assert.equal(chip.name, 'pl_seed_org_bharat_cross-sell-advisor');
});

test('unbound and missing are DIFFERENT states — collapsing them would hide the breakage', () => {
  const unbound = consumerChip(null, { found: false });
  assert.deepEqual(unbound, { id: null });
  assert.notEqual(unbound.missing, true);

  const missing = consumerChip('pl_gone', { found: false });
  assert.equal(missing.missing, true);
  assert.notEqual(missing.id, null);
});

test('a blank binding is unbound regardless of what a lookup claims to have found', () => {
  // Guards the ordering: we must not report a whitespace binding as a resolvable pipeline.
  assert.deepEqual(consumerChip('   ', { found: true, name: 'Somehow' }), { id: null });
});

test('a found pipeline with a blank or absent name falls back to its id, still healthy', () => {
  for (const name of ['', '   ', null, undefined]) {
    const chip = consumerChip('pl_x', { found: true, name });
    assert.equal(chip.name, 'pl_x');
    assert.notEqual(chip.missing, true, `blank name must not read as missing (name=${String(name)})`);
  }
});

test('a found name is trimmed', () => {
  assert.equal(consumerChip('pl_x', { found: true, name: '  Claims  ' }).name, 'Claims');
});

test('lookupIn treats an absent key as an absent pipeline', () => {
  const names = new Map([['pl_a', 'Alpha']]);
  assert.deepEqual(lookupIn(names, 'pl_a'), { found: true, name: 'Alpha' });
  assert.deepEqual(lookupIn(names, 'pl_missing'), { found: false });
});

test('isDanglingBinding fires only for a bound-but-absent pipeline', () => {
  assert.equal(isDanglingBinding(consumerChip('pl_gone', { found: false })), true);
  assert.equal(isDanglingBinding(consumerChip('pl_a', { found: true, name: 'A' })), false);
  assert.equal(isDanglingBinding(consumerChip(null, { found: false })), false);
});
