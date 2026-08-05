import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readOwnership,
  summariseOwnership,
  validateOwner,
  validateTag,
} from '../src/lib/data-ownership-policy.ts';

test('"anonymous" IS NOT AN OWNER — it is the absence of one wearing a plausible word', () => {
  // Measured live 2026-08-05: every namespace on the deployment reports ownerName "anonymous". Rendering
  // that in an Owner column would answer the governance question only in appearance.
  const a = readOwnership('offgrid', 'anonymous');
  assert.equal(a.owned, false);
  assert.equal(a.owner, null);
  assert.match(a.sentence, /Nobody owns/);
  assert.match(a.sentence, /there is no one to tell/);

  for (const placeholder of ['', '  ', 'unknown', 'none', 'N/A', 'null', 'undefined', 'ANONYMOUS']) {
    assert.equal(readOwnership('ns', placeholder).owned, false, `${placeholder} must read as unowned`);
  }
});

test('a real owner is reported as owned', () => {
  const o = readOwnership('offgrid', 'data-platform-team');
  assert.equal(o.owned, true);
  assert.equal(o.owner, 'data-platform-team');
  assert.match(o.sentence, /owned by data-platform-team/);
});

test('SETTING a placeholder owner is REFUSED, because that is how the current state happened', () => {
  // Accepting "anonymous" would let someone tick the box without answering the question.
  for (const bad of ['anonymous', 'unknown', 'none', 'n/a']) {
    const r = validateOwner(bad);
    assert.equal(r.ok, false, `${bad} must be refused`);
    if (!r.ok) {
      assert.equal(r.problem, 'owner-placeholder');
      assert.match(r.sentence, /Name a person or a team/);
    }
  }
  const blank = validateOwner('   ');
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.match(blank.sentence, /A blank owner is what we already have/);
});

test('an owner is trimmed, and control characters or overlong values are refused', () => {
  const good = validateOwner('  claims-ops  ');
  assert.equal(good.ok && good.owner, 'claims-ops');
  assert.equal(validateOwner('a'.repeat(256)).ok, false);
  assert.equal(validateOwner(`ops${String.fromCharCode(0)}team`).ok, false);
  assert.equal(validateOwner(`ops${String.fromCharCode(10)}team`).ok, false);
  assert.equal(validateOwner(42).ok, false);
});

test('A TAG WITHOUT A WRITTEN MEANING IS REFUSED', () => {
  // A tag like PII is a CLAIM about data. Without a description it gets applied inconsistently by
  // different people, and a report that relies on it inherits the inconsistency — worse than no tag.
  const r = validateTag('PII', '');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.problem, 'description-missing');
    assert.match(r.sentence, /gets applied inconsistently/);
  }
});

test('tag names are normalised to the store\'s own convention rather than rejected for case', () => {
  const r = validateTag('  pii  ', 'Personally identifiable information');
  assert.equal(r.ok && r.name, 'PII');
  // But a name the store would reject is refused here, with a readable reason and an example.
  for (const bad of ['1PII', 'has space', 'kebab-case', '_LEADING', 'A'.repeat(65)]) {
    const bad_r = validateTag(bad, 'x');
    assert.equal(bad_r.ok, false, `${bad} must be refused`);
    if (!bad_r.ok) assert.match(bad_r.sentence, /for example PII or RETAIN_7Y/);
  }
});

test('a very long description is clamped rather than refused', () => {
  const r = validateTag('RETAIN_7Y', 'x'.repeat(5000));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.description.length, 1000);
});

test('UNOWNED AREAS ARE COUNTED, and the consequence is stated', () => {
  const s = summariseOwnership([
    readOwnership('a', 'claims-ops'),
    readOwnership('b', 'anonymous'),
    readOwnership('c', ''),
  ]);
  assert.equal(s.owned, 1);
  assert.equal(s.unowned, 2);
  assert.match(s.sentence, /2 of 3 data areas have nobody accountable/);
  assert.match(s.sentence, /there is no one to tell/);
});

test('all owned reads as such, and an empty catalogue is not a pass', () => {
  const all = summariseOwnership([readOwnership('a', 'team')]);
  assert.equal(all.unowned, 0);
  assert.match(all.sentence, /Every data area has an owner/);

  // Nothing found must never render as compliance.
  const none = summariseOwnership([]);
  assert.match(none.sentence, /nothing to say about who owns them/);
});
