import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import { type AppRunDeps, buildInRunView, executeStep, type StepResult } from '@/lib/app-run';

// A minimal spec whose only step we exercise is the output sink; prior results are injected directly.
function spec(): AppSpec {
  return {
    id: 'app_sink', orgId: 'default', ownerId: 'u1', title: 'Weekly report', summary: '',
    visibility: 'private', published: true, trigger: { kind: 'on-demand' },
    steps: [{ id: 'out', label: 'Deliver', kind: 'output', sink: 'console' }], edges: [],
  };
}

const CTX = { orgId: 'default', actor: 'tester', runId: 'apprun_test1' };

const PRIOR: StepResult[] = [
  { stepId: 's1', kind: 'agent', status: 'done', output: 'The answer is 42.' },
];

// A deps stub that RECORDS what the sinks called, so we prove the wiring without real I/O.
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
        contentType: format === 'md' ? 'text/markdown' : 'application/pdf',
        bytes: new TextEncoder().encode(`report-bytes:${view.id}`),
        manifest: { algorithm: 'ed25519', sha256: 'b'.repeat(64), signature: 'sig-xyz' },
      };
    },
    async sendEmail() { return { ok: false, configured: false, reason: 'not configured' }; },
  };
  return { ...base, ...over };
}

function outStep(sink: 'console' | 'report' | 'email' | 'whatsapp', config?: Record<string, unknown>) {
  return { id: 'out', label: 'Deliver', kind: 'output' as const, sink, config };
}

test('buildInRunView projects prior StepResults into an AppRunView the report renderer consumes', () => {
  const view = buildInRunView(spec(), PRIOR, CTX, { q: 'hi' });
  assert.equal(view.id, 'apprun_test1');
  assert.equal(view.appId, 'app_sink');
  assert.equal(view.steps.length, 1);
  assert.equal(view.steps[0].outcome, 'The answer is 42.');
  assert.equal(view.outcome, 'The answer is 42.');
});

test('report sink renders + attaches the signed artifact to the step', async () => {
  let rendered: { format: string; runId: string } | null = null;
  const deps = stubDeps({
    async renderReport(view, format) {
      rendered = { format, runId: view.id };
      return {
        filename: `offgrid-app-run-${view.id}.${format}`,
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('pdf'),
        manifest: { algorithm: 'ed25519', sha256: 'c'.repeat(64), signature: 's' },
      };
    },
  });
  const res = await executeStep(spec(), outStep('report'), PRIOR, CTX, deps);
  assert.equal(res.status, 'done');
  assert.equal(rendered!.format, 'pdf');
  assert.equal(rendered!.runId, 'apprun_test1');
  // The signed provenance is captured in the detail + the download link is a ref (the durable artifact).
  assert.match(res.detail!, /signed ed25519 sha256=cccccccccccc/);
  assert.ok(res.refs!.some((r) => r.name.includes('/report?format=pdf')));
  assert.ok(res.refs!.some((r) => r.name.endsWith('.pdf')));
  // The run's outcome is still available through the step.
  assert.equal(res.output, 'The answer is 42.');
});

test('report sink honours config.format=md', async () => {
  let fmt = '';
  const deps = stubDeps({
    async renderReport(view, format) {
      fmt = format;
      return { filename: `x.${format}`, contentType: 'text/markdown', bytes: new Uint8Array(), manifest: { algorithm: 'ed25519', sha256: 'd'.repeat(64), signature: 's' } };
    },
  });
  await executeStep(spec(), outStep('report', { format: 'md' }), PRIOR, CTX, deps);
  assert.equal(fmt, 'md');
});

test('email sink — NOT CONFIGURED reports honestly (no fake success), run stays done', async () => {
  const deps = stubDeps({
    async sendEmail() { return { ok: false, configured: false, reason: 'SMTP not set' }; },
  });
  const res = await executeStep(spec(), outStep('email', { to: 'ops@corp' }), PRIOR, CTX, deps);
  assert.equal(res.status, 'done'); // the run outcome is available — delivery simply isn't set up
  assert.match(res.detail!, /NOT CONFIGURED/);
  assert.match(res.detail!, /not sent/);
});

test('email sink — configured send passes the outcome + recipient through and reports sent', async () => {
  let sent: { to: string; subject: string; text: string; hasAttachment: boolean } | null = null;
  const deps = stubDeps({
    async sendEmail(msg) {
      sent = { to: msg.to, subject: msg.subject, text: msg.text, hasAttachment: (msg.attachments ?? []).length > 0 };
      return { ok: true, configured: true, reason: `sent to ${msg.to}` };
    },
  });
  const res = await executeStep(spec(), outStep('email', { to: 'ceo@corp', subject: 'Digest' }), PRIOR, CTX, deps);
  assert.equal(res.status, 'done');
  assert.equal(sent!.to, 'ceo@corp');
  assert.equal(sent!.subject, 'Digest');
  assert.equal(sent!.text, 'The answer is 42.');
  assert.equal(sent!.hasAttachment, false);
  assert.match(res.detail!, /sent to ceo@corp/);
});

test('email sink — attachReport:true attaches the rendered report PDF', async () => {
  let attachmentCount = 0;
  const deps = stubDeps({
    async sendEmail(msg) {
      attachmentCount = (msg.attachments ?? []).length;
      return { ok: true, configured: true, reason: 'sent' };
    },
  });
  await executeStep(spec(), outStep('email', { to: 'a@b', attachReport: true }), PRIOR, CTX, deps);
  assert.equal(attachmentCount, 1);
});

test('email sink — a genuine SMTP failure (configured but send failed) errors the step', async () => {
  const deps = stubDeps({
    async sendEmail() { return { ok: false, configured: true, reason: 'connection refused' }; },
  });
  const res = await executeStep(spec(), outStep('email', { to: 'a@b' }), PRIOR, CTX, deps);
  assert.equal(res.status, 'error');
  assert.match(res.detail!, /email sink \(smtp\) failed: connection refused/);
});

test('console sink is unchanged — records the outcome, no external delivery', async () => {
  const res = await executeStep(spec(), outStep('console'), PRIOR, CTX, stubDeps());
  assert.equal(res.status, 'done');
  assert.equal(res.output, 'The answer is 42.');
  assert.equal(res.detail, 'sink: console');
});
