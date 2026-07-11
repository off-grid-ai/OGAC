import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getModelSpec, modelLabel } from '../src/lib/model-catalog.ts';
test('modelLabel: catalog names, no codenames, prettified tags', () => {
  assert.equal(modelLabel('qwythos-9b'), 'Qwen 9B (fleet)');       // codename -> friendly
  assert.equal(modelLabel('onprem/qwythos-9b'), 'Qwen 9B (fleet)'); // provider prefix stripped
  assert.equal(modelLabel('gemma-4-e4b'), 'Gemma 4 E4B');
  assert.equal(modelLabel('llama3.1:70b'), 'Llama 3.1 70B');       // raw ollama tag prettified
  assert.equal(modelLabel('gemma-local'), 'Gemma Local');
  assert.equal(modelLabel(''), 'Default model');
  assert.equal(modelLabel(null), 'Default model');
  // never leaks the codename
  assert.ok(!/qwythos/i.test(modelLabel('qwythos-9b')));
});

test('modelLabel: the 4 leaking fleet codenames map to friendly names (no raw codename leaks)', () => {
  // Every raw internal codename the gateway UI can render must resolve to a catalog display name,
  // NOT an ugly prettified tag. These are the exact ids that were leaking on the Control tab.
  assert.equal(modelLabel('qwythos-9b'), 'Qwen 9B (fleet)');
  assert.equal(modelLabel('gemma-4-e4b'), 'Gemma 4 E4B');
  assert.equal(modelLabel('qwen3-vl-8b'), 'Qwen3-VL 8B Instruct');
  // versioned live fleet tag resolves via the catalog alias — never "Juggernaut Xl V 9"
  assert.equal(modelLabel('juggernaut-xl-v9'), 'Juggernaut XL v9');
  assert.equal(modelLabel('juggernaut-xl'), 'Juggernaut XL v9');

  // None of the friendly names leak a raw codename fragment.
  for (const id of ['qwythos-9b', 'gemma-4-e4b', 'qwen3-vl-8b', 'juggernaut-xl-v9']) {
    assert.ok(!/qwythos|juggernaut-xl-v9/i.test(modelLabel(id)), `${id} leaks a codename`);
  }
});

test('getModelSpec: aliases resolve to the canonical spec (case-insensitive)', () => {
  const canonical = getModelSpec('juggernaut-xl');
  assert.ok(canonical, 'canonical spec exists');
  assert.equal(getModelSpec('juggernaut-xl-v9'), canonical); // alias -> same spec object
  assert.equal(getModelSpec('JUGGERNAUT-XL-V9'), canonical); // case-insensitive alias match
  assert.equal(getModelSpec('no-such-model'), undefined);    // unknown id -> undefined
});
