// ─── ADVERSARIAL break-test: webhook payload clamping is top-level-only (G-ADV-BUILD-5) ───────────
//
// RED against wave2 HEAD, `.skip`-gated (see docs/adversarial/builder.md). buildTriggerInput's own
// docstring promises "Unknown/oversized junk is dropped defensively — this input crosses into the
// governed pipeline, so it stays small and typed." That guarantee is FALSE below the top level.
//
// THE BREAK (proven): trigger-dispatch.sanitizeBody (trigger-dispatch.ts:132) only clamps TOP-LEVEL
// string values (clampText fires on `typeof v === 'string'` at depth 0). Anything nested passes
// through UNBOUNDED into the app-run input a hostile webhook can control:
//   • a 5 MB string one level down ({wrap:{deep:"y"×5_000_000}}) → passed at full length (cap is 100k),
//   • a 200k-element array under a key → passed whole,
//   • 5000-deep nesting → passed whole.
// Terminal artifact: the normalized `input.body` that submitAppRun feeds the governed pipeline still
// carries the oversized/nested blob — a pre-governance memory/DoS amplifier the module claims to bound.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTriggerInput } from '@/lib/trigger-dispatch';

const SKIP = 'ADVERSARIAL: RED — G-ADV-BUILD-5 (webhook payload clamp is top-level-only) open; see docs/adversarial/builder.md';
const MAX_TEXT = 100_000; // the cap the module applies to top-level strings

test('ADVERSARIAL G-ADV-BUILD-5: a nested oversized string must be clamped like a top-level one', { skip: SKIP }, () => {
  const payload = { wrap: { deep: 'y'.repeat(5_000_000) } };
  const input = buildTriggerInput('webhook', payload);
  const deep = (input.body as { wrap?: { deep?: string } })?.wrap?.deep ?? '';
  assert.ok(
    deep.length <= MAX_TEXT,
    `nested string must be clamped to <= ${MAX_TEXT}; passed through at ${deep.length}`,
  );
});

test('ADVERSARIAL G-ADV-BUILD-5: a huge nested array must be bounded before it enters the pipeline', { skip: SKIP }, () => {
  const payload = { data: new Array(200_000).fill('x') };
  const input = buildTriggerInput('webhook', payload);
  const arr = (input.body as { data?: unknown[] })?.data ?? [];
  assert.ok(
    Array.isArray(arr) && arr.length <= 10_000,
    `nested array must be bounded (<= 10k elements); passed through at ${(arr as unknown[]).length}`,
  );
});

test('ADVERSARIAL G-ADV-BUILD-5: deeply-nested objects must be depth-bounded', { skip: SKIP }, () => {
  const deepNest: Record<string, unknown> = {};
  let cur = deepNest;
  for (let i = 0; i < 5000; i++) {
    cur.n = {};
    cur = cur.n as Record<string, unknown>;
  }
  const input = buildTriggerInput('webhook', deepNest);
  let depth = 0;
  let c = (input.body as { n?: unknown })?.n;
  while (c && typeof c === 'object' && (c as { n?: unknown }).n) {
    depth += 1;
    c = (c as { n?: unknown }).n;
  }
  assert.ok(depth <= 32, `nesting must be depth-bounded (<= 32); passed through at depth ${depth}`);
});
