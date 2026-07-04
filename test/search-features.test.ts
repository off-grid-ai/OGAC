import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEATURES, matchFeatures } from '../src/lib/search-features.ts';

// PURE unit tests for the global-search feature index — the "and sub-pages" half of Phase 1
// search. No DB, no network.

test('matchFeatures finds a feature by an action keyword, not just its title', () => {
  // "suppress" isn't in any module name/description, but should surface the SIEM suppression feature.
  const hits = matchFeatures('suppress');
  assert.ok(
    hits.some((f) => f.href === '/siem'),
    'searching "suppress" surfaces Security Events',
  );
});

test('matchFeatures matches egress/leash → control', () => {
  assert.ok(matchFeatures('egress').some((f) => f.href === '/control'));
  assert.ok(matchFeatures('leash').some((f) => f.href === '/control'));
});

test('matchFeatures matches baseline → drift and budget → finops', () => {
  assert.ok(matchFeatures('baseline').some((f) => f.href === '/drift'));
  assert.ok(matchFeatures('budget').some((f) => f.href === '/finops'));
});

test('matchFeatures matches on title substring too', () => {
  assert.ok(matchFeatures('golden').some((f) => f.href === '/evals'));
});

test('matchFeatures ignores queries shorter than 2 chars and caps results', () => {
  assert.equal(matchFeatures('a').length, 0);
  assert.ok(matchFeatures('e', 3).length <= 3);
});

test('every feature points at a route and declares an owning module', () => {
  for (const f of FEATURES) {
    assert.match(f.href, /^\//, `${f.id} href is a route`);
    assert.ok(f.moduleId, `${f.id} has a moduleId for enablement filtering`);
    assert.ok(f.keywords.length > 0, `${f.id} has keywords`);
  }
});
