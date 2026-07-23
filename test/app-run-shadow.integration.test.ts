import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import { type AppRunDeps, executeStep, runApp, type StepResult } from '@/lib/app-run';

// ─── Shadow-mode interception — REAL executor, stubbed boundaries ──────────────────────────────────
// Proves: in SHADOW mode a side-effecting sink (email/report) NO-OPs and records `wouldPerform`; in
// LIVE mode the SAME sink actually calls the boundary. Read/reason steps run identically in both.
// Only the two external boundaries (renderReport/sendEmail here) are stubbed, so the real executeStep
// dispatch + the pure shadow-intercept decision are exercised end-to-end.

const PRIOR: StepResult[] = [
  { stepId: 'read', kind: 'connector-query', status: 'done', output: 'KYC row: PAN masked; risk HIGH.' },
];

function spec(): AppSpec {
  return {
    id: 'app_shadow', orgId: 'default', ownerId: 'u1', title: 'KYC alert', summary: '',
    visibility: 'private', published: true, trigger: { kind: 'on-demand' },
    steps: [{ id: 'out', label: 'Notify ops', kind: 'output', sink: 'email', config: { to: 'ops@bank.in', subject: 'KYC HIGH' } }],
    edges: [],
  };
}

function stubDeps(over: Partial<AppRunDeps> = {}): AppRunDeps {
  const base: AppRunDeps = {
    async runAgent() { return null; },
    async listDomains() { return []; },
    async getConnector() { return null; },
    async queryDomain() { return { result: null, detail: '' }; },
    async runGuardrail() { return { blocked: false, detail: 'ok' }; },
    async scanPii() { return { hits: false, entities: [], engine: 'regex' }; },
    async persist() {},
    async materializeAgent(_s, step) { return step.id; },
    async renderReport(view, format) {
      return {
        filename: `offgrid-app-run-${view.id}.${format}`,
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('pdf'),
        manifest: { algorithm: 'ed25519', sha256: 'a'.repeat(64), signature: 's' },
      };
    },
    async sendEmail() { return { ok: true, configured: true, reason: 'sent' }; },
  };
  return { ...base, ...over };
}

const emailStep = () =>
  ({ id: 'out', label: 'Notify ops', kind: 'output' as const, sink: 'email' as const, config: { to: 'ops@bank.in', subject: 'KYC HIGH' } });

// Default the global live-action gate ON for the LIVE assertions in this file (a real send happens
// only with the opt-in). Shadow assertions intercept regardless. The OFF-by-default gate is proven
// by the dedicated test at the end of this file + app-run-controls.test.ts.
process.env.OFFGRID_ALLOW_LIVE_ACTIONS = '1';

test('SHADOW: an email sink NO-OPs and records wouldPerform (never calls sendEmail)', async () => {
  let sent = false;
  const deps = stubDeps({ async sendEmail() { sent = true; return { ok: true, configured: true, reason: 'sent' }; } });
  const res = await executeStep(spec(), emailStep(), PRIOR, { orgId: 'default', runId: 'r1', mode: 'shadow' }, deps);
  assert.equal(sent, false, 'sendEmail must NOT be called in shadow');
  assert.equal(res.status, 'done');
  assert.ok(res.wouldPerform, 'wouldPerform recorded');
  assert.equal(res.wouldPerform!.sink, 'email');
  assert.equal(res.wouldPerform!.recipient, 'ops@bank.in');
  assert.equal(res.wouldPerform!.subject, 'KYC HIGH');
  assert.match(res.detail!, /^SHADOW: would email/);
  assert.equal(res.output, 'KYC row: PAN masked; risk HIGH.'); // the real outcome still flows through
});

test('LIVE: the SAME email sink actually calls sendEmail (no interception)', async () => {
  let sent = false;
  const deps = stubDeps({ async sendEmail() { sent = true; return { ok: true, configured: true, reason: 'sent' }; } });
  const res = await executeStep(spec(), emailStep(), PRIOR, { orgId: 'default', runId: 'r2', mode: 'live' }, deps);
  assert.equal(sent, true, 'sendEmail MUST be called in live');
  assert.equal(res.status, 'done');
  assert.equal(res.wouldPerform, undefined);
  assert.match(res.detail!, /sink: email/);
});

test('SHADOW: default mode (absent ctx.mode) is LIVE — sink acts', async () => {
  let sent = false;
  const deps = stubDeps({ async sendEmail() { sent = true; return { ok: true, configured: true, reason: 'sent' }; } });
  await executeStep(spec(), emailStep(), PRIOR, { orgId: 'default', runId: 'r3' }, deps);
  assert.equal(sent, true, 'absent mode defaults to live');
});

test('SHADOW: a report sink is intercepted (never renders), console sink is NOT', async () => {
  let rendered = false;
  const deps = stubDeps({
    async renderReport(view, format) {
      rendered = true;
      return { filename: `x.${format}`, contentType: 'application/pdf', bytes: new Uint8Array(), manifest: { algorithm: 'ed25519', sha256: 'a'.repeat(64), signature: 's' } };
    },
  });
  const reportStep = { id: 'out', label: 'Report', kind: 'output' as const, sink: 'report' as const };
  const r = await executeStep(spec(), reportStep, PRIOR, { orgId: 'default', runId: 'r4', mode: 'shadow' }, deps);
  assert.equal(rendered, false, 'report render is a side effect — intercepted in shadow');
  assert.ok(r.wouldPerform);

  // console sink is pure record-keeping — NOT intercepted even in shadow.
  const consoleStep = { id: 'out', label: 'Log', kind: 'output' as const, sink: 'console' as const };
  const c = await executeStep(spec(), consoleStep, PRIOR, { orgId: 'default', runId: 'r5', mode: 'shadow' }, deps);
  assert.equal(c.wouldPerform, undefined);
  assert.match(c.detail!, /sink: console/);
});

test('SHADOW: runApp over a full spec threads mode + persists wouldPerform on the step state', async () => {
  let sent = false;
  const persisted: unknown[] = [];
  const deps = stubDeps({
    async sendEmail() { sent = true; return { ok: true, configured: true, reason: 'sent' }; },
    async persist(state) { persisted.push(JSON.parse(JSON.stringify(state))); },
  });
  const outcome = await runApp(spec(), {}, { orgId: 'default', runId: 'r6', mode: 'shadow' }, deps);
  assert.equal(sent, false);
  assert.equal(outcome.status, 'done');
  const outStep = outcome.steps.find((s) => s.stepId === 'out')!;
  assert.ok(outStep.wouldPerform, 'runApp carries wouldPerform on the StepResult');
  // The final persisted state carries wouldPerform on the step, so screens 3/4 can render it.
  const last = persisted[persisted.length - 1] as { steps: { id: string; wouldPerform?: unknown }[] };
  const step = last.steps.find((s) => s.id === 'out');
  assert.ok(step?.wouldPerform, 'persisted step state carries wouldPerform');
});

// ─── GLOBAL live-action gate at the integration layer ──────────────────────────────────────────────
// Even a LIVE run must NOT act on the world unless the operator explicitly opted in. With the global
// flag OFF, a live-mode side-effecting step is intercepted (records wouldPerform, never calls the wire).
test('GLOBAL GATE: a LIVE run is intercepted when OFFGRID_ALLOW_LIVE_ACTIONS is OFF (no side effect)', async () => {
  const prev = process.env.OFFGRID_ALLOW_LIVE_ACTIONS;
  process.env.OFFGRID_ALLOW_LIVE_ACTIONS = '';
  try {
    let sent = false;
    const deps = stubDeps({
      async sendEmail() {
        sent = true;
        return { ok: true, configured: true, reason: 'sent' };
      },
    });
    const res = await executeStep(
      spec(),
      emailStep(),
      PRIOR,
      { orgId: 'default', runId: 'rgate', mode: 'live' },
      deps,
    );
    assert.equal(sent, false, 'a live run must NOT act when live-actions are globally disabled');
    assert.ok(res.wouldPerform, 'records wouldPerform instead of sending');
  } finally {
    if (prev === undefined) delete process.env.OFFGRID_ALLOW_LIVE_ACTIONS;
    else process.env.OFFGRID_ALLOW_LIVE_ACTIONS = prev;
  }
});
