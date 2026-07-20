import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runChecks } from '@/lib/checks';

test('pre-checks reuse one authoritative PII scan across the check chain', async () => {
  let scans = 0;
  const input = 'governed connector evidence';

  const checks = await runChecks(
    'pre',
    { phase: 'pre', input },
    {
      async scanPii(text) {
        scans += 1;
        assert.equal(text, input);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          hits: false,
          entities: [],
          redacted: text,
          engine: 'test-guardrail-boundary',
          configured: true,
          status: 'applied',
        };
      },
    },
  );

  assert.equal(scans, 1, 'one guardrail verdict serves PII and rule checks for this screen');
  assert.equal(checks.find((check) => check.name === 'pii')?.verdict, 'pass');
  assert.ok(
    (checks.find((check) => check.name === 'pii')?.ms ?? 0) >= 10,
    'the PII check retains the real shared-scan latency',
  );
});
