import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import { type AppRunDeps, buildInRunView, executeStep, type StepResult } from '@/lib/app-run';
import type { PipelineContract } from '@/lib/pipeline-enforcement';

// Contract builder (same as the governance unit tests): a routing leash for 'general' + an optional
// PII-mask overlay, so the SHARED governance rail is exercised through the real executeStep path.
function contractFor(egress: 'local' | 'cloud' | 'block', maskOn = false): PipelineContract {
  const cloudRule = {
    name: 'r', priority: 1, enabled: true, attribute: 'data_class',
    operator: 'eq', value: 'general', action: 'cloud', model: '', fallback: '',
  };
  const routing =
    egress === 'local'
      ? { egressAllowed: true, rules: [] }
      : egress === 'cloud'
        ? { egressAllowed: true, rules: [cloudRule] }
        : { egressAllowed: false, rules: [cloudRule] };
  return {
    pipelineId: 'pl_test', dataAllowlist: [], routing: routing as never,
    orgPolicyDefaults: {}, orgGuardrailDefaults: { requirePiiMasking: { mode: 'default', bool: false } },
    policyOverlay: {}, guardrailOverlay: maskOn ? { requirePiiMasking: { bool: true } } : {},
  } as PipelineContract;
}

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
    async sendWebhook() { return { ok: false, configured: false, reason: 'not configured' }; },
    async sendSlack() { return { ok: false, configured: false, reason: 'not configured' }; },
    async sendWhatsApp() { return { ok: false, configured: false, reason: 'not configured' }; },
  };
  return { ...base, ...over };
}

function outStep(
  sink: 'console' | 'report' | 'email' | 'whatsapp' | 'webhook' | 'slack',
  config?: Record<string, unknown>,
) {
  return { id: 'out', label: 'Deliver', kind: 'output' as const, sink, config };
}

// These tests validate the LIVE execution path of sinks/actions, so opt in to the global
// live-action gate (OFF-by-default). The OFF/intercept behaviour is covered by app-run-controls.test.ts.
process.env.OFFGRID_ALLOW_LIVE_ACTIONS = '1';

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

// ─── outbound ACTION sinks (webhook / slack / whatsapp) — routed through deliverGovernedSink ──────

test('webhook sink dispatches the run outcome + threads runId/orgId/appId, reports delivered', async () => {
  let sent: { config: Record<string, unknown> | undefined; input: { runId: string; orgId: string; appId: string; outcome: string } } | null = null;
  const deps = stubDeps({
    async sendWebhook(config, input) {
      sent = { config, input };
      return { ok: true, configured: true, reason: 'delivered to webhook (200)' };
    },
  });
  const res = await executeStep(spec(), outStep('webhook', { url: 'https://hooks.corp/in' }), PRIOR, CTX, deps);
  assert.equal(res.status, 'done');
  assert.equal(sent!.input.outcome, 'The answer is 42.');
  assert.equal(sent!.input.runId, 'apprun_test1');
  assert.equal(sent!.input.appId, 'app_sink');
  assert.equal((sent!.config as { url: string }).url, 'https://hooks.corp/in');
  assert.match(res.detail!, /sink: webhook — delivered/);
});

test('webhook sink — NOT CONFIGURED reports honestly (no fake success), run stays done', async () => {
  const res = await executeStep(spec(), outStep('webhook', { url: 'https://hooks.corp/in' }), PRIOR, CTX, stubDeps());
  assert.equal(res.status, 'done');
  assert.match(res.detail!, /NOT CONFIGURED/);
  assert.match(res.detail!, /not sent/);
});

test('webhook sink — a genuine send failure (configured but failed) errors the step', async () => {
  const deps = stubDeps({
    async sendWebhook() { return { ok: false, configured: true, reason: 'webhook POST failed (503)' }; },
  });
  const res = await executeStep(spec(), outStep('webhook', { url: 'https://hooks.corp/in' }), PRIOR, CTX, deps);
  assert.equal(res.status, 'error');
  assert.match(res.detail!, /webhook sink failed: webhook POST failed \(503\)/);
});

test('slack sink passes the outcome + channel override through, reports posted', async () => {
  let sent: { text: string; channel?: string } | null = null;
  const deps = stubDeps({
    async sendSlack(input) { sent = input; return { ok: true, configured: true, reason: 'posted to Slack' }; },
  });
  const res = await executeStep(spec(), outStep('slack', { channel: '#ops' }), PRIOR, CTX, deps);
  assert.equal(res.status, 'done');
  assert.equal(sent!.text, 'The answer is 42.');
  assert.equal(sent!.channel, '#ops');
  assert.match(res.detail!, /sink: slack — posted to Slack/);
});

test('whatsapp sink now DELIVERS through the on-prem gateway dep (no longer "not wired")', async () => {
  let sent: { to: string; text: string } | null = null;
  const deps = stubDeps({
    async sendWhatsApp(input) { sent = input; return { ok: true, configured: true, reason: 'sent via on-prem WhatsApp gateway (200)' }; },
  });
  const res = await executeStep(spec(), outStep('whatsapp', { to: '+919999' }), PRIOR, CTX, deps);
  assert.equal(res.status, 'done');
  assert.equal(sent!.to, '+919999');
  assert.equal(sent!.text, 'The answer is 42.');
  assert.match(res.detail!, /sink: whatsapp — sent via on-prem WhatsApp gateway/);
  assert.doesNotMatch(res.detail!, /not wired/);
});

test('whatsapp sink — unconfigured gateway degrades honestly (not a fake send)', async () => {
  const res = await executeStep(spec(), outStep('whatsapp', { to: '+919999' }), PRIOR, CTX, stubDeps());
  assert.equal(res.status, 'done');
  assert.match(res.detail!, /NOT CONFIGURED/);
});

// ─── governance parity: the shared rail gates the new cloud sinks through the real executeStep ─────

test('webhook (cloud) is EGRESS-BLOCKED when the pipeline is leashed on-prem — never delivers', async () => {
  let called = false;
  const deps = stubDeps({ async sendWebhook() { called = true; return { ok: true, configured: true, reason: 'x' }; } });
  const ctx = { ...CTX, contract: contractFor('block') };
  const res = await executeStep(spec(), outStep('webhook', { url: 'https://hooks.corp/in' }), PRIOR, ctx, deps);
  assert.equal(res.status, 'error');
  assert.match(res.detail!, /blocked by pipeline egress leash/);
  assert.equal(called, false); // the deliver fn is NEVER reached on a block
});

test('slack (cloud) is HELD when masking required but the PII detector throws — never delivers', async () => {
  let called = false;
  const deps = stubDeps({
    async scanPii() { throw new Error('detector down'); },
    async sendSlack() { called = true; return { ok: true, configured: true, reason: 'x' }; },
  });
  const ctx = { ...CTX, contract: contractFor('cloud', true) };
  const res = await executeStep(spec(), outStep('slack', { channel: '#ops' }), PRIOR, ctx, deps);
  assert.equal(res.status, 'error');
  assert.match(res.detail!, /send held/);
  assert.equal(called, false);
});

test('webhook (cloud) masks the outcome BEFORE it is handed to the deliver fn when required', async () => {
  let deliveredBody = '';
  const deps = stubDeps({
    async scanPii() { return { hits: true, redacted: '[REDACTED]', entities: ['pan'], engine: 'regex' }; },
    async sendWebhook(_c, input) { deliveredBody = input.outcome; return { ok: true, configured: true, reason: 'ok (200)' }; },
  });
  const ctx = { ...CTX, contract: contractFor('cloud', true) };
  const res = await executeStep(spec(), outStep('webhook', { url: 'https://hooks.corp/in' }), PRIOR, ctx, deps);
  assert.equal(res.status, 'done');
  assert.equal(deliveredBody, '[REDACTED]'); // the raw outcome NEVER reaches the wire unmasked
  assert.match(res.detail!, /PII masked before send/);
});

test('whatsapp (air-gapped) still DELIVERS even under a block leash (no cloud egress to leash)', async () => {
  let called = false;
  const deps = stubDeps({
    async sendWhatsApp() { called = true; return { ok: true, configured: true, reason: 'sent (200)' }; },
  });
  const ctx = { ...CTX, contract: contractFor('block') };
  const res = await executeStep(spec(), outStep('whatsapp', { to: '+919999' }), PRIOR, ctx, deps);
  assert.equal(res.status, 'done');
  assert.equal(called, true);
});
