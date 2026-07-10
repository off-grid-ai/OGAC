// Fails-before / passes-after proof for the demo-tenant seed fix.
//
// THE BUG: scripts/seed-demo-tenants.mts built app steps as { id, kind, label, config: {...} },
// nesting domain/systemPrompt/sink under `config`. The REAL validator (validateAppSpec in
// app-model.ts) reads those fields at the step's TOP level, so every seeded app spec failed with
// "connector-query needs a domain binding / agent needs agentId or inlineAgent / output needs a
// sink" — aborting seedApps and halting the whole run.
//
// THE FIX: buildAppGraph (tour-demo-seed.ts) maps each AppStepSpec to the concrete AppStep shape.
// These tests drive that REAL builder into the REAL validator for EVERY seeded app of BOTH tenants
// and assert ok — the exact check createApp/updateApp run at seed time. A regression to the nested
// `config` shape (or any invalid step) turns these red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANK_APPS,
  INSURER_APPS,
  BHARAT_PROFILE,
  SURAKSHA_PROFILE,
  appsFor,
  buildAppGraph,
  buildAppSteps,
  buildAppEdges,
  type AppSpecSeed,
} from '@/lib/tour-demo-seed';
import { validateAppSpec, type AppSpec } from '@/lib/app-model';

// Build the FULL AppSpec exactly as apps-store.specFor does (store-managed fields filled in), so the
// validation we run here is byte-for-byte what createApp/updateApp run against.
function specFor(seed: AppSpecSeed, orgId: string): AppSpec {
  const { steps, edges } = buildAppGraph(seed);
  return {
    id: `app_${seed.key}`,
    orgId,
    ownerId: 'viewer@demo',
    title: seed.title,
    summary: seed.summary,
    visibility: 'org',
    pipelineId: null,
    published: false,
    trigger: { kind: 'on-demand' },
    steps,
    edges,
  };
}

const ALL: { org: string; seed: AppSpecSeed }[] = [
  ...BANK_APPS.map((seed) => ({ org: BHARAT_PROFILE.orgId, seed })),
  ...INSURER_APPS.map((seed) => ({ org: SURAKSHA_PROFILE.orgId, seed })),
];

test('EVERY seeded app (both tenants) passes the REAL validateAppSpec', () => {
  for (const { org, seed } of ALL) {
    const result = validateAppSpec(specFor(seed, org));
    assert.ok(
      result.ok,
      `${org} / ${seed.title} must validate, got: ${result.errors.join('; ')}`,
    );
  }
  // Sanity: we actually exercised both tenants' full rosters (6 + 6).
  assert.equal(ALL.length, BANK_APPS.length + INSURER_APPS.length);
  assert.ok(ALL.length >= 12, 'both tenant rosters covered');
});

test('appsFor(profile) rosters each validate end-to-end', () => {
  for (const profile of [BHARAT_PROFILE, SURAKSHA_PROFILE]) {
    for (const seed of appsFor(profile)) {
      const result = validateAppSpec(specFor(seed, profile.orgId));
      assert.ok(result.ok, `${profile.orgId} / ${seed.title}: ${result.errors.join('; ')}`);
    }
  }
});

test('buildAppSteps: connector-query carries a TOP-LEVEL domain (not nested under config)', () => {
  const seed = BANK_APPS.find((a) => a.key === 'loan-underwriting')!;
  const steps = buildAppSteps(seed);
  const cq = steps.filter((s) => s.kind === 'connector-query');
  assert.ok(cq.length >= 2, 'loan underwriting has connector-query steps');
  for (const s of cq) {
    assert.equal(s.kind, 'connector-query');
    if (s.kind === 'connector-query') {
      assert.ok(s.domain && s.domain.trim().length > 0, 'domain bound at top level');
      // The bug shape (config) must NOT reappear.
      assert.equal((s as Record<string, unknown>).config, undefined);
    }
  }
});

test('buildAppSteps: agent steps carry inlineAgent.systemPrompt at top level', () => {
  for (const seed of [...BANK_APPS, ...INSURER_APPS]) {
    for (const s of buildAppSteps(seed)) {
      if (s.kind === 'agent') {
        assert.ok(
          s.agentId || (s.inlineAgent && s.inlineAgent.systemPrompt.trim().length > 0),
          `${seed.title} agent step needs agentId or inlineAgent.systemPrompt`,
        );
      }
    }
  }
});

test('buildAppSteps: output steps carry a valid, SHADOW-safe sink at top level', () => {
  const safe = new Set(['console', 'report']);
  for (const seed of [...BANK_APPS, ...INSURER_APPS]) {
    const outs = buildAppSteps(seed).filter((s) => s.kind === 'output');
    assert.ok(outs.length >= 1, `${seed.title} has an output step`);
    for (const s of outs) {
      if (s.kind === 'output') {
        assert.ok(s.sink, 'sink present');
        assert.ok(safe.has(s.sink), `${seed.title} sink '${s.sink}' is SHADOW-safe`);
      }
    }
  }
});

test('buildAppEdges: exactly one entry, all reachable (linear chain over positional ids)', () => {
  const seed = INSURER_APPS.find((a) => a.key === 'fnol-motor')!;
  const { steps, edges } = buildAppGraph(seed);
  // ids are positional s0..sN
  assert.deepEqual(
    steps.map((s) => s.id),
    steps.map((_, i) => `s${i}`),
  );
  // one fewer edge than steps (a chain), and each edge connects consecutive ids
  assert.equal(edges.length, steps.length - 1);
  edges.forEach((e, i) => {
    assert.equal(e.from, `s${i}`);
    assert.equal(e.to, `s${i + 1}`);
  });
  // an empty chain of edges only for a single step
  assert.equal(buildAppEdges([]).length, 0);
});

// BRANCH COVERAGE: exercise the fallback arms (?? / toSink default) that real seed data never hits.
test('buildAppSteps: missing fields fall back safely (domain→"", systemPrompt→label, sink→report)', () => {
  const seed: AppSpecSeed = {
    key: 'edge',
    title: 'Edge App',
    summary: 's',
    pipelineName: 'KYC Verification',
    // deliberately omit domain / systemPrompt / sink, and pass an INVALID sink
    steps: [
      { kind: 'connector-query', label: 'q' },
      { kind: 'agent', label: 'a' },
      { kind: 'output', label: 'o' },
      { kind: 'output', label: 'bad', sink: 'live-webhook' }, // invalid → coerced to 'report'
    ],
    runs: { done: 1, awaitingReview: 0 },
  };
  const steps = buildAppSteps(seed);
  const cq = steps[0];
  const ag = steps[1];
  const o1 = steps[2];
  const o2 = steps[3];
  assert.equal(cq.kind === 'connector-query' && cq.domain, '', 'missing domain → empty string');
  assert.equal(
    ag.kind === 'agent' && ag.inlineAgent?.systemPrompt,
    'a',
    'missing systemPrompt → the label',
  );
  assert.equal(o1.kind === 'output' && o1.sink, 'report', 'missing sink → report');
  assert.equal(o2.kind === 'output' && o2.sink, 'report', 'invalid sink → report');
  // a valid explicit sink is preserved
  const kept = buildAppSteps({ ...seed, steps: [{ kind: 'output', label: 'o', sink: 'console' }] });
  assert.equal(kept[0].kind === 'output' && kept[0].sink, 'console', 'valid sink preserved');
});

// GUARD: prove the test would FAIL on the OLD (buggy) nested-config shape — the exact regression.
test('the pre-fix nested-config step shape FAILS the validator (regression guard)', () => {
  const seed = BANK_APPS[0];
  const buggySteps = seed.steps.map((s, i) => ({
    id: `s${i}`,
    kind: s.kind,
    label: s.label,
    config: { domain: s.domain, op: s.op, systemPrompt: s.systemPrompt, sink: s.sink },
  }));
  const buggyEdges = buggySteps.slice(1).map((s, i) => ({ from: buggySteps[i].id, to: s.id }));
  const spec = {
    ...specFor(seed, BHARAT_PROFILE.orgId),
    steps: buggySteps as unknown as AppSpec['steps'],
    edges: buggyEdges,
  };
  const result = validateAppSpec(spec);
  assert.equal(result.ok, false, 'the old nested-config shape must be rejected');
  assert.ok(
    result.errors.some((e) => /domain binding|agentId or inlineAgent|needs a sink/.test(e)),
    `expected the seed-halting errors, got: ${result.errors.join('; ')}`,
  );
});
