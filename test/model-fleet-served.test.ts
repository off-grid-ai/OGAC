// "Was this answered on our own hardware" is the claim the whole product rests on, and it was being
// decided by a substring test. These cases are the tags the live fleet actually writes — a tenant
// whose traffic was 94% on-prem was reported as 1% local, and every one of these was the reason.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFleetServedModel, MODEL_CATALOG, type ModelSpec } from '@/lib/model-catalog';
import { priceFor } from '@/lib/finops';

test('the tags this fleet actually serves count as local', () => {
  // Read off audit_events_v2 for a live tenant: these five are its entire model history.
  for (const tag of ['qwen3-vl-8b', 'onprem/gemma-4-e4b', 'onprem/qwen3-vl-8b', 'gemma-local']) {
    assert.equal(isFleetServedModel(tag), true, `${tag} runs on the fleet`);
  }
});

test('a hosted API is never counted as local, whatever it is called', () => {
  for (const tag of ['compat:openai/gpt-4o-mini', 'gpt-4o', 'cloud-claude', 'compat:anthropic/x']) {
    assert.equal(isFleetServedModel(tag), false, `${tag} left the building`);
  }
});

test("the router's own prefix outranks the name underneath it", () => {
  // `onprem/` is what the gateway writes when it routed to the fleet. It is a record of what
  // happened, so it beats any inference from the model name — including for a model the catalog
  // does not know at all.
  assert.equal(isFleetServedModel('onprem/some-unlisted-model'), true);
  assert.equal(isFleetServedModel('compat:openai/gemma-local'), false);
});

test('an unrecognised model is not local — the error must count against our own claim', () => {
  // The direction matters more than the accuracy. Guessing "local" for an unknown tag would inflate
  // the one figure a buyer is being asked to take on trust.
  for (const tag of ['', 'mystery-model', 'some/thing', null, undefined]) {
    assert.equal(isFleetServedModel(tag), false, `${tag} is not evidence of anything`);
  }
});

test('a versioned fleet tag still resolves through its alias', () => {
  const aliased = MODEL_CATALOG.find((m) => m.servedOnFleet && m.aliases?.length);
  if (!aliased?.aliases?.[0]) return; // no aliased fleet spec today; nothing to assert
  assert.equal(isFleetServedModel(aliased.aliases[0]), true);
});

test('the catalog decides, not the hard-coded list — an injected spec is respected', () => {
  const catalog: ModelSpec[] = [
    {
      id: 'acme-7b',
      name: 'Acme 7B',
      family: 'llama',
      contextWindow: null,
      modality: 'text',
      paramsB: 7,
      license: null,
      servedOnFleet: true,
    },
  ];
  assert.equal(isFleetServedModel('acme-7b', catalog), true);
  assert.equal(isFleetServedModel('qwen3-vl-8b', catalog), false, 'not in THIS catalog');
});

test('a model the fleet serves is priced at zero — the on-device dividend', () => {
  // The same bug charged cloud rates for on-prem inference, which understated ROI everywhere.
  assert.equal(priceFor('qwen3-vl-8b'), 0);
  assert.equal(priceFor('onprem/gemma-4-e4b'), 0);
  assert.ok(priceFor('compat:openai/gpt-4o-mini') > 0, 'a hosted call still costs money');
});
