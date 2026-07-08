import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  atLeast,
  deriveAssetPosture,
  levelRank,
  makeClassification,
  maxLevel,
  normalizeLevel,
  normalizePiiTags,
  type Classification,
} from '../src/lib/data-classification.ts';

// PURE unit tests for the classification model. Classification drives policy (masking, egress, RTBF
// scope) so its derivations are the product promise — deterministic, fail-safe (unknown → internal,
// never public).

test('normalizeLevel: unknown/garbage falls back to internal, never public', () => {
  assert.equal(normalizeLevel('restricted'), 'restricted');
  assert.equal(normalizeLevel('  Confidential '), 'confidential');
  assert.equal(normalizeLevel('nonsense'), 'internal');
  assert.equal(normalizeLevel(null), 'internal');
  assert.equal(normalizeLevel(''), 'internal');
});

test('levelRank + atLeast compare by ascending sensitivity', () => {
  assert.ok(levelRank('restricted') > levelRank('confidential'));
  assert.ok(levelRank('confidential') > levelRank('internal'));
  assert.ok(levelRank('internal') > levelRank('public'));
  assert.ok(atLeast('restricted', 'confidential'));
  assert.ok(!atLeast('internal', 'confidential'));
});

test('maxLevel: rolls a column set up to the most sensitive', () => {
  assert.equal(maxLevel(['public', 'internal', 'restricted', 'confidential']), 'restricted');
  assert.equal(maxLevel(['public', 'public']), 'public');
  assert.equal(maxLevel([]), 'internal');
});

test('normalizePiiTags: uppercases, de-dupes, snake-cases spaces/hyphens, keeps order', () => {
  assert.deepEqual(normalizePiiTags(['pan', 'PAN', ' aadhaar ', 'email']), ['PAN', 'AADHAAR', 'EMAIL']);
  // spaces/hyphens collapse to underscore so a multi-word entity is one canonical tag
  assert.deepEqual(normalizePiiTags(['credit card', 'phone-number']), ['CREDIT_CARD', 'PHONE_NUMBER']);
  assert.deepEqual(normalizePiiTags([null, '', '  ']), []);
});

test('makeClassification: coerces to safe defaults, trims column', () => {
  const c = makeClassification({ level: 'RESTRICTED', piiTags: ['pan'], column: '  pan_number ' });
  assert.equal(c.level, 'restricted');
  assert.deepEqual(c.piiTags, ['PAN']);
  assert.equal(c.column, 'pan_number');
  const dflt = makeClassification({});
  assert.equal(dflt.level, 'internal');
  assert.equal(dflt.column, null);
});

test('deriveAssetPosture: PII forces masking + RTBF scope; restricted blocks egress', () => {
  const cls: Classification[] = [
    { level: 'internal', piiTags: [], column: null },
    { level: 'restricted', piiTags: ['PAN'], column: 'pan_number' },
  ];
  const p = deriveAssetPosture(cls);
  assert.equal(p.effectiveLevel, 'restricted');
  assert.equal(p.hasPii, true);
  assert.deepEqual(p.piiTags, ['PAN']);
  assert.equal(p.requiresMasking, true);
  assert.equal(p.egressAllowed, false, 'restricted ⇒ no egress');
  assert.equal(p.inRtbfScope, true);
});

test('deriveAssetPosture: confidential with no PII still requires masking but allows egress', () => {
  const p = deriveAssetPosture([{ level: 'confidential', piiTags: [], column: null }]);
  assert.equal(p.requiresMasking, true, 'confidential+ requires masking');
  assert.equal(p.egressAllowed, true, 'confidential is not restricted');
  assert.equal(p.hasPii, false);
  assert.equal(p.inRtbfScope, false);
});

test('deriveAssetPosture: empty (unclassified) asset defaults to internal, no PII, egress allowed', () => {
  const p = deriveAssetPosture([]);
  assert.equal(p.effectiveLevel, 'internal');
  assert.equal(p.hasPii, false);
  assert.equal(p.requiresMasking, false);
  assert.equal(p.egressAllowed, true);
});
