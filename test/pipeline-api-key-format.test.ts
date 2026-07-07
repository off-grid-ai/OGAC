import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PIPELINE_KEY_SCHEME,
  filterAuditForPipeline,
  formatPipelineKey,
  looksLikePipelineKey,
  pipelineCostSlice,
  pipelineKeyHint,
  pipelineTag,
  prefixOf,
  validateKeyName,
} from '@/lib/pipeline-api-key-format';

// PURE unit tests — zero I/O — for the pipeline-API-key format + telemetry-lens shaping.

test('pipelineKeyHint derives a short opaque slug from a pipeline id', () => {
  assert.equal(pipelineKeyHint('pl_ab12cd34ef56'), 'ab12cd34ef');
  assert.equal(pipelineKeyHint('pl_XYZ-123'), 'xyz123');
  assert.equal(pipelineKeyHint(''), 'pipeline');
});

test('formatPipelineKey composes scheme + hint + secret', () => {
  const key = formatPipelineKey('pl_ab12cd34ef56', 'SECRET123');
  assert.ok(key.startsWith(PIPELINE_KEY_SCHEME));
  assert.equal(key, 'og_pl_ab12cd34ef_SECRET123');
});

test('prefixOf keeps the head + ellipsis, never the whole secret', () => {
  const key = formatPipelineKey('pl_ab12cd34ef56', 'a-very-long-secret-value-here');
  const prefix = prefixOf(key);
  assert.ok(prefix.endsWith('…'));
  assert.ok(key.startsWith(prefix.slice(0, -1)));
  assert.ok(!prefix.includes('secret-value-here'), 'the secret tail is not in the prefix');
});

test('looksLikePipelineKey pre-checks shape (never authenticates alone)', () => {
  assert.equal(looksLikePipelineKey(formatPipelineKey('pl_x', 'abcdefgh')), true);
  assert.equal(looksLikePipelineKey('ogak_something'), false);
  assert.equal(looksLikePipelineKey('og_pl_'), false);
  assert.equal(looksLikePipelineKey(null), false);
  assert.equal(looksLikePipelineKey(undefined), false);
});

test('validateKeyName trims, requires non-empty, caps length', () => {
  assert.deepEqual(validateKeyName('  Prod  '), { ok: true, name: 'Prod' });
  assert.equal(validateKeyName('').ok, false);
  assert.equal(validateKeyName('   ').ok, false);
  assert.equal(validateKeyName(42).ok, false);
  assert.equal(validateKeyName('x'.repeat(81)).ok, false);
  assert.equal(validateKeyName('x'.repeat(80)).ok, true);
});

test('pipelineTag is the canonical run attribution tag', () => {
  assert.equal(pipelineTag('pl_abc'), 'pipeline:pl_abc');
});

test('pipelineCostSlice picks the matching attributed row (byProject preferred, then byActor)', () => {
  const rows = {
    byProject: [
      {
        label: 'pipeline:pl_abc',
        requests: 10,
        promptTokens: 100,
        completionTokens: 50,
        tokens: 150,
        costUsd: 1.25,
        byModel: [{ model: 'gpt-4o', requests: 10, tokens: 150, costUsd: 1.25 }],
      },
      { label: 'pipeline:pl_other', requests: 5, promptTokens: 0, completionTokens: 0, tokens: 5, costUsd: 0.1, byModel: [] },
    ],
    byActor: [],
  };
  const slice = pipelineCostSlice('pl_abc', rows);
  assert.equal(slice.attributed, true);
  assert.equal(slice.costUsd, 1.25);
  assert.equal(slice.tokens, 150);
  assert.equal(slice.byModel.length, 1);
  assert.equal(slice.byModel[0].model, 'gpt-4o');
});

test('pipelineCostSlice falls back to byActor when no project match', () => {
  const rows = {
    byProject: [],
    byActor: [
      { label: 'pipeline:pl_abc', requests: 3, promptTokens: 30, completionTokens: 10, tokens: 40, costUsd: 0.4, byModel: [] },
    ],
  };
  const slice = pipelineCostSlice('pl_abc', rows);
  assert.equal(slice.attributed, true);
  assert.equal(slice.requests, 3);
});

test('pipelineCostSlice returns an honest zero slice when nothing is attributed', () => {
  const slice = pipelineCostSlice('pl_abc', { byProject: [], byActor: [] });
  assert.equal(slice.attributed, false);
  assert.equal(slice.costUsd, 0);
  assert.equal(slice.requests, 0);
  assert.deepEqual(slice.byModel, []);
});

test('filterAuditForPipeline matches on resource/project by tag or bare id', () => {
  const rows = [
    { id: '1', resource: 'pipeline:pl_abc', project: '' },
    { id: '2', resource: '', project: 'pipeline:pl_abc' },
    { id: '3', resource: 'pl_abc', project: '' },
    { id: '4', resource: 'pipeline:pl_other', project: '' },
    { id: '5', resource: 'app:foo', project: 'somethingelse' },
  ];
  const out = filterAuditForPipeline(rows, 'pl_abc');
  assert.deepEqual(out.map((r) => r.id), ['1', '2', '3']);
});
