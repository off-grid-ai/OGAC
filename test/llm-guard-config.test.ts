import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLlmGuardScannerConfig,
  configCoversEntity,
  DEFAULT_ANONYMIZE_ENTITIES,
  recognizerToLlmGuard,
} from '../src/lib/llm-guard-config.ts';
import { DEFAULT_RECOGNIZERS, type NormalizedRecognizer } from '../src/lib/presidio-recognizers.ts';

// PURE tests for the LLM Guard scanner-config generator. The load-bearing assertion (G-LG-2): the
// generated config's Anonymize scanner carries the India recognizers (PAN/Aadhaar/IFSC/UPI), sourced
// from the SAME DEFAULT_RECOGNIZERS the Presidio path used — so LLM Guard catches Indian PII that its
// stock Anonymize misses.

function rec(over: Partial<NormalizedRecognizer>): NormalizedRecognizer {
  return {
    kind: 'pattern',
    entity: 'EMPLOYEE_ID',
    name: 'emp',
    regex: 'EMP[0-9]{4}',
    context: [],
    denyList: [],
    score: 0.8,
    enabled: true,
    ...over,
  };
}

test('the generated config folds in the India recognizers (G-LG-2)', () => {
  const cfg = buildLlmGuardScannerConfig();
  assert.ok(configCoversEntity(cfg, 'IN_PAN'), 'IN_PAN recognizer present');
  assert.ok(configCoversEntity(cfg, 'IN_AADHAAR'), 'IN_AADHAAR recognizer present');
  assert.ok(configCoversEntity(cfg, 'IN_IFSC'), 'IN_IFSC recognizer present');
  assert.ok(configCoversEntity(cfg, 'UPI_ID'), 'UPI_ID recognizer present');
  // entity_types the engine acts on include the India entities + the standard set.
  for (const e of ['IN_PAN', 'IN_AADHAAR', 'EMAIL_ADDRESS', 'CREDIT_CARD']) {
    assert.ok(cfg.Anonymize.entity_types.includes(e), `${e} in entity_types`);
  }
});

test('the India PAN pattern the engine receives is the SAME as DEFAULT_RECOGNIZERS (DRY)', () => {
  const cfg = buildLlmGuardScannerConfig();
  const sentPan = cfg.Anonymize.recognizer_conf.find((r) => r.supported_entity === 'IN_PAN');
  const sourcePan = DEFAULT_RECOGNIZERS.find((r) => r.entity === 'IN_PAN')!;
  assert.equal(sentPan!.patterns[0].regex, sourcePan.regex, 'one source of the PAN pattern');
  assert.equal(sentPan!.patterns[0].score, sourcePan.score);
});

test('the standard scanners are enabled with defaults (empty params)', () => {
  const cfg = buildLlmGuardScannerConfig();
  assert.deepEqual(cfg.Secrets, {});
  assert.deepEqual(cfg.PromptInjection, {});
  assert.deepEqual(cfg.Toxicity, {});
});

test('an org custom recognizer is folded in ALONGSIDE the defaults', () => {
  const cfg = buildLlmGuardScannerConfig([rec({})]);
  assert.ok(configCoversEntity(cfg, 'EMPLOYEE_ID'), 'org recognizer present');
  assert.ok(configCoversEntity(cfg, 'IN_PAN'), 'India defaults still present');
  assert.ok(cfg.Anonymize.entity_types.includes('EMPLOYEE_ID'), 'org entity added to entity_types');
});

test('an org recognizer for a DEFAULT entity WINS over the default (operator override)', () => {
  const override = rec({ entity: 'IN_PAN', name: 'my_pan', regex: 'CUSTOMPAN', score: 0.99 });
  const cfg = buildLlmGuardScannerConfig([override]);
  const pan = cfg.Anonymize.recognizer_conf.filter((r) => r.supported_entity === 'IN_PAN');
  assert.equal(pan.length, 1, 'exactly one IN_PAN recognizer — the override, not the default');
  assert.equal(pan[0].patterns[0].regex, 'CUSTOMPAN');
});

test('disabled + deny-list recognizers are dropped (Anonymize is pattern based)', () => {
  const cfg = buildLlmGuardScannerConfig([
    rec({ entity: 'DISABLED_ONE', enabled: false }),
    rec({ kind: 'deny_list', entity: 'DENY_ONE', regex: '', denyList: ['x'] }),
  ]);
  assert.ok(!configCoversEntity(cfg, 'DISABLED_ONE'), 'disabled dropped');
  assert.ok(!configCoversEntity(cfg, 'DENY_ONE'), 'deny-list dropped');
});

test('recognizerToLlmGuard maps a pattern recognizer, returns null for deny-list', () => {
  const mapped = recognizerToLlmGuard(rec({ context: ['emp', 'staff'] }));
  assert.equal(mapped!.supported_entity, 'EMPLOYEE_ID');
  assert.equal(mapped!.patterns[0].regex, 'EMP[0-9]{4}');
  assert.deepEqual(mapped!.context, ['emp', 'staff']);
  assert.equal(recognizerToLlmGuard(rec({ kind: 'deny_list', regex: '' })), null);
});

test('DEFAULT_ANONYMIZE_ENTITIES lists the India entities explicitly', () => {
  for (const e of ['IN_PAN', 'IN_AADHAAR', 'IN_IFSC', 'UPI_ID']) {
    assert.ok(DEFAULT_ANONYMIZE_ENTITIES.includes(e), `${e} in the default entity set`);
  }
});
