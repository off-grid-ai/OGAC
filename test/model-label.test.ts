import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelLabel } from '../src/lib/model-catalog.ts';
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
