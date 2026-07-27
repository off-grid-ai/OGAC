import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractUsage } from '../src/lib/agentrun.ts';
import { costForTokens } from '../src/lib/finops.ts';

// Phase 4.11 DoD: audit events must carry tokens AND cost ("who did what, and what it cost").
// The agent-run path asked the gateway, got {choices, usage} back, and discarded the usage — so every
// agent.run audit row landed with null tokens and null cost, and per-user spend was unattributable.

test('the gateway usage block becomes a run usage record', () => {
  assert.deepEqual(
    extractUsage({
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 812, completion_tokens: 64, total_tokens: 876 },
    }),
    { prompt: 812, completion: 64, total: 876 },
  );
});

test('a gateway that reports only the parts still yields a usable total', () => {
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 100, completion_tokens: 25 } }), {
    prompt: 100,
    completion: 25,
    total: 125,
  });
});

test('an explicit total is trusted over the sum of the parts', () => {
  // Some gateways count differently (cached prompt tokens, reasoning tokens). Their total is the
  // billable figure; recomputing it would quietly disagree with the provider's own accounting.
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 99 } }), {
    prompt: 10,
    completion: 5,
    total: 99,
  });
});

test('no usage reported is null, NOT a zero-cost run', () => {
  // "The gateway did not report usage" and "this run cost nothing" are different claims. Recording
  // the second when the first is true understates spend silently — the exact failure this fixes.
  assert.equal(extractUsage({ choices: [{ message: { content: 'hi' } }] }), null);
  assert.equal(extractUsage({ usage: {} }), null);
  assert.equal(extractUsage({ usage: { prompt_tokens: 0, completion_tokens: 0 } }), null);
  assert.equal(extractUsage(null), null);
  assert.equal(extractUsage(undefined), null);
  assert.equal(extractUsage('nonsense'), null);
  assert.equal(extractUsage({ usage: 'nope' }), null);
});

test('garbage or negative counts never become negative usage', () => {
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: -5, completion_tokens: 20 } }), {
    prompt: 0,
    completion: 20,
    total: 20,
  });
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 'abc', total_tokens: 40 } }), {
    prompt: 0,
    completion: 0,
    total: 40,
  });
});

test('string counts are accepted — some gateways serialize them', () => {
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: '30', completion_tokens: '12' } }), {
    prompt: 30,
    completion: 12,
    total: 42,
  });
});

test('fractional counts are rounded to whole tokens', () => {
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 10.4, completion_tokens: 5.6 } }), {
    prompt: 10,
    completion: 6,
    total: 16,
  });
});

test('the audited cost uses the same finops rate the spend surfaces use', () => {
  // The ledger and the rollups must not disagree by construction, so both price through costForTokens.
  const usage = extractUsage({ usage: { total_tokens: 2000 } })!;
  assert.equal(usage.total, 2000);

  const local = costForTokens('gemma-local', usage.total);
  const cloud = costForTokens('gpt-4o', usage.total);
  assert.equal(typeof local, 'number');
  assert.ok(local >= 0);
  assert.ok(cloud >= local, 'a cloud model must not price below a local one');
});

// ─── an autonomous run bills the SUM of its iterations ────────────────────────────────────────────

test('a multi-step agent run accumulates usage across every model call', async () => {
  const { sumUsage } = await import('../src/lib/agentrun.ts');

  // A ReAct loop calls the model once per iteration. Keeping only the last call would bill a
  // ten-step run as if it were its final step — the defect this guards.
  const iterations = [
    { prompt: 900, completion: 40, total: 940 },
    { prompt: 1200, completion: 55, total: 1255 },
    { prompt: 1500, completion: 30, total: 1530 },
  ];
  let running: ReturnType<typeof sumUsage> | null = null;
  for (const it of iterations) running = sumUsage(running, it);

  assert.deepEqual(running, { prompt: 3600, completion: 125, total: 3725 });
  assert.notDeepEqual(running, iterations[2], 'must not report only the final call');
});

test('the first call establishes the total; nothing is lost or double-counted', async () => {
  const { sumUsage } = await import('../src/lib/agentrun.ts');
  const one = { prompt: 10, completion: 2, total: 12 };

  assert.deepEqual(sumUsage(null, one), one);
  assert.deepEqual(sumUsage(one, { prompt: 0, completion: 0, total: 0 }), one);
});

test('accumulated cost equals the cost of the accumulated tokens', async () => {
  const { sumUsage } = await import('../src/lib/agentrun.ts');
  const a = { prompt: 1000, completion: 100, total: 1100 };
  const b = { prompt: 500, completion: 50, total: 550 };
  const combined = sumUsage(a, b);

  // Pricing the summed total must match summing the priced parts, or a multi-step run's audited
  // cost would disagree with the spend rollup.
  assert.equal(
    costForTokens('gpt-4o', combined.total),
    costForTokens('gpt-4o', a.total) + costForTokens('gpt-4o', b.total),
  );
});
