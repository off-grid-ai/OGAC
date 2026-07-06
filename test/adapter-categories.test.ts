import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADAPTER_CATEGORIES,
  ALL_CATEGORY_ID,
  categoryCounts,
  categoryForCapability,
  filterByCategory,
  normalizeCategory,
} from '../src/lib/adapters/categories.ts';
import type { Capability } from '../src/lib/adapters/types.ts';

// Pure categorization for the Integrations adapter catalog sub-nav. The load-bearing property is
// COMPLETENESS: every capability the registry can surface maps to exactly one real category, so no
// adapter card is ever silently dropped from the grid when filtered.

// The full capability surface, mirroring src/lib/adapters/types.ts (the source of truth).
const ALL_CAPABILITIES: Capability[] = [
  'inference',
  'observability',
  'secrets',
  'guardrails',
  'grounding',
  'retrieval',
  'policy',
  'identity',
  'lineage',
  'caching',
  'siem',
  'flags',
  'provenance',
  'bi',
  'sandbox',
  'evals',
  'drift',
  'mdm',
];

test('every capability maps to a real (non-other) category', () => {
  const ids = new Set(ADAPTER_CATEGORIES.map((c) => c.id));
  for (const cap of ALL_CAPABILITIES) {
    const cat = categoryForCapability(cap);
    assert.notEqual(cat, 'other', `capability "${cap}" fell into the "other" bucket`);
    assert.ok(ids.has(cat), `capability "${cap}" -> unknown category "${cat}"`);
  }
});

test('each capability belongs to exactly one category', () => {
  const seen = new Map<string, string>();
  for (const c of ADAPTER_CATEGORIES) {
    for (const cap of c.capabilities) {
      assert.ok(!seen.has(cap), `capability "${cap}" is in both ${seen.get(cap)} and ${c.id}`);
      seen.set(cap, c.id);
    }
  }
  // And the category tables cover the whole capability surface.
  assert.equal(seen.size, ALL_CAPABILITIES.length);
});

test('category ids are unique and url-safe slugs', () => {
  const ids = ADAPTER_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate category id');
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/, `category id "${id}" is not a url-safe slug`);
    assert.notEqual(id, ALL_CATEGORY_ID, '"all" is reserved for the default view');
  }
});

test('normalizeCategory: unknown/absent -> all, known passes through', () => {
  assert.equal(normalizeCategory(null), ALL_CATEGORY_ID);
  assert.equal(normalizeCategory(undefined), ALL_CATEGORY_ID);
  assert.equal(normalizeCategory(''), ALL_CATEGORY_ID);
  assert.equal(normalizeCategory('all'), ALL_CATEGORY_ID);
  assert.equal(normalizeCategory('does-not-exist'), ALL_CATEGORY_ID);
  assert.equal(normalizeCategory('retrieval'), 'retrieval');
  assert.equal(normalizeCategory('security-provenance'), 'security-provenance');
});

test('filterByCategory: ALL returns everything, a category returns only its members', () => {
  const items = ALL_CAPABILITIES.map((capability) => ({ capability }));
  assert.equal(filterByCategory(items, ALL_CATEGORY_ID).length, items.length);
  assert.equal(filterByCategory(items, 'unknown').length, items.length); // normalized to ALL

  const retrieval = filterByCategory(items, 'retrieval').map((i) => i.capability).sort();
  assert.deepEqual(retrieval, ['caching', 'grounding', 'retrieval']);

  const eval_ = filterByCategory(items, 'eval');
  assert.deepEqual(eval_.map((i) => i.capability), ['evals']);
});

test('categoryCounts: sums to total and buckets correctly', () => {
  const items = ALL_CAPABILITIES.map((capability) => ({ capability }));
  const counts = categoryCounts(items);
  assert.equal(counts[ALL_CATEGORY_ID], items.length);
  const perCat = ADAPTER_CATEGORIES.reduce((n, c) => n + (counts[c.id] ?? 0), 0);
  assert.equal(perCat, items.length, 'per-category counts must sum to the total');
  assert.equal(counts['security-provenance'], 7);
  assert.equal(counts['retrieval'], 3);
});
