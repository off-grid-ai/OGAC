import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyThresholds,
  buildAnalyzeRequest,
  clampScore,
  DEFAULT_RECOGNIZERS,
  DEFAULT_THRESHOLDS,
  mergeWithDefaults,
  normalizeThresholds,
  parseStringList,
  recognizerToAdHoc,
  RECOGNIZER_KINDS,
  regexError,
  thresholdFor,
  validateRecognizer,
  type NormalizedRecognizer,
} from '../src/lib/presidio-recognizers.ts';

// Pure DEEP-guardrails logic: recognizer validation/normalization, the /analyze ad-hoc-recognizer
// payload builder, and threshold filtering. No DB, no mocks — a loose draft/response in, a
// normalized value or a Presidio-shaped body out. The I/O (CRUD queries) is exercised separately.

// ── validateRecognizer: happy paths ──────────────────────────────────────────

test('validateRecognizer: pattern draft normalizes (upper-cases entity, parses context, defaults)', () => {
  const r = validateRecognizer({
    kind: 'pattern',
    entity: 'employee_id',
    regex: '\\bEMP-\\d{6}\\b',
    context: 'employee, staff\nbadge',
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.kind, 'pattern');
  assert.equal(r.value.entity, 'EMPLOYEE_ID');
  assert.equal(r.value.regex, '\\bEMP-\\d{6}\\b');
  assert.deepEqual(r.value.context, ['employee', 'staff', 'badge']);
  assert.deepEqual(r.value.denyList, []);
  assert.equal(r.value.name, 'employee_id_recognizer'); // derived default
  assert.equal(r.value.enabled, true);
  assert.equal(r.value.score, 0.6); // default
});

test('validateRecognizer: deny_list draft normalizes (parses terms, keeps regex empty)', () => {
  const r = validateRecognizer({
    kind: 'deny_list',
    entity: 'CODENAME',
    name: 'secret_projects',
    denyList: 'Project Orion, internal-codename\nProject Orion',
    score: 0.9,
    enabled: false,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.kind, 'deny_list');
  assert.deepEqual(r.value.denyList, ['Project Orion', 'internal-codename']); // deduped
  assert.equal(r.value.regex, '');
  assert.equal(r.value.name, 'secret_projects');
  assert.equal(r.value.score, 0.9);
  assert.equal(r.value.enabled, false);
});

test('validateRecognizer: array context is accepted directly', () => {
  const r = validateRecognizer({
    kind: 'pattern',
    entity: 'X',
    regex: '\\d+',
    context: ['alpha', '  beta  ', ''],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.context, ['alpha', 'beta']); // trimmed + blanks dropped
});

// ── validateRecognizer: rejections ───────────────────────────────────────────

test('validateRecognizer: bad kind rejected', () => {
  const r = validateRecognizer({ kind: 'nope', entity: 'X', regex: '\\d' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /kind/);
});

test('validateRecognizer: missing/invalid entity rejected', () => {
  assert.equal(validateRecognizer({ kind: 'pattern', regex: '\\d' }).ok, false);
  const bad = validateRecognizer({ kind: 'pattern', entity: 'bad name!', regex: '\\d' });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.match(bad.error, /UPPER_SNAKE/);
});

test('validateRecognizer: pattern needs a compilable regex', () => {
  assert.match(
    (validateRecognizer({ kind: 'pattern', entity: 'X', regex: '   ' }) as { error: string }).error,
    /regex is required/,
  );
  assert.match(
    (validateRecognizer({ kind: 'pattern', entity: 'X', regex: '(' }) as { error: string }).error,
    /invalid regex/,
  );
});

test('validateRecognizer: deny_list needs at least one term', () => {
  const r = validateRecognizer({ kind: 'deny_list', entity: 'X', denyList: '  ,  ' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /at least one term/);
});

test('validateRecognizer: null/malformed draft degrades to an error, never throws', () => {
  assert.equal(validateRecognizer(null).ok, false);
  assert.equal(validateRecognizer(undefined).ok, false);
  assert.equal(validateRecognizer('nope' as unknown as null).ok, false);
});

test('validateRecognizer: every kind is a known token', () => {
  assert.deepEqual([...RECOGNIZER_KINDS], ['pattern', 'deny_list']);
});

// ── helpers ──────────────────────────────────────────────────────────────────

test('regexError: valid → null, invalid → message', () => {
  assert.equal(regexError('\\d{3}'), null);
  assert.notEqual(regexError('('), null);
});

test('parseStringList: array + delimited string, trims/dedupes/caps', () => {
  assert.deepEqual(parseStringList('a, b\nc, a'), ['a', 'b', 'c']);
  assert.deepEqual(parseStringList(['x', 'x', ' y ']), ['x', 'y']);
  assert.deepEqual(parseStringList(123), []);
  assert.equal(parseStringList('a,b,c,d', 2).length, 2);
});

test('clampScore: clamps to [0,1], falls back on garbage', () => {
  assert.equal(clampScore(0.4), 0.4);
  assert.equal(clampScore(2), 1);
  assert.equal(clampScore(-1), 0);
  assert.equal(clampScore('0.7'), 0.7);
  assert.equal(clampScore('nope', 0.6), 0.6);
  assert.equal(clampScore(undefined, 0.3), 0.3);
});

// ── recognizerToAdHoc ─────────────────────────────────────────────────────────

const patternRec: NormalizedRecognizer = {
  kind: 'pattern',
  entity: 'EMPLOYEE_ID',
  name: 'emp',
  regex: '\\bEMP-\\d+\\b',
  context: ['employee'],
  denyList: [],
  score: 0.8,
  enabled: true,
};
const denyRec: NormalizedRecognizer = {
  kind: 'deny_list',
  entity: 'CODENAME',
  name: 'codes',
  regex: '',
  context: [],
  denyList: ['Orion', 'Zeus'],
  score: 0.95,
  enabled: true,
};

test('recognizerToAdHoc: pattern → Presidio PatternRecognizer with patterns + context', () => {
  const a = recognizerToAdHoc(patternRec);
  assert.equal(a.name, 'emp');
  assert.equal(a.supported_entity, 'EMPLOYEE_ID');
  assert.equal(a.supported_language, 'en');
  assert.deepEqual(a.patterns, [{ name: 'emp_pattern', regex: '\\bEMP-\\d+\\b', score: 0.8 }]);
  assert.deepEqual(a.context, ['employee']);
  assert.equal(a.deny_list, undefined);
});

test('recognizerToAdHoc: deny_list → Presidio deny_list recognizer, no patterns', () => {
  const a = recognizerToAdHoc(denyRec);
  assert.deepEqual(a.deny_list, ['Orion', 'Zeus']);
  assert.equal(a.patterns, undefined);
  assert.equal(a.context, undefined); // no context words → key omitted
});

// ── buildAnalyzeRequest ───────────────────────────────────────────────────────

test('buildAnalyzeRequest: no stored recognizers still ships the Indian-BFSI default set', () => {
  const req = buildAnalyzeRequest('hello', [], DEFAULT_THRESHOLDS);
  assert.equal(req.text, 'hello');
  assert.equal(req.language, 'en');
  // The always-on default set (PAN/Aadhaar/IFSC/UPI) rides even with zero stored recognizers.
  assert.deepEqual(
    req.ad_hoc_recognizers?.map((r) => r.supported_entity).sort(),
    ['IN_AADHAAR', 'IN_IFSC', 'IN_PAN', 'UPI_ID'],
  );
});

test('buildAnalyzeRequest: only enabled recognizers ride, alongside the defaults', () => {
  const disabled = { ...patternRec, enabled: false };
  const req = buildAnalyzeRequest('scan me', [patternRec, disabled, denyRec], DEFAULT_THRESHOLDS);
  const entities = req.ad_hoc_recognizers?.map((r) => r.supported_entity) ?? [];
  // 4 defaults + 2 enabled stored (disabled one is dropped).
  assert.equal(req.ad_hoc_recognizers?.length, 6);
  assert.ok(entities.includes('EMPLOYEE_ID'));
  assert.ok(entities.includes('CODENAME'));
  assert.ok(entities.includes('IN_PAN'));
});

test('buildAnalyzeRequest: a stored recognizer overrides the default for the same entity', () => {
  const customPan: NormalizedRecognizer = {
    kind: 'pattern',
    entity: 'IN_PAN',
    name: 'my_pan',
    regex: '\\bPAN-\\d+\\b',
    context: [],
    denyList: [],
    score: 0.5,
    enabled: true,
  };
  const req = buildAnalyzeRequest('x', [customPan], DEFAULT_THRESHOLDS);
  const pans = req.ad_hoc_recognizers?.filter((r) => r.supported_entity === 'IN_PAN') ?? [];
  assert.equal(pans.length, 1, 'only one IN_PAN recognizer — the stored one wins');
  assert.equal(pans[0].name, 'my_pan');
});

test('buildAnalyzeRequest: positive global threshold rides as score_threshold', () => {
  const req = buildAnalyzeRequest('x', [], { global: 0.5, perEntity: {} });
  assert.equal(req.score_threshold, 0.5);
  // zero global floor is omitted (Presidio default behavior)
  assert.equal(buildAnalyzeRequest('x', [], { global: 0, perEntity: {} }).score_threshold, undefined);
});

// ── thresholds ─────────────────────────────────────────────────────────────

test('normalizeThresholds: clamps, upper-cases per-entity keys, drops bad keys', () => {
  const cfg = normalizeThresholds({
    global: 1.5,
    perEntity: { person: 0.4, 'bad key!': 0.9, US_SSN: 2 },
  });
  assert.equal(cfg.global, 1);
  assert.deepEqual(cfg.perEntity, { PERSON: 0.4, US_SSN: 1 });
});

test('normalizeThresholds: garbage → defaults, never throws', () => {
  assert.deepEqual(normalizeThresholds(null), DEFAULT_THRESHOLDS);
  assert.deepEqual(normalizeThresholds('nope'), DEFAULT_THRESHOLDS);
});

test('thresholdFor: per-entity override wins, else global floor', () => {
  const cfg = { global: 0.3, perEntity: { PERSON: 0.85 } };
  assert.equal(thresholdFor(cfg, 'PERSON'), 0.85);
  assert.equal(thresholdFor(cfg, 'person'), 0.85); // case-insensitive
  assert.equal(thresholdFor(cfg, 'EMAIL_ADDRESS'), 0.3); // falls to global
});

test('applyThresholds: filters below the effective floor, keeps score-less hits', () => {
  const results = [
    { entity_type: 'PERSON', start: 0, end: 4, score: 0.6 }, // below 0.85 → dropped
    { entity_type: 'PERSON', start: 5, end: 9, score: 0.9 }, // kept
    { entity_type: 'EMAIL_ADDRESS', start: 0, end: 4, score: 0.4 }, // above 0.3 → kept
    { entity_type: 'US_SSN', start: 0, end: 4 }, // no score → kept
  ];
  const cfg = { global: 0.3, perEntity: { PERSON: 0.85 } };
  const kept = applyThresholds(results, cfg);
  assert.deepEqual(
    kept.map((r) => `${r.entity_type}:${r.start}`),
    ['PERSON:5', 'EMAIL_ADDRESS:0', 'US_SSN:0'],
  );
});

// ── Indian-BFSI default recognizer set (G-F2) ─────────────────────────────────

test('DEFAULT_RECOGNIZERS: covers PAN / Aadhaar / IFSC / UPI, all enabled patterns', () => {
  const byEntity = new Map(DEFAULT_RECOGNIZERS.map((r) => [r.entity, r]));
  for (const e of ['IN_PAN', 'IN_AADHAAR', 'IN_IFSC', 'UPI_ID']) {
    const r = byEntity.get(e);
    assert.ok(r, `${e} present in default set`);
    assert.equal(r?.kind, 'pattern');
    assert.equal(r?.enabled, true);
    assert.equal(regexError(r?.regex ?? '('), null, `${e} pattern compiles`);
  }
});

// Each default pattern must actually MATCH a valid sample and REJECT a near-miss — the recognizer
// is only useful if its regex fires on real Indian BFSI PII. We compile and run each pattern the
// same way Presidio would (whole-string search).
function matches(entity: string, sample: string): boolean {
  const rec = DEFAULT_RECOGNIZERS.find((r) => r.entity === entity)!;
  return new RegExp(rec.regex).test(sample);
}

test('DEFAULT_RECOGNIZERS: PAN pattern matches a valid PAN, rejects malformed', () => {
  assert.equal(matches('IN_PAN', 'ABCDE1234F'), true);
  assert.equal(matches('IN_PAN', 'my pan is ABCDE1234F ok'), true);
  assert.equal(matches('IN_PAN', 'ABCD1234F'), false); // only 4 leading letters
  assert.equal(matches('IN_PAN', 'ABCDE12345'), false); // trailing digit not a letter
});

test('DEFAULT_RECOGNIZERS: IFSC pattern matches a valid IFSC, rejects malformed', () => {
  assert.equal(matches('IN_IFSC', 'HDFC0001234'), true);
  assert.equal(matches('IN_IFSC', 'SBIN0000456'), true);
  assert.equal(matches('IN_IFSC', 'HDFC1001234'), false); // 5th char must be 0
  assert.equal(matches('IN_IFSC', 'HDF0001234'), false); // only 3 bank letters
});

test('DEFAULT_RECOGNIZERS: Aadhaar matches 4-4-4 and bare 12-digit, rejects short/leading-1', () => {
  assert.equal(matches('IN_AADHAAR', '2345 6789 0123'), true);
  assert.equal(matches('IN_AADHAAR', '234567890123'), true);
  assert.equal(matches('IN_AADHAAR', '1234 5678 9012'), false); // leading digit < 2
  assert.equal(matches('IN_AADHAAR', '2345 6789'), false); // only 8 digits
});

test('DEFAULT_RECOGNIZERS: UPI matches a VPA but NOT a dotted email domain', () => {
  assert.equal(matches('UPI_ID', 'ramesh@okhdfc'), true);
  assert.equal(matches('UPI_ID', '9876543210@paytm'), true);
  // A real email has a dotted TLD — the PSP part here contains a dot so the anchored pattern
  // won't treat the whole `gmail.com` as the letters-only PSP.
  assert.equal(new RegExp(`^${DEFAULT_RECOGNIZERS.find((r) => r.entity === 'UPI_ID')!.regex}$`).test('jane@gmail.com'), false);
});

test('mergeWithDefaults: prepends defaults, stored entity overrides same-entity default', () => {
  const stored: NormalizedRecognizer[] = [
    {
      kind: 'pattern',
      entity: 'IN_PAN',
      name: 'org_pan',
      regex: '\\bX\\b',
      context: [],
      denyList: [],
      score: 0.4,
      enabled: true,
    },
    {
      kind: 'deny_list',
      entity: 'CODENAME',
      name: 'codes',
      regex: '',
      context: [],
      denyList: ['Orion'],
      score: 0.9,
      enabled: true,
    },
  ];
  const merged = mergeWithDefaults(stored);
  const pans = merged.filter((r) => r.entity === 'IN_PAN');
  assert.equal(pans.length, 1); // no duplicate — the org's PAN recognizer wins
  assert.equal(pans[0].name, 'org_pan');
  // The non-overridden defaults survive alongside the org's own recognizers.
  assert.ok(merged.some((r) => r.entity === 'IN_AADHAAR'));
  assert.ok(merged.some((r) => r.entity === 'IN_IFSC'));
  assert.ok(merged.some((r) => r.entity === 'UPI_ID'));
  assert.ok(merged.some((r) => r.entity === 'CODENAME'));
});
