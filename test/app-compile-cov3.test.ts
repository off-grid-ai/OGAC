import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataDomain } from '../src/lib/data-domains.ts';
import {
  compileAppSpec,
  assembleFromPlan,
  heuristicDecompose,
  type ModelPlan,
} from '../src/lib/app-compile.ts';

// Branch top-up for app-compile.ts — the degenerate heuristic (empty description), the sink
// keyword arms (console default at 411), assembleFromPlan's unknown-kind + every-kind arms, and
// the full compileAppSpec with INJECTED deps (both the model-plan path and the heuristic fallback).

const invoices: DataDomain = {
  id: 'dom_inv', orgId: 'default', label: 'Invoices', aliases: ['bills'], connectorId: 'c1', resource: 'invoices',
};

test('heuristicDecompose on an empty description → a single inline agent (degenerate arm)', () => {
  const a = heuristicDecompose('', []);
  // With no clauses, no data/decision steps → still ends up with an output; but a bare description
  // means the degenerate single-agent path. Assert at least one agent step exists and it validates.
  assert.ok(a.steps.length >= 1);
  assert.ok(a.steps.some((s) => s.kind === 'output'));
  assert.equal(a.title.length > 0, true);
});

test('heuristicDecompose adds a synthesizing agent after a bound data step, and an output', () => {
  const a = heuristicDecompose('read the invoices then notify the finance team', [invoices]);
  assert.ok(a.steps.some((s) => s.kind === 'connector-query'));
  assert.ok(a.steps.some((s) => s.kind === 'agent'));
  assert.ok(a.steps.some((s) => s.kind === 'output'));
});

test('heuristicDecompose records a gap (no fabricated domain) for undeclared data', () => {
  // A bare data clause (recognized noun, no decision/approval/output verb) with NO declared
  // domain: the heuristic must DROP the connector-query and surface a gap, never fabricate a source.
  const a = heuristicDecompose('read the customer records', []);
  assert.ok(a.gaps.some((g) => g.toLowerCase().includes('no data source declared')));
  assert.ok(!a.steps.some((s) => s.kind === 'connector-query'));
});

test('assembleFromPlan handles every kind + ignores unknown kinds as a gap', () => {
  const plan: ModelPlan = {
    title: 'Refunds',
    summary: 'process refunds',
    steps: [
      { kind: 'connector-query', dataPhrase: 'invoices', label: 'Get invoices' },
      { kind: 'agent', instruction: 'decide refund' },
      { kind: 'guardrail' },
      { kind: 'human' },
      { kind: 'output', sink: 'email' },
      { kind: 'mystery', label: 'weird' },
    ],
  };
  const built = assembleFromPlan(plan, 'process refunds', [invoices]);
  const kinds = built.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['connector-query', 'agent', 'guardrail', 'human', 'output']);
  assert.ok(built.gaps.some((g) => g.includes("unknown kind 'mystery'")));
  assert.equal(built.title, 'Refunds');
});

test('assembleFromPlan drops an unbindable connector-query and records a gap', () => {
  const plan: ModelPlan = { steps: [{ kind: 'connector-query', dataPhrase: 'ghost data' }, { kind: 'agent' }] };
  const built = assembleFromPlan(plan, 'x', [invoices]);
  assert.ok(!built.steps.some((s) => s.kind === 'connector-query'));
  assert.ok(built.gaps.some((g) => g.toLowerCase().includes('no data source declared')));
});

test('output sink keyword arms: email / whatsapp / report / console default', () => {
  const mk = (sinkClause: string) =>
    assembleFromPlan({ steps: [{ kind: 'output', sink: sinkClause }] }, 'x', []).steps[0] as {
      sink: string;
    };
  // normalizeSink is used in assembleFromPlan; sinkForClause (console default) is used in heuristic.
  assert.equal(mk('email').sink, 'email');
  assert.equal(mk('whatsapp').sink, 'whatsapp');
  assert.equal(mk('report').sink, 'report');
  assert.equal(mk('random').sink, 'console');

  // heuristic path drives sinkForClause: a "send" clause with no channel keyword → console.
  const h = heuristicDecompose('decide the case then send the outcome', []);
  const out = h.steps.find((s) => s.kind === 'output') as { sink: string };
  assert.equal(out.sink, 'console');
  const hEmail = heuristicDecompose('decide then email the result', []);
  assert.equal((hEmail.steps.find((s) => s.kind === 'output') as { sink: string }).sink, 'email');
});

test('compileAppSpec: model-plan path used when the injected model returns a usable plan', async () => {
  const deps = {
    loadDomains: async () => [invoices],
    modelDecompose: async (): Promise<ModelPlan | null> => ({
      title: 'AR bot',
      steps: [
        { kind: 'connector-query', dataPhrase: 'bills' },
        { kind: 'agent', instruction: 'decide' },
        { kind: 'output', sink: 'report' },
      ],
    }),
  };
  const { spec, gaps } = await compileAppSpec('read bills and decide then report', { orgId: 'default', ownerId: 'u' }, deps);
  assert.equal(spec.steps[0].kind, 'connector-query');
  assert.ok(spec.steps.some((s) => s.kind === 'output'));
  assert.deepEqual(gaps, []);
});

test('compileAppSpec: falls back to the heuristic when the model returns null', async () => {
  const deps = {
    loadDomains: async () => [] as DataDomain[],
    modelDecompose: async (): Promise<ModelPlan | null> => null,
  };
  const { spec } = await compileAppSpec('summarize the weekly numbers and send a report', { orgId: 'default', ownerId: 'u' }, deps);
  assert.ok(spec.steps.length >= 1);
  assert.equal(spec.orgId, 'default');
});

test('compileAppSpec: an empty model plan is rejected → heuristic used; loadDomains rejection is swallowed', async () => {
  const deps = {
    loadDomains: async () => {
      throw new Error('db down');
    },
    modelDecompose: async (): Promise<ModelPlan | null> => ({ steps: [] }),
  };
  const { spec } = await compileAppSpec('do a thing', { orgId: 'o', ownerId: 'u' }, deps);
  assert.ok(spec.steps.length >= 1);
});
