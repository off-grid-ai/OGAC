import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterRowsByPipeline,
  readPipelineParam,
  resolvePipelineFacet,
} from '../src/lib/pipelines-policy.ts';
import { accountingQueryClause, buildAccountingQuery } from '../src/lib/accounting-aggs.ts';
import { buildAggsQuery } from '../src/lib/analytics-aggs.ts';
import { siemQueryClause } from '../src/lib/siem-view.ts';

// PURE unit tests for the T2 pipeline facet: the URL-param coercion + owned-id gate, the tagged-row
// client filter, and the server-side query clauses each roll-up injects when a pipeline is selected.
// No DB, no network — real functions.

test('readPipelineParam coerces string | string[] | undefined to a trimmed string', () => {
  assert.equal(readPipelineParam('pl_abc'), 'pl_abc');
  assert.equal(readPipelineParam('  pl_abc  '), 'pl_abc');
  assert.equal(readPipelineParam(['pl_first', 'pl_second']), 'pl_first');
  assert.equal(readPipelineParam(undefined), '');
  assert.equal(readPipelineParam(null), '');
});

test('resolvePipelineFacet returns the id only when the org owns it, else null', () => {
  const known = ['pl_a', 'pl_b'];
  assert.equal(resolvePipelineFacet('pl_a', known), 'pl_a');
  // stale/forged id degrades to "all" (null) rather than an empty view
  assert.equal(resolvePipelineFacet('pl_zzz', known), null);
  assert.equal(resolvePipelineFacet('', known), null);
  assert.equal(resolvePipelineFacet(undefined, known), null);
});

test('filterRowsByPipeline keeps only rows tagged pipeline:<id> (or bare id); passes all when null', () => {
  const rows = [
    { project: 'pipeline:pl_a' },
    { project: 'pipeline:pl_b' },
    { project: 'pl_a' }, // bare id form
    { project: '(unattributed)' },
  ];
  const tagOf = (r: { project: string }) => [r.project];
  assert.equal(filterRowsByPipeline(rows, null, tagOf).length, 4); // no facet ⇒ unchanged
  const a = filterRowsByPipeline(rows, 'pl_a', tagOf);
  assert.deepEqual(a, [{ project: 'pipeline:pl_a' }, { project: 'pl_a' }]);
  assert.equal(filterRowsByPipeline(rows, 'pl_none', tagOf).length, 0);
});

test('accountingQueryClause: bare range without a pipeline, bool.filter term with one', () => {
  const bare = accountingQueryClause('2024-01-01', '2024-02-01');
  assert.ok('range' in bare, 'no pipeline ⇒ a bare range clause');
  const filtered = accountingQueryClause('2024-01-01', '2024-02-01', 'pipeline:pl_a') as {
    bool: { filter: Record<string, unknown>[] };
  };
  assert.ok(filtered.bool, 'pipeline ⇒ a bool');
  const term = filtered.bool.filter.find((f) => 'term' in f) as {
    term: Record<string, string>;
  };
  assert.equal(term.term['project.keyword'], 'pipeline:pl_a');
});

test('buildAccountingQuery threads the pipeline tag into the query clause', () => {
  const q = buildAccountingQuery(undefined, undefined, 'pipeline:pl_x') as {
    query: { bool: { filter: { term?: Record<string, string> }[] } };
  };
  const term = q.query.bool.filter.find((f) => f.term);
  assert.equal(term?.term?.['project.keyword'], 'pipeline:pl_x');
});

test('buildAggsQuery: match_all without a pipeline, project.keyword filter with one', () => {
  const all = buildAggsQuery(0) as { query: Record<string, unknown> };
  assert.ok('match_all' in all.query, 'no pipeline ⇒ match_all');
  const filtered = buildAggsQuery(0, 'pipeline:pl_y') as {
    query: { bool: { filter: { term: Record<string, string> }[] } };
  };
  assert.equal(filtered.query.bool.filter[0].term['project.keyword'], 'pipeline:pl_y');
});

test('siemQueryClause: match_all without a pipeline; should-match project OR resource with one', () => {
  assert.deepEqual(siemQueryClause(), { match_all: {} });
  assert.deepEqual(siemQueryClause(null), { match_all: {} });
  const filtered = siemQueryClause('pipeline:pl_z') as {
    bool: { minimum_should_match: number; should: { term: Record<string, string> }[] };
  };
  assert.equal(filtered.bool.minimum_should_match, 1);
  const fields = filtered.bool.should.map((s) => Object.keys(s.term)[0]);
  assert.deepEqual(fields.sort(), ['project.keyword', 'resource.keyword']);
});
