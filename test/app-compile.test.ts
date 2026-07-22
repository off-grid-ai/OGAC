import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CompileDeps,
  type ModelPlan,
  compileAppSpec,
  heuristicDecompose,
  assembleFromPlan,
} from '../src/lib/app-compile.ts';
import { type DataDomain } from '../src/lib/data-domains.ts';
import { validateAppSpec, type AppStepKind } from '../src/lib/app-model.ts';

// Tests for the NL→AppSpec compiler (Builder Epic 2C, task #106). We inject the two boundaries
// (loadDomains + modelDecompose) so these exercise the REAL decomposition + honest data-domain
// binding + gap logic with zero live services. Compiler honesty (risk #5) is the product's
// credibility, so the anchor test proves an undeclared data phrase surfaces a gap and NEVER
// fabricates a connector.

const CTX = { orgId: 'default', ownerId: 'op@x' };

// A realistic seeded org declaration set: invoices + reimbursement quota both have real connectors.
const INVOICES: DataDomain = {
  id: 'dom_inv',
  orgId: 'default',
  label: 'Invoices',
  aliases: ['invoice', 'billing documents'],
  connectorId: 'con_s3',
  resource: 'invoices',
};
const QUOTA: DataDomain = {
  id: 'dom_quota',
  orgId: 'default',
  label: 'Reimbursement Quota',
  aliases: ['employee quota', 'quota', 'expense limit'],
  connectorId: 'con_hr',
  resource: 'employee_quota',
};
const SEEDED = [INVOICES, QUOTA];

const REIMBURSEMENT =
  "reimbursement approval — read the invoice, check the employee's quota, " +
  'check if they have exceeded and are eligible, then approve or reject';

function stubDeps(domains: DataDomain[], plan: ModelPlan | null): CompileDeps {
  return {
    loadDomains: async () => domains,
    modelDecompose: async () => plan,
  };
}

const kinds = (spec: { steps: { kind: AppStepKind }[] }) => spec.steps.map((s) => s.kind);

// ─── LLM path — the reimbursement example compiles to the expected step KINDS in order ───────────
test('LLM path: reimbursement produces the canonical step kinds and binds quota+invoice', async () => {
  const plan: ModelPlan = {
    title: 'Reimbursement approval',
    steps: [
      { kind: 'connector-query', dataPhrase: 'invoice' },
      { kind: 'connector-query', dataPhrase: 'employee quota' },
      { kind: 'agent', instruction: 'Decide eligibility / whether quota exceeded' },
      { kind: 'human', label: 'Approve or reject' },
      { kind: 'output', sink: 'console' },
    ],
  };
  const { spec, gaps } = await compileAppSpec(REIMBURSEMENT, CTX, stubDeps(SEEDED, plan));

  assert.deepEqual(kinds(spec), ['connector-query', 'connector-query', 'agent', 'human', 'output']);
  // The two connector-query steps bind to the REAL seeded domain ids (never a fabricated id).
  const cq = spec.steps.filter((s) => s.kind === 'connector-query') as Array<{ domain: string }>;
  assert.deepEqual(cq.map((s) => s.domain).sort(), ['dom_inv', 'dom_quota']);
  // Bound cleanly → no gaps.
  assert.deepEqual(gaps, []);
  // Always a valid one-entry linear graph.
  assert.equal(validateAppSpec(spec).ok, true, validateAppSpec(spec).errors.join('; '));
  assert.equal(spec.edges.length, spec.steps.length - 1);
});

test('a resolver-approved generated default is persisted as an explicit pipeline binding', async () => {
  const { spec } = await compileAppSpec(
    'send a report',
    { ...CTX, defaultPipelineId: 'pipeline-only-choice' },
    stubDeps([], null),
  );

  assert.equal(spec.pipelineId, 'pipeline-only-choice');
});

// ─── HONESTY (risk #5) — undeclared data surfaces a GAP, never a fabricated connector ────────────
test('undeclared data phrase surfaces a gap and drops the step — NO fabricated connector', async () => {
  const plan: ModelPlan = {
    steps: [
      { kind: 'connector-query', dataPhrase: 'invoice' }, // declared → binds
      { kind: 'connector-query', dataPhrase: 'the vendor blacklist' }, // NOT declared → gap
      { kind: 'agent', instruction: 'decide' },
      { kind: 'output', sink: 'console' },
    ],
  };
  const { spec, gaps } = await compileAppSpec('read the invoice, check the vendor blacklist, decide', CTX, stubDeps(SEEDED, plan));

  // Only the declared connector-query survived; the undeclared one was dropped, not faked.
  const cq = spec.steps.filter((s) => s.kind === 'connector-query') as Array<{ domain: string }>;
  assert.equal(cq.length, 1);
  assert.equal(cq[0].domain, 'dom_inv');
  // No step references an undeclared/fabricated domain id.
  assert.ok(cq.every((s) => SEEDED.some((d) => d.id === s.domain)));
  // The gap is surfaced honestly, naming the unbindable phrase.
  assert.ok(gaps.some((g) => /vendor blacklist/i.test(g) && /data source declared/i.test(g)), gaps.join(' | '));
  assert.equal(validateAppSpec(spec).ok, true);
});

test('a description with NO declared domains at all binds nothing and gaps every data phrase', async () => {
  const plan: ModelPlan = {
    steps: [
      { kind: 'connector-query', dataPhrase: 'invoice' },
      { kind: 'connector-query', dataPhrase: 'quota' },
      { kind: 'agent', instruction: 'decide' },
      { kind: 'output', sink: 'console' },
    ],
  };
  const { spec, gaps } = await compileAppSpec(REIMBURSEMENT, CTX, stubDeps([], plan));
  assert.equal(spec.steps.some((s) => s.kind === 'connector-query'), false);
  assert.ok(gaps.filter((g) => /data source declared/i.test(g)).length >= 2);
  assert.equal(validateAppSpec(spec).ok, true);
});

test('resolver-approved domain ids constrain generated bindings before preview', async () => {
  const allowedDataDomainIds = new Set([SEEDED[0]!.id]);
  const plan: ModelPlan = {
    steps: [
      { kind: 'connector-query', dataPhrase: 'invoice' },
      { kind: 'connector-query', dataPhrase: 'employee quota' },
      { kind: 'agent', instruction: 'decide' },
      { kind: 'output', sink: 'console' },
    ],
  };
  const { spec, gaps } = await compileAppSpec(
    'read the invoice and check the employee quota, then decide',
    { ...CTX, allowedDataDomainIds },
    stubDeps(SEEDED, plan),
  );

  const domains = spec.steps
    .filter((step) => step.kind === 'connector-query')
    .map((step) => step.domain);
  assert.deepEqual(domains, [SEEDED[0]!.id]);
  assert.equal(gaps.some((gap) => /quota/i.test(gap)), true);
});

// ─── Deterministic heuristic fallback (no gateway) ───────────────────────────────────────────────
test('heuristic fallback (modelDecompose null): reimbursement still yields a governed multi-step spec', async () => {
  const { spec, gaps } = await compileAppSpec(REIMBURSEMENT, CTX, stubDeps(SEEDED, null));
  void gaps;
  const k = kinds(spec);
  // Data reads bind, a decision agent reasons, a human approves, an output ends it — in order.
  assert.ok(k.includes('connector-query'), k.join(','));
  assert.ok(k.includes('agent'), k.join(','));
  assert.ok(k.includes('human'), k.join(','));
  assert.equal(k[k.length - 1], 'output');
  // The bound connector-query steps reference real seeded ids.
  const cq = spec.steps.filter((s) => s.kind === 'connector-query') as Array<{ domain: string }>;
  assert.ok(cq.length >= 1);
  assert.ok(cq.every((s) => SEEDED.some((d) => d.id === s.domain)));
  assert.equal(validateAppSpec(spec).ok, true, validateAppSpec(spec).errors.join('; '));
});

test('heuristicDecompose binds the invoice + quota phrases to seeded domains directly', () => {
  const built = heuristicDecompose(REIMBURSEMENT, SEEDED);
  const cq = built.steps.filter((s) => s.kind === 'connector-query') as Array<{ domain: string }>;
  const bound = new Set(cq.map((s) => s.domain));
  assert.ok(bound.has('dom_inv'), 'invoice should bind');
  assert.ok(bound.has('dom_quota'), 'quota should bind');
  assert.deepEqual(built.gaps, []);
});

test('heuristic: approval intent inserts a human review before output even without an explicit approve clause', () => {
  const built = heuristicDecompose('expense approval — check the employee quota then decide eligibility', SEEDED);
  const k = built.steps.map((s) => s.kind);
  assert.ok(k.includes('human'), k.join(','));
  assert.equal(k[k.length - 1], 'output');
});

// ─── assembleFromPlan — unknown kinds are gapped, never guessed into existence ───────────────────
test('assembleFromPlan gaps an unknown step kind rather than inventing a step', () => {
  const plan: ModelPlan = {
    steps: [
      { kind: 'agent', instruction: 'reason' },
      { kind: 'teleport', label: 'do magic' }, // nonsense kind
      { kind: 'output', sink: 'report' },
    ],
  };
  const built = assembleFromPlan(plan, 'x', SEEDED);
  assert.deepEqual(built.steps.map((s) => s.kind), ['agent', 'output']);
  assert.ok(built.gaps.some((g) => /unknown kind 'teleport'/i.test(g)));
});

// ─── output always validates + is always terminal ────────────────────────────────────────────────
test('the compiled spec always ends with an output sink and always validates', async () => {
  const cases: Array<[string, ModelPlan | null]> = [
    ['just answer questions about our policies', null],
    ['read the invoice', { steps: [{ kind: 'connector-query', dataPhrase: 'invoice' }] }],
    ['', null],
    ['send an email report', null],
  ];
  for (const [desc, plan] of cases) {
    const { spec } = await compileAppSpec(desc, CTX, stubDeps(SEEDED, plan));
    assert.equal(validateAppSpec(spec).ok, true, `${desc}: ${validateAppSpec(spec).errors.join('; ')}`);
    assert.equal(spec.steps[spec.steps.length - 1].kind, 'output', `${desc} should end with output`);
    assert.ok(spec.steps.length >= 1);
  }
});

// ─── LLM plan that returns junk (no steps) → heuristic fallback kicks in ──────────────────────────
test('empty model plan falls back to the deterministic heuristic', async () => {
  const { spec } = await compileAppSpec(REIMBURSEMENT, CTX, stubDeps(SEEDED, { steps: [] }));
  assert.ok(spec.steps.length > 1); // heuristic produced a real multi-step spec
  assert.equal(validateAppSpec(spec).ok, true);
});
