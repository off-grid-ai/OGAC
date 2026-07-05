import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyThresholds,
  buildAnalyzeRequest,
  clampScore,
  DEFAULT_THRESHOLDS,
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

test('buildAnalyzeRequest: no recognizers, no threshold → bare text/language', () => {
  const req = buildAnalyzeRequest('hello', [], DEFAULT_THRESHOLDS);
  assert.deepEqual(req, { text: 'hello', language: 'en' });
});

test('buildAnalyzeRequest: only enabled recognizers ride as ad_hoc_recognizers', () => {
  const disabled = { ...patternRec, enabled: false };
  const req = buildAnalyzeRequest('scan me', [patternRec, disabled, denyRec], DEFAULT_THRESHOLDS);
  assert.equal(req.ad_hoc_recognizers?.length, 2);
  assert.deepEqual(
    req.ad_hoc_recognizers?.map((r) => r.supported_entity),
    ['EMPLOYEE_ID', 'CODENAME'],
  );
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
