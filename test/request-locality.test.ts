// Every case below is a real (gateway, model) pair read off the live gateway index for the two demo
// tenants. This decides the percentage a buyer is shown under "your data does not leave your
// network", so the interesting question is never the happy path — it is which way the number moves
// when we are not sure.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  localSharePct,
  modelLocality,
  ranOnOwnHardware,
  servedByNamedNode,
  tallyEgress,
} from '@/lib/request-locality';

// org_bharat, verbatim: 185 requests.
const BHARAT = [
  ...Array(56).fill({ gateway: 'g1', model: 'qwen3-vl-8b' }),
  ...Array(53).fill({ gateway: 'qwen2.5:14b', model: 'qwen2.5:14b' }),
  ...Array(19).fill({ gateway: 'g1', model: 'all-MiniLM-L6-v2' }),
  ...Array(18).fill({ gateway: 'g5', model: 'all-MiniLM-L6-v2' }),
  ...Array(18).fill({ gateway: 'g7', model: 'all-MiniLM-L6-v2' }),
  ...Array(16).fill({ gateway: 'g3', model: 'qwen35-2b' }),
  ...Array(4).fill({ gateway: 'gpt-4o-mini', model: 'gpt-4o-mini' }),
  ...Array(1).fill({ gateway: 'g5', model: 'gemma-local' }),
];

test('a named serving node is proof, whatever the model is called', () => {
  // all-MiniLM-L6-v2 is in no catalogue and contains no "local" — the node is the whole evidence.
  assert.equal(ranOnOwnHardware({ gateway: 'g1', model: 'all-MiniLM-L6-v2' }), true);
  assert.equal(ranOnOwnHardware({ gateway: 'g3', model: 'qwen35-2b' }), true);
});

test('the aggregator echoing the model into the node field is NOT a node', () => {
  // When it has no node to name it repeats the model tag. Reading that as a node called
  // "gpt-4o-mini" would count a hosted OpenAI call as on-prem — the exact inversion of the claim.
  assert.equal(servedByNamedNode({ gateway: 'gpt-4o-mini', model: 'gpt-4o-mini' }), false);
  assert.equal(servedByNamedNode({ gateway: 'qwen2.5:14b', model: 'qwen2.5:14b' }), false);
  assert.equal(ranOnOwnHardware({ gateway: 'gpt-4o-mini', model: 'gpt-4o-mini' }), false);
});

test('a model that probably runs downstairs still does not count without proof', () => {
  // qwen2.5:14b and llama3.1:70b are Ollama-style tags; they almost certainly run on this fleet. They
  // are excluded anyway. "Almost certainly" is not something to put in front of a buyer, and the
  // published figure has to under-state rather than over-state.
  assert.equal(ranOnOwnHardware({ gateway: 'qwen2.5:14b', model: 'qwen2.5:14b' }), false);
  assert.equal(ranOnOwnHardware({ gateway: 'llama3.1:70b', model: 'llama3.1:70b' }), false);
});

test('the live tenant computes to its real share, not to 1%', () => {
  // The shipped number was 1% — a substring test against the model name — against a truth of 69%.
  assert.equal(localSharePct(BHARAT), 69);
});

test('no traffic yields null, never 0%', () => {
  // 0% is the worst sentence this product can say about itself. Saying it because nothing was
  // recorded, rather than because everything left, is a lie in the most damaging direction.
  assert.equal(localSharePct([]), null);
});

test('a request with no gateway at all falls back to the catalogue', () => {
  assert.equal(ranOnOwnHardware({ model: 'onprem/anything' }), true);
  assert.equal(ranOnOwnHardware({ model: 'compat:openai/gpt-4o' }), false);
  assert.equal(ranOnOwnHardware({ gateway: '', model: 'qwen3-vl-8b' }), true);
});

test('a node id is a bare host label — a routed path is not', () => {
  assert.equal(servedByNamedNode({ gateway: 'openai/gpt-4o', model: 'gpt-4o' }), false);
  assert.equal(servedByNamedNode({ gateway: 'g1', model: 'anything' }), true);
});

test('locality is three-way — "not proven local" is not the same as "it left"', () => {
  // Two states force a lie in one direction or the other. An unrecognised Ollama tag reported as
  // egress claims data left the building when it probably did not — the original bug, inverted.
  assert.equal(modelLocality('qwen3-vl-8b'), 'fleet');
  assert.equal(modelLocality('onprem/anything'), 'fleet');
  assert.equal(modelLocality('claude-3-5-haiku-latest'), 'hosted');
  assert.equal(modelLocality('gpt-4o-mini'), 'hosted');
  assert.equal(modelLocality('compat:openai/whatever'), 'hosted');
  assert.equal(modelLocality('qwen2.5:14b'), 'unknown');
  assert.equal(modelLocality('llama3.1:70b'), 'unknown');
  assert.equal(modelLocality(''), 'unknown');
});

test('the tally accounts for every request and never folds unknown into a claim', () => {
  const t = tallyEgress([
    { gateway: 'g1', model: 'qwen3-vl-8b' },
    { gateway: 'claude-3-5-haiku-latest', model: 'claude-3-5-haiku-latest' },
    { gateway: 'llama3.1:70b', model: 'llama3.1:70b' },
  ]);
  assert.deepEqual(t, { total: 3, fleet: 1, hosted: 1, unknown: 1 });
  assert.equal(t.fleet + t.hosted + t.unknown, t.total, 'every request is accounted for');
});

test('the insurer has provable egress — the front page said it had none', () => {
  // 9 Claude calls, under a tile reading "cloud egress 0% — fully on-prem — nothing left".
  const insurer = [
    ...Array(74).fill({ gateway: 'g1', model: 'qwen3-vl-8b' }),
    ...Array(42).fill({ gateway: 'llama3.1:70b', model: 'llama3.1:70b' }),
    ...Array(9).fill({ gateway: 'claude-3-5-haiku-latest', model: 'claude-3-5-haiku-latest' }),
    ...Array(2).fill({ gateway: 'g3', model: 'qwen35-2b' }),
  ];
  assert.ok(tallyEgress(insurer).hosted > 0, 'nine hosted calls is not "nothing left"');
});
