// CONDITION-COVERAGE tests for app-compile.ts — the lowest-covered target (branch 72.97%). We hit:
//   • assembleFromPlan: EVERY step-kind arm (guardrail, output-with-sink, unknown→gap, dropped
//     connector-query, the label/instruction `||` fallback chains).
//   • heuristicDecompose: the title-strip segment, each clause class, the synthesizing-agent insert,
//     the implied-approval human insert, the always-append output, and the degenerate single-agent.
//   • finalizeSpec: terminal-output guarantee + the id-collision `while` de-dup arm + single-step
//     (no edges) vs multi-step edge chaining.
//   • classifyClause / sinkForClause / normalizeSink / deriveTitle: every regex/ternary arm.
//   • defaultDeps.modelDecompose (→ gatewayDecompose): stubbed global fetch drives !ok, no-json,
//     non-array steps, valid, and the throw→catch arm; plus defaultDeps.loadDomains over the DB.
// Additive; imports existing exports only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ModelPlan,
  assembleFromPlan,
  compileAppSpec,
  defaultDeps,
  finalizeSpec,
  heuristicDecompose,
} from '@/lib/app-compile';
import type { DataDomain } from '@/lib/data-domains';

const CTX = { orgId: 'default', ownerId: 'op@x' };
const DOM: DataDomain = {
  id: 'dom_inv',
  orgId: 'default',
  label: 'Invoices',
  aliases: ['invoice', 'billing documents'],
  connectorId: 'con_s3',
  resource: 'invoices',
};

// ─── assembleFromPlan — every kind arm, drops, gaps, fallbacks ─────────────────────────────────────

test('assembleFromPlan: guardrail + human + output(sink) + agent kinds all build their step', () => {
  const plan: ModelPlan = {
    title: 'Mixed',
    steps: [
      { kind: 'guardrail' }, // guardrail arm, default label
      { kind: 'agent' }, // agent arm, default systemPrompt fallback chain
      { kind: 'human' }, // human arm, default label
      { kind: 'output', sink: 'report' }, // output arm w/ explicit sink normalized
    ],
  };
  const out = assembleFromPlan(plan, 'do things', []);
  assert.deepEqual(out.steps.map((s) => s.kind), ['guardrail', 'agent', 'human', 'output']);
  const output = out.steps.find((s) => s.kind === 'output')!;
  assert.equal((output as { sink: string }).sink, 'report');
  const guardrail = out.steps.find((s) => s.kind === 'guardrail')!;
  assert.equal(guardrail.label, 'Guardrail check');
});

test('assembleFromPlan: an unknown kind is ignored with a gap + step-number NOT consumed', () => {
  const plan: ModelPlan = {
    steps: [
      { kind: 'bogus-kind', label: 'weird' },
      { kind: 'agent', instruction: 'reason' },
    ],
  };
  const out = assembleFromPlan(plan, 'x', []);
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].id, 's1'); // agent took s1 because bogus rolled back n
  assert.ok(out.gaps.some((g) => /unknown kind 'bogus-kind'/.test(g) && /weird/.test(g)));
});

test('assembleFromPlan: unknown kind WITHOUT a label omits the parenthetical (ps.label false arm)', () => {
  const out = assembleFromPlan({ steps: [{ kind: 'nope' }] }, 'x', []);
  assert.ok(out.gaps.some((g) => /unknown kind 'nope'$/.test(g)));
});

test('assembleFromPlan: connector-query that binds uses label fallback; an unbindable one drops+gaps', () => {
  const plan: ModelPlan = {
    steps: [
      { kind: 'connector-query', dataPhrase: 'invoice' }, // binds → label "Read Invoices"
      { kind: 'connector-query', dataPhrase: 'nonexistent widget data' }, // no domain → drop+gap
    ],
  };
  const out = assembleFromPlan(plan, 'x', [DOM]);
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].kind, 'connector-query');
  assert.equal(out.steps[0].label, 'Read Invoices');
  assert.ok(out.gaps.some((g) => /No data source declared/.test(g)));
});

test('assembleFromPlan: connector-query falls back to ps.label when dataPhrase is absent', () => {
  const out = assembleFromPlan({ steps: [{ kind: 'connector-query', label: 'invoice' }] }, 'x', [DOM]);
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].kind, 'connector-query');
});

test('assembleFromPlan: agent uses instruction, else label, else the description fallback', () => {
  const withInstr = assembleFromPlan({ steps: [{ kind: 'agent', instruction: 'INSTR' }] }, 'desc', []);
  assert.match((withInstr.steps[0] as { inlineAgent: { systemPrompt: string } }).inlineAgent.systemPrompt, /INSTR/);
  const withLabel = assembleFromPlan({ steps: [{ kind: 'agent', label: 'LBL' }] }, 'desc', []);
  assert.match((withLabel.steps[0] as { inlineAgent: { systemPrompt: string } }).inlineAgent.systemPrompt, /LBL/);
  const withDesc = assembleFromPlan({ steps: [{ kind: 'agent' }] }, 'DESCFALL', []);
  assert.match((withDesc.steps[0] as { inlineAgent: { systemPrompt: string } }).inlineAgent.systemPrompt, /DESCFALL/);
});

// ─── heuristicDecompose — clause classes, inserts, degenerate ──────────────────────────────────────

test('heuristic: full reimbursement flow builds data+agent+human+output, strips the title prefix', () => {
  const out = heuristicDecompose(
    "reimbursement approval — read the invoice, check if they are eligible, approve or reject, then email the result",
    [DOM],
  );
  const kinds = out.steps.map((s) => s.kind);
  assert.ok(kinds.includes('connector-query')); // "read the invoice" bound to DOM
  assert.ok(kinds.includes('agent')); // "check if eligible" → decision
  assert.ok(kinds.includes('human')); // "approve or reject"
  assert.equal(kinds[kinds.length - 1], 'output'); // ends with output (email sink)
  assert.equal(out.title, 'Reimbursement approval');
});

test('heuristic: a data clause whose phrase has NO declared domain drops + gaps', () => {
  // "invoice" is a data noun + "read" a data verb → a data clause; with zero declared domains it
  // cannot bind → the step is dropped and an honest gap is recorded (never fabricates a connector).
  const out = heuristicDecompose('read the invoice', []);
  assert.ok(out.gaps.some((g) => /No data source declared/.test(g)));
  assert.ok(!out.steps.some((s) => s.kind === 'connector-query')); // dropped, not fabricated
});

test('heuristic: data-only description gets a synthesizing agent appended (no decision clause)', () => {
  const out = heuristicDecompose('read the invoice', [DOM]);
  assert.ok(out.steps.some((s) => s.kind === 'agent')); // synthesizing agent inserted
  assert.equal(out.steps[out.steps.length - 1].kind, 'output'); // + always-output
});

test('heuristic: implied approval with a decision but no explicit human inserts a review step', () => {
  // "approval" in the text + a decision clause, but no explicit approve/reject clause.
  const out = heuristicDecompose('decide eligibility for approval of the claim', [DOM]);
  assert.ok(out.steps.some((s) => s.kind === 'human'));
});

test('heuristic: an all-filler description yields just the always-appended output step', () => {
  // No clause classifies as data/decision/approval/output → no steps → the synthesizing-agent and
  // implied-approval inserts are gated behind steps.length > 0, so only the terminal output lands.
  const out = heuristicDecompose('hello there friend', []);
  const kinds = out.steps.map((s) => s.kind);
  assert.equal(kinds.length, 1);
  assert.equal(kinds[0], 'output');
});

test('heuristic: empty description → single output step; title falls back to "Untitled app"', () => {
  const out = heuristicDecompose('', []);
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].kind, 'output');
  assert.equal(out.title, 'Untitled app');
});

test('heuristic: sinkForClause maps "report" and "whatsapp" output clauses to their sinks', () => {
  const report = heuristicDecompose('read the invoice, generate a report', [DOM]);
  assert.ok(report.steps.some((s) => s.kind === 'output' && (s as { sink: string }).sink === 'report'));
  const wa = heuristicDecompose('read the invoice, notify via whatsapp', [DOM]);
  assert.ok(wa.steps.some((s) => s.kind === 'output' && (s as { sink: string }).sink === 'whatsapp'));
  const email = heuristicDecompose('read the invoice, email the result', [DOM]);
  assert.ok(email.steps.some((s) => s.kind === 'output' && (s as { sink: string }).sink === 'email'));
});

test('assembleFromPlan: normalizeSink coerces an unknown/absent sink to console (default arm)', () => {
  const known = assembleFromPlan({ steps: [{ kind: 'output', sink: 'whatsapp' }] }, 'x', []);
  assert.equal((known.steps[0] as { sink: string }).sink, 'whatsapp');
  const junk = assembleFromPlan({ steps: [{ kind: 'output', sink: 'carrier-pigeon' }] }, 'x', []);
  assert.equal((junk.steps[0] as { sink: string }).sink, 'console'); // unknown → console
  const none = assembleFromPlan({ steps: [{ kind: 'output' }] }, 'x', []);
  assert.equal((none.steps[0] as { sink: string }).sink, 'console'); // undefined → console
});

// ─── finalizeSpec — terminal output guarantee + id-collision de-dup + edge chaining ────────────────

test('finalizeSpec: appends a terminal output when the last step is not an output', () => {
  const assembled = {
    steps: [{ id: 's1', label: 'A', kind: 'agent' as const, inlineAgent: { systemPrompt: 'x', grounded: true } }],
    gaps: [],
    title: 'T',
    summary: 'S',
  };
  const spec = finalizeSpec(assembled, CTX, 'desc');
  assert.equal(spec.steps[spec.steps.length - 1].kind, 'output');
  assert.equal(spec.edges.length, 1); // 2 steps → 1 edge
  assert.deepEqual(spec.edges[0], { from: 's1', to: spec.steps[1].id });
});

test('finalizeSpec: an id collision on the appended output bumps the id (while-loop arm)', () => {
  // Force the natural output id `s2` to already exist so the `while` appends an 'x'.
  const assembled = {
    steps: [
      { id: 's1', label: 'A', kind: 'agent' as const, inlineAgent: { systemPrompt: 'x', grounded: true } },
      { id: 's2', label: 'B', kind: 'agent' as const, inlineAgent: { systemPrompt: 'y', grounded: true } },
      { id: 's3', label: 'C', kind: 'agent' as const, inlineAgent: { systemPrompt: 'z', grounded: true } },
    ],
    gaps: [],
    title: 'T',
    summary: 'S',
  };
  // 3 steps → natural outId is `s${3+1}` = s4 (no collision). Rename one to s4 to force the bump.
  assembled.steps[0].id = 's4';
  const spec = finalizeSpec(assembled, CTX, 'desc');
  const out = spec.steps[spec.steps.length - 1];
  assert.equal(out.kind, 'output');
  assert.equal(out.id, 's4x'); // collided with s4 → bumped
});

test('finalizeSpec: a single output-only step yields NO edges (steps.length > 1 false arm)', () => {
  const assembled = {
    steps: [{ id: 's1', label: 'Out', kind: 'output' as const, sink: 'console' as const }],
    gaps: [],
    title: '',
    summary: '',
  };
  const spec = finalizeSpec(assembled, CTX, 'my described process here');
  assert.equal(spec.steps.length, 1);
  assert.deepEqual(spec.edges, []);
  assert.equal(spec.title, 'My described process here'); // title/summary derived from description
});

// ─── compileAppSpec — plan with zero real steps falls back to heuristic (built.steps.length arm) ──

test('compileAppSpec: a plan that produces no steps falls through to the heuristic', async () => {
  const deps = {
    loadDomains: async () => [DOM],
    modelDecompose: async () => ({ steps: [] as ModelPlan['steps'] }), // empty plan → not accepted
  };
  const { spec } = await compileAppSpec('read the invoice then decide', CTX, deps);
  // Heuristic ran → at least a connector-query bound + output.
  assert.ok(spec.steps.length >= 2);
});

test('compileAppSpec: modelDecompose throwing is caught (→ heuristic), loadDomains rejection → []', async () => {
  const deps = {
    loadDomains: async () => {
      throw new Error('db down');
    },
    modelDecompose: async () => {
      throw new Error('gateway down');
    },
  };
  const { spec, gaps } = await compileAppSpec('read the invoice, decide, approve', CTX, deps);
  // loadDomains rejected → domains [] → the data clause becomes a gap, heuristic still yields a spec.
  assert.ok(spec.steps.length >= 1);
  assert.ok(gaps.some((g) => /No data source declared/.test(g)));
});

// ─── defaultDeps.modelDecompose → gatewayDecompose — every fetch arm via a stubbed global fetch ────

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

test('gatewayDecompose: a non-ok response → null (r.ok false arm)', async () => {
  const plan = await withFetch(
    (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    () => defaultDeps.modelDecompose('read the invoice', [DOM]),
  );
  assert.equal(plan, null);
});

test('gatewayDecompose: ok but content has no JSON object → null (no-match arm)', async () => {
  const body = { choices: [{ message: { content: 'sorry, I have no plan' } }] };
  const plan = await withFetch(
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
    () => defaultDeps.modelDecompose('read the invoice', [DOM]),
  );
  assert.equal(plan, null);
});

test('gatewayDecompose: ok JSON but steps is not an array → null (Array.isArray false arm)', async () => {
  const body = { choices: [{ message: { content: '{"title":"x","steps":"nope"}' } }] };
  const plan = await withFetch(
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
    () => defaultDeps.modelDecompose('read the invoice', [DOM]),
  );
  assert.equal(plan, null);
});

test('gatewayDecompose: ok JSON with a valid steps array → the parsed plan (happy arm)', async () => {
  const planJson = '{"title":"P","summary":"S","steps":[{"kind":"agent","instruction":"go"}]}';
  const body = { choices: [{ message: { content: `here you go: ${planJson}` } }] };
  const plan = await withFetch(
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
    () => defaultDeps.modelDecompose('read the invoice', []), // empty domains → "(none declared)" arm
  );
  assert.ok(plan);
  assert.equal(plan!.steps.length, 1);
  assert.equal(plan!.steps[0].kind, 'agent');
});

test('gatewayDecompose: a fetch that throws is caught → null (catch arm)', async () => {
  const plan = await withFetch(
    (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch,
    () => defaultDeps.modelDecompose('read the invoice', [DOM]), // domains present → the list-building arm
  );
  assert.equal(plan, null);
});

// ─── defaultDeps.loadDomains — runs the real org-context assembler over the DB ─────────────────────

test('defaultDeps.loadDomains: returns an array (only connector-bound domains) for a real org', async () => {
  const domains = await defaultDeps.loadDomains('default');
  assert.ok(Array.isArray(domains));
  // Every returned domain MUST carry a connector + resource (the filter arm) — the honesty guarantee.
  for (const d of domains) {
    assert.ok(d.connectorId);
    assert.ok(d.resource);
  }
});
