import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeImageRequest } from '../src/lib/imagegen.ts';

test('normalizeImageRequest requires a prompt', () => {
  assert.equal(normalizeImageRequest(null).ok, false);
  assert.equal(normalizeImageRequest({ prompt: '  ' }).ok, false);
});

test('normalizeImageRequest clamps steps and snaps size to an allowed dimension', () => {
  const v = normalizeImageRequest({ prompt: 'a cat', steps: 999, width: 800, height: 500 }).value!;
  assert.equal(v.steps, 50, 'steps clamped to 50');
  assert.equal(v.width, 768, '800 snaps to nearest allowed (768)');
  assert.equal(v.height, 512, '500 snaps to nearest allowed (512)');
});

test('normalizeImageRequest defaults + seed handling', () => {
  const v = normalizeImageRequest({ prompt: 'a dog' }).value!;
  assert.equal(v.width, 768);
  assert.equal(v.height, 768);
  assert.equal(v.steps, 20);
  assert.equal(v.seed, -1, 'no seed → -1 (random)');
  assert.equal(v.negativePrompt, '');
  assert.equal(normalizeImageRequest({ prompt: 'x', seed: 42 }).value!.seed, 42);
});
