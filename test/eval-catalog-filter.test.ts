import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CatalogTemplate,
  catalogFacets,
  filterTemplates,
  isFilterActive,
  sortTemplates,
} from '../src/lib/eval-catalog-filter.ts';

// Real behavior over the pure catalog filter/sort/facet logic — no mocks, no I/O.

const avail = { available: true, degraded: false, detail: 'ok' };

function mk(over: Partial<CatalogTemplate>): CatalogTemplate {
  return {
    id: 'x',
    name: 'X',
    category: 'quality',
    description: '',
    metric: 'm',
    method: 'meth',
    engine: 'heuristic',
    direction: 'higher-better',
    defaultThreshold: 0.5,
    availability: avail,
    ...over,
  };
}

const CATALOG: CatalogTemplate[] = [
  mk({ id: 'faith', name: 'Hallucination / Faithfulness', category: 'rag', engine: 'ragas', description: 'supported by retrieved context', defaultThreshold: 0.8 }),
  mk({ id: 'relev', name: 'Answer Relevancy', category: 'rag', engine: 'ragas', description: 'address the question', defaultThreshold: 0.7 }),
  mk({ id: 'tox', name: 'Toxicity Detection', category: 'safety', engine: 'guardrails', description: 'toxic hateful output', direction: 'lower-better', defaultThreshold: 0.2 }),
  mk({ id: 'pii', name: 'PII Leakage', category: 'privacy', engine: 'presidio', description: 'leak personal data', direction: 'lower-better', defaultThreshold: 0 }),
  mk({ id: 'geval', name: 'G-Eval (custom criteria)', category: 'custom', engine: 'deepeval', description: 'write your own pass rule', defaultThreshold: 0.7 }),
];

test('isFilterActive reflects any constraint', () => {
  assert.equal(isFilterActive({}), false);
  assert.equal(isFilterActive({ q: '  ' }), false);
  assert.equal(isFilterActive({ q: 'tox' }), true);
  assert.equal(isFilterActive({ category: 'rag' }), true);
  assert.equal(isFilterActive({ engine: 'ragas' }), true);
});

test('filter by query matches name AND description, case-insensitive', () => {
  assert.deepEqual(filterTemplates(CATALOG, { q: 'toxic' }).map((t) => t.id), ['tox']);
  // description-only hit
  assert.deepEqual(filterTemplates(CATALOG, { q: 'personal data' }).map((t) => t.id), ['pii']);
  // name hit, mixed case
  assert.deepEqual(filterTemplates(CATALOG, { q: 'RELEVANCY' }).map((t) => t.id), ['relev']);
  // empty query = all
  assert.equal(filterTemplates(CATALOG, { q: '' }).length, CATALOG.length);
});

test('filter by category and engine (exact)', () => {
  assert.deepEqual(filterTemplates(CATALOG, { category: 'rag' }).map((t) => t.id), ['faith', 'relev']);
  assert.deepEqual(filterTemplates(CATALOG, { engine: 'presidio' }).map((t) => t.id), ['pii']);
});

test('combined filters intersect', () => {
  const r = filterTemplates(CATALOG, { q: 'answer', category: 'rag', engine: 'ragas' });
  assert.deepEqual(r.map((t) => t.id), ['relev']);
});

test('filter does not mutate input', () => {
  const before = CATALOG.map((t) => t.id);
  filterTemplates(CATALOG, { q: 'a' });
  assert.deepEqual(CATALOG.map((t) => t.id), before);
});

test('sort by name ascending', () => {
  const r = sortTemplates(CATALOG, 'name');
  assert.deepEqual(r.map((t) => t.name), [
    'Answer Relevancy',
    'G-Eval (custom criteria)',
    'Hallucination / Faithfulness',
    'PII Leakage',
    'Toxicity Detection',
  ]);
});

test('sort by category then name', () => {
  const r = sortTemplates(CATALOG, 'category');
  assert.deepEqual(r.map((t) => t.category), ['custom', 'privacy', 'rag', 'rag', 'safety']);
  // within rag, name-ordered
  const rag = r.filter((t) => t.category === 'rag');
  assert.deepEqual(rag.map((t) => t.name), ['Answer Relevancy', 'Hallucination / Faithfulness']);
});

test('sort by engine then name', () => {
  const r = sortTemplates(CATALOG, 'engine');
  assert.deepEqual(r.map((t) => t.engine), ['deepeval', 'guardrails', 'presidio', 'ragas', 'ragas']);
});

test('sort by threshold descending, name tiebreak', () => {
  const r = sortTemplates(CATALOG, 'threshold');
  assert.deepEqual(r.map((t) => t.defaultThreshold), [0.8, 0.7, 0.7, 0.2, 0]);
  // the two 0.7s break by name: Answer Relevancy before G-Eval
  const sevens = r.filter((t) => t.defaultThreshold === 0.7).map((t) => t.name);
  assert.deepEqual(sevens, ['Answer Relevancy', 'G-Eval (custom criteria)']);
});

test('sort does not mutate input', () => {
  const before = CATALOG.map((t) => t.id);
  sortTemplates(CATALOG, 'name');
  assert.deepEqual(CATALOG.map((t) => t.id), before);
});

test('catalogFacets derives categories and engines with counts, sorted', () => {
  const f = catalogFacets(CATALOG);
  assert.deepEqual(f.categories, [
    { value: 'custom', count: 1 },
    { value: 'privacy', count: 1 },
    { value: 'rag', count: 2 },
    { value: 'safety', count: 1 },
  ]);
  assert.deepEqual(f.engines, [
    { value: 'deepeval', count: 1 },
    { value: 'guardrails', count: 1 },
    { value: 'presidio', count: 1 },
    { value: 'ragas', count: 2 },
  ]);
});

test('facets on empty catalog are empty', () => {
  const f = catalogFacets([]);
  assert.deepEqual(f, { categories: [], engines: [] });
});
