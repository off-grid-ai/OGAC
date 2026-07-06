import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeGaps,
  analyzeSpec,
  blockerCount,
  mergeFixIts,
} from '../src/lib/builder-gaps.ts';
import type { AppSpec } from '../src/lib/app-model.ts';

// Pure fix-it analysis (Builder Epic #115). This is what turns the founder's "unusable" wall of gap
// prose into one-click actions, so a regression here re-breaks usability.

function spec(steps: AppSpec['steps']): AppSpec {
  return {
    id: 'app_1',
    orgId: 'default',
    ownerId: 'me',
    title: 'T',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps,
    edges: [],
  };
}

test('analyzeGaps: a "No data source" gap becomes a wire-data-source action carrying the phrase', () => {
  const items = analyzeGaps([
    'No data source declared for "invoices" — add a data-domain mapping to wire this step.',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].action, 'wire-data-source');
  assert.equal(items[0].phrase, 'invoices');
  assert.equal(items[0].severity, 'blocker');
});

test('analyzeGaps: an unrecognized gap is surfaced as an advisory review item (never hidden)', () => {
  const items = analyzeGaps(['Ignored step of unknown kind \'frobnicate\'']);
  assert.equal(items.length, 1);
  assert.equal(items[0].action, 'review');
  assert.equal(items[0].severity, 'advisory');
});

test('analyzeGaps: blanks are dropped', () => {
  assert.deepEqual(analyzeGaps(['', '   ']), []);
});

test('analyzeSpec: an unbound connector-query step is a bind-step blocker naming the step', () => {
  const s = spec([
    { id: 's1', label: 'Read invoices', kind: 'connector-query', domain: '' },
    { id: 's2', label: 'Output', kind: 'output', sink: 'console' },
  ]);
  const items = analyzeSpec(s);
  const bind = items.find((i) => i.action === 'bind-step');
  assert.ok(bind, 'expected a bind-step fix-it');
  assert.equal(bind!.stepId, 's1');
  assert.equal(bind!.severity, 'blocker');
});

test('analyzeSpec: an inline agent with no prompt is an add-instructions blocker', () => {
  const s = spec([
    { id: 's1', label: 'Decide', kind: 'agent', inlineAgent: { systemPrompt: '', grounded: true } },
  ]);
  const items = analyzeSpec(s);
  assert.equal(items[0].action, 'add-instructions');
  assert.equal(items[0].stepId, 's1');
});

test('analyzeSpec: a bound connector-query and a prompted agent produce no fix-its', () => {
  const s = spec([
    { id: 's1', label: 'Read', kind: 'connector-query', domain: 'dom_1' },
    { id: 's2', label: 'Decide', kind: 'agent', inlineAgent: { systemPrompt: 'do it', grounded: true } },
    { id: 's3', label: 'Out', kind: 'output', sink: 'console' },
  ]);
  assert.deepEqual(analyzeSpec(s), []);
});

test('analyzeSpec: an agentId reference is considered bound (no fix-it)', () => {
  const s = spec([{ id: 's1', label: 'A', kind: 'agent', agentId: 'agent_x' }]);
  assert.deepEqual(analyzeSpec(s), []);
});

test('mergeFixIts: de-dupes by id and orders blockers before advisories', () => {
  const gaps = analyzeGaps([
    'No data source declared for "invoices" — …',
    'Some advisory note',
  ]);
  const fromSpec = analyzeSpec(
    spec([{ id: 's1', label: 'Read', kind: 'connector-query', domain: '' }]),
  );
  const merged = mergeFixIts(gaps, fromSpec);
  // blockers first
  assert.equal(merged[0].severity, 'blocker');
  assert.equal(merged[merged.length - 1].severity, 'advisory');
  // no duplicate ids
  const ids = merged.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('blockerCount: counts only blockers', () => {
  const items = mergeFixIts(
    analyzeGaps(['No data source declared for "x" — …', 'advisory']),
    [],
  );
  assert.equal(blockerCount(items), 1);
});

test('analyzeSpec(null) is empty', () => {
  assert.deepEqual(analyzeSpec(null), []);
});
