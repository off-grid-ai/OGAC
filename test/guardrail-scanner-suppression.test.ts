import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUARDRAIL_CATALOG, suppressedScanners } from '@/lib/guardrails-catalog';

// The rule that makes an operator's scanner toggle actually change enforcement. LLM Guard 0.3.16
// loads its scanner set from CONFIG_FILE and accepts only a per-request `scanners_suppress` list —
// before this, the console let operators disable scanners and NOTHING reached the engine, so a
// disabled scanner kept firing and the UI was lying. PURE: no I/O.

const toxicity = GUARDRAIL_CATALOG.find((i) => i.scanner === 'Toxicity')!;
const injection = GUARDRAIL_CATALOG.find((i) => i.scanner === 'PromptInjection')!;

test('no rules ⇒ nothing suppressed (adopting this never weakens a deployment)', () => {
  assert.deepEqual(suppressedScanners([]), []);
});

test('SILENCE is not a disable — only an explicit enabled:false suppresses', () => {
  assert.deepEqual(
    suppressedScanners([{ matcher: 'entity', pattern: toxicity.entity, enabled: true }]),
    [],
    'an ENABLED rule must never appear in the suppress list',
  );
});

test('an explicitly disabled scanner is suppressed by its engine CLASS name', () => {
  const out = suppressedScanners([{ matcher: 'entity', pattern: toxicity.entity, enabled: false }]);
  assert.deepEqual(out, [toxicity.scanner], 'the engine expects the class name, not the catalog token');
});

test('multiple disables are returned sorted and de-duplicated', () => {
  const out = suppressedScanners([
    { matcher: 'entity', pattern: injection.entity, enabled: false },
    { matcher: 'entity', pattern: toxicity.entity, enabled: false },
    { matcher: 'entity', pattern: toxicity.entity.toLowerCase(), enabled: false }, // case-insensitive dup
  ]);
  assert.deepEqual(out, [injection.scanner, toxicity.scanner].sort());
});

test('regex rules and non-llm-guard entities are ignored (they are not scanners)', () => {
  const out = suppressedScanners([
    { matcher: 'regex', pattern: 'SOME_REGEX', enabled: false },
    { matcher: 'entity', pattern: 'NOT_A_REAL_SCANNER_TOKEN', enabled: false },
  ]);
  assert.deepEqual(out, []);
});

test('every catalog scanner token round-trips to its class name', () => {
  for (const item of GUARDRAIL_CATALOG.filter((i) => i.engine === 'llm-guard' && i.scanner)) {
    const out = suppressedScanners([{ matcher: 'entity', pattern: item.entity, enabled: false }]);
    assert.ok(out.includes(item.scanner!), `${item.entity} should suppress ${item.scanner}`);
  }
});
