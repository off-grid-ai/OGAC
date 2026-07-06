import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileAppSpec, type CompileDeps } from '@/lib/app-compile';
import { type DataDomain, resolveDomain } from '@/lib/data-domains';
import { validateAppSpec, type AppStepKind } from '@/lib/app-model';
import {
  runApp,
  type AppRunDeps,
  type StepResult,
  type DomainLike,
} from '@/lib/app-run';
import {
  SEED_CONNECTORS,
  SEED_DOMAINS,
  buildReimbursementAppSpec,
  planConnectors,
  planDomains,
  shouldSeedSampleApp,
  REIMBURSEMENT_DESCRIPTION,
} from '@/lib/data-domains-demo-seed';

// ─── END-TO-END verification for the flagship reimbursement use case (Builder Epic task #106) ─────
//
// Proves the WHOLE path with the REAL demo seed as the org's declarations — no live DB/gateway:
//   1. The seeded data-domains bind the reimbursement description at COMPILE time (compileAppSpec) —
//      the connector-query steps resolve to declared domains, NOT gaps.
//   2. The seeded SAMPLE app RUNS through runApp with injected fakes: steps execute in order and the
//      human step PAUSES the run (awaiting_human) before output.
//   3. The seed planners are idempotent + honest (never bind a domain to a missing connector).
//
// All external boundaries (gateway decompose, agent run, connector read, persistence) are injected
// fakes via the DI seams — this is a pure-logic + real-wiring test, not an infra test.

const CTX = { orgId: 'default', ownerId: 'demo@offgrid.local' };

// The seeded domains as the resolver's DataDomain view (what compileAppSpec.loadDomains yields in
// prod). We assign synthetic-but-stable ids the way the store would; the connectorId points at the
// seed connector's local key stand-in (a real id in prod). Labels/aliases are the REAL seed values.
const SEEDED_DOMAINS: DataDomain[] = SEED_DOMAINS.map((d, i) => ({
  id: `dom_seed_${i}`,
  orgId: CTX.orgId,
  label: d.label,
  aliases: d.aliases,
  connectorId: `con_${d.connectorKey}`,
  resource: d.resource,
  opHints: d.opHints,
}));

function compileDeps(): CompileDeps {
  return {
    loadDomains: async () => SEEDED_DOMAINS,
    // Force the deterministic heuristic path (no gateway) so the test is hermetic and proves the
    // fallback the demo relies on offline. (The LLM path is covered in app-compile.test.ts.)
    modelDecompose: async () => null,
  };
}

const kinds = (steps: { kind: AppStepKind }[]) => steps.map((s) => s.kind);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. COMPILE — the reimbursement description compiles to a governed multi-step spec, and its
//    connector-query steps bind to the SEEDED domains (invoices + reimbursement quota), not gaps.
// ─────────────────────────────────────────────────────────────────────────────────────────────
test('reimbursement description compiles to a governed multi-step spec bound to seeded domains', async () => {
  const { spec, gaps } = await compileAppSpec(REIMBURSEMENT_DESCRIPTION, CTX, compileDeps());

  // Multi-step: at least the two data reads + a decision + a human gate + an output.
  const k = kinds(spec.steps);
  assert.ok(spec.steps.length >= 4, `expected a multi-step spec, got ${spec.steps.length}: ${k.join(',')}`);
  assert.ok(k.includes('connector-query'), `expected connector-query steps, got ${k.join(',')}`);
  assert.ok(k.includes('agent'), 'expected an agent (eligibility decision) step');
  assert.ok(k.includes('human'), 'expected a human (approve/reject) step');
  assert.equal(k[k.length - 1], 'output', 'a governed app always ends with an output sink');

  // The connector-query steps bind to REAL seeded domain ids — never a fabricated id.
  const cq = spec.steps.filter((s) => s.kind === 'connector-query') as Array<{ domain: string }>;
  assert.ok(cq.length >= 2, `expected ≥2 connector-query steps (invoice + quota), got ${cq.length}`);
  const boundIds = new Set(SEEDED_DOMAINS.map((d) => d.id));
  assert.ok(cq.every((s) => boundIds.has(s.domain)), `all cq steps bind a seeded domain: ${cq.map((s) => s.domain).join(',')}`);

  // The invoice + quota domains both got bound (the flagship's two data sources).
  const boundLabels = new Set(cq.map((s) => SEEDED_DOMAINS.find((d) => d.id === s.domain)?.label));
  assert.ok(boundLabels.has('invoices'), 'the invoice read bound the "invoices" domain');
  assert.ok(boundLabels.has('reimbursement quota'), 'the quota read bound the "reimbursement quota" domain');

  // No "no data source declared" gap — the two data phrases resolved cleanly.
  assert.deepEqual(
    gaps.filter((g) => /data source declared/i.test(g)),
    [],
    `no unbindable-data gaps expected; got: ${gaps.join(' | ')}`,
  );

  // Always a valid one-entry linear graph.
  const v = validateAppSpec(spec);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(spec.edges.length, spec.steps.length - 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. RUN — the seeded SAMPLE app runs through runApp with injected fakes: steps execute in order and
//    the human step pauses the run. (The sample app stores domain LABELS in step.domain so they
//    resolve at RUN time via the label-matching resolver — the honest end-to-end binding.)
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Fakes for the two external boundaries + a no-op persist. listDomains returns the SEEDED domains so
// the connector-query steps resolve exactly as they would in prod (by label). runAgent must be
// invoked with an agentId; the sample app uses an inline agent, so we materialize it below.
function fakeRunDeps(over: Partial<AppRunDeps> = {}): AppRunDeps {
  const order: string[] = [];
  const deps: AppRunDeps = {
    async runAgent(agentId, query) {
      order.push(`agent:${agentId}`);
      return { id: `run_${agentId}`, answer: `Eligibility decided from: ${query.slice(0, 40)}`, status: 'done', citations: [] };
    },
    async listDomains(): Promise<DomainLike[]> {
      return SEEDED_DOMAINS.map((d) => ({ id: d.id, label: d.label, connectorId: d.connectorId, resource: d.resource, opHints: d.opHints }));
    },
    async getConnector(id) {
      return { id, type: 'mysql', endpoint: 'mysql://fake' };
    },
    async queryDomain(domain) {
      order.push(`read:${domain.label}`);
      return { result: { rows: [{ used: 3, cap: 5 }], count: 1, dialect: 'mysql' }, detail: 'read 1 row' };
    },
    async runGuardrail() {
      return { blocked: false, detail: 'ok' };
    },
    async persist() {},
    async materializeAgent(_spec, step) {
      order.push(`materialize:${step.id}`);
      step.agentId = `ag_mat_${step.id}`;
      return step.agentId;
    },
    ...over,
  };
  (deps as unknown as { _order: string[] })._order = order;
  return deps;
}

test('seeded reimbursement app runs step-by-step and PAUSES at the human gate', async () => {
  const spec = buildReimbursementAppSpec(CTX.orgId, CTX.ownerId);

  // The sample app carries an INLINE agent (no agentId) — runApp requires an agentId to reuse the
  // governed pipeline. Materialize the inline agent into a stand-in agentId for the run (mirrors the
  // builder's "materialize inline agent" step; see app-run.ts executeAgentStep note).
  const runnable = {
    ...spec,
    steps: spec.steps.map((s) =>
      s.kind === 'agent' ? { ...s, agentId: 'ag_eligibility' } : s,
    ),
  };

  const deps = fakeRunDeps();
  const outcome = await runApp(runnable, { invoiceId: 'INV-1' }, { orgId: CTX.orgId, runId: 'run_e2e_1' }, deps);

  // The run stops at the human step — it does NOT complete.
  assert.equal(outcome.status, 'awaiting_human', `expected awaiting_human, got ${outcome.status}`);

  // Steps executed in order up to (and including) the human pause: two reads, then the agent, then
  // the human gate. The output step must NOT have run yet.
  const executed = kinds(outcome.steps.map((s) => ({ kind: s.kind })));
  assert.deepEqual(executed, ['connector-query', 'connector-query', 'agent', 'human'], `execution order: ${executed.join(',')}`);
  assert.equal(outcome.steps[outcome.steps.length - 1].status, 'awaiting_human');

  // The connector-query steps RESOLVED (did not error on an unbound domain) — they read via the fake.
  const reads = outcome.steps.filter((s) => s.kind === 'connector-query');
  assert.ok(reads.every((r) => r.status === 'done'), `both reads resolved: ${reads.map((r) => `${r.stepId}:${r.status}`).join(',')}`);

  // The two reads hit the invoices + reimbursement-quota domains, in order, before the decision.
  const order = (deps as unknown as { _order: string[] })._order;
  assert.deepEqual(order.slice(0, 2), ['read:invoices', 'read:reimbursement quota'], `read order: ${order.join(',')}`);
  assert.ok(order.includes('agent:ag_eligibility'), 'the eligibility agent ran after the reads');
});

test("seeded app's connector-query steps resolve by LABEL against the seeded domains (the run-time binding contract)", () => {
  // This is the seam the sample app depends on: runtime resolveDomain matches step.domain (a LABEL)
  // against the declared domains. Assert it holds for BOTH data steps so the run above is not a fluke.
  const domains = SEEDED_DOMAINS;
  const spec = buildReimbursementAppSpec(CTX.orgId, CTX.ownerId);
  const cq = spec.steps.filter((s) => s.kind === 'connector-query') as Array<{ domain: string }>;
  for (const step of cq) {
    const resolved = resolveDomain(step.domain, domains);
    assert.ok(resolved, `sample-app step.domain "${step.domain}" must resolve at run time`);
  }
  // Specifically the two flagship domains.
  assert.equal(resolveDomain('invoices', domains)?.label, 'invoices');
  assert.equal(resolveDomain('reimbursement quota', domains)?.label, 'reimbursement quota');
});

test("GAP #113: the seeded app's INLINE agent step now materializes + runs (no pre-wiring)", async () => {
  // Run the seeded app VERBATIM — its decision step is an inline agent with NO agentId. Before the
  // #113 fix this errored at that step; now runApp materializes it (via deps.materializeAgent) and
  // runs it, then pauses at the human gate.
  const spec = buildReimbursementAppSpec(CTX.orgId, CTX.ownerId);
  const deps = fakeRunDeps();
  const outcome = await runApp(spec, { invoiceId: 'INV-1' }, { orgId: CTX.orgId, runId: 'run_e2e_inline' }, deps);

  assert.equal(outcome.status, 'awaiting_human', `expected awaiting_human, got ${outcome.status}`);
  const agentStep = outcome.steps.find((s) => s.kind === 'agent');
  assert.ok(agentStep, 'the inline agent step executed');
  assert.equal(agentStep!.status, 'done', 'the inline agent step ran (materialized), not errored');

  const order = (deps as unknown as { _order: string[] })._order;
  assert.ok(order.some((o) => o.startsWith('materialize:')), 'the inline agent was materialized');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. SEED PLANNERS — idempotent + honest (never bind a domain to a missing connector).
// ─────────────────────────────────────────────────────────────────────────────────────────────
test('planConnectors is idempotent — a fully-seeded org creates nothing', () => {
  const existing = SEED_CONNECTORS.map((c, i) => ({ id: `con_${i}`, name: c.name }));
  const plan = planConnectors(existing);
  assert.deepEqual(plan.toCreate, []);
  assert.equal(plan.present.length, SEED_CONNECTORS.length);
});

test('planConnectors on an empty org proposes exactly the real data-sources.yml connectors', () => {
  const plan = planConnectors([]);
  assert.equal(plan.toCreate.length, SEED_CONNECTORS.length);
  // Only real dialects — never a fabricated connector type.
  assert.ok(plan.toCreate.every((c) => ['postgres', 'mysql', 'mssql', 'rest', 's3'].includes(c.type)));
});

test('planDomains binds every domain to a REAL connector id, and skips (never fabricates) when the connector is absent', () => {
  // A connector set that covers every seed connector by name.
  const connectorsByName = new Map(SEED_CONNECTORS.map((c, i) => [c.name.toLowerCase(), `con_real_${i}`]));
  const full = planDomains([], connectorsByName);
  assert.equal(full.toCreate.length, SEED_DOMAINS.length, 'all domains bind when every connector exists');
  assert.equal(full.unbacked.length, 0);
  assert.ok(full.toCreate.every((d) => /^con_real_/.test(d.connectorId)), 'each domain got a REAL connector id');

  // Now drop the ERP connector — the invoices domain (bound to ERP) must be SKIPPED, never fabricated.
  const partial = new Map(connectorsByName);
  const erpName = SEED_CONNECTORS.find((c) => c.key === 'erp')!.name.toLowerCase();
  partial.delete(erpName);
  const dropped = planDomains([], partial);
  assert.ok(dropped.unbacked.some((d) => d.label === 'invoices'), 'invoices is unbacked when ERP is missing');
  assert.ok(dropped.toCreate.every((d) => d.connectorId), 'no domain in toCreate has an empty/fake connector id');
  assert.ok(!dropped.toCreate.some((d) => d.label === 'invoices'), 'invoices was NOT created against a fake connector');
});

test('planDomains is idempotent by label — already-declared labels are left as present', () => {
  const connectorsByName = new Map(SEED_CONNECTORS.map((c, i) => [c.name.toLowerCase(), `con_real_${i}`]));
  const existing = SEED_DOMAINS.map((d, i) => ({ id: `dom_${i}`, label: d.label }));
  const plan = planDomains(existing, connectorsByName);
  assert.deepEqual(plan.toCreate, []);
  assert.equal(plan.present.length, SEED_DOMAINS.length);
});

test('shouldSeedSampleApp is idempotent by title', () => {
  assert.equal(shouldSeedSampleApp([]), true);
  assert.equal(shouldSeedSampleApp(['Something else']), true);
  assert.equal(shouldSeedSampleApp(['Reimbursement Approval']), false);
  assert.equal(shouldSeedSampleApp(['reimbursement approval']), false, 'case-insensitive');
});
