import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  DEFAULT_EGRESS_DLP_POLICY,
  type EgressDlpPolicy,
  type EgressScan,
  egressDlpRunDemand,
  egressMaskingRequired,
  enforceEgressDlp,
  normalizeEgressPolicy,
} from '../src/lib/egress-dlp.ts';
import {
  EGRESS_DLP_ACTION,
  EGRESS_DLP_POLICY_ACTION,
  egressDlpAuditEvent,
  egressDlpAuditable,
  egressDlpOutcome,
  egressDlpPolicyAuditEvent,
} from '../src/lib/egress-dlp-audit.ts';
import {
  collectTextUnits,
  egressScanFromPii,
  type EgressMessage,
  mergeEgressScans,
  sanitizeOutboundMessages,
} from '../src/lib/egress-dlp-run.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The egress-DLP capability: the LAST governed gate before a request leaves the box to a CLOUD
// provider. The rule: on-prem passes through byte-identical; a cloud route with DLP on masks (or
// blocks) sensitive content BEFORE it egresses; a guardrail that can't screen FAILS CLOSED (block).
// These lock the pure decision + audit builders + the PiiResult→EgressScan mapping. The I/O seam
// (sanitizeOutboundMessages) is exercised against the REAL guardrail adapter with a fake only at the
// HTTP boundary (global fetch) — never a mock of our own code.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const ENABLED_MASK: EgressDlpPolicy = { enabled: true, strictness: 'mask' };
const ENABLED_BLOCK: EgressDlpPolicy = { enabled: true, strictness: 'block' };
const DISABLED: EgressDlpPolicy = { enabled: false, strictness: 'mask' };

const CLEAN: EgressScan = {
  configured: true,
  reachable: true,
  hits: false,
  entities: [],
  sanitized: 'the original text',
};
const HIT: EgressScan = {
  configured: true,
  reachable: true,
  hits: true,
  entities: ['EMAIL_ADDRESS', 'IN_PAN'],
  sanitized: 'contact me at [REDACTED]',
};

// ── enforceEgressDlp — every branch ─────────────────────────────────────────────────────────────

test('on-prem route is byte-identical passthrough — never screened, never masked', () => {
  const d = enforceEgressDlp('on-prem', 'raw PAN ABCDE1234F', ENABLED_MASK, null);
  assert.equal(d.action, 'passthrough');
  assert.equal(d.content, 'raw PAN ABCDE1234F');
  assert.equal(d.maskingRequired, false);
  assert.equal(d.screened, false);
  assert.equal(d.unprotected, false);
});

test('cloud + DLP disabled → passthrough, flagged UNPROTECTED (content leaves unmasked)', () => {
  const d = enforceEgressDlp('cloud', 'raw secret', DISABLED, null);
  assert.equal(d.action, 'passthrough');
  assert.equal(d.content, 'raw secret');
  assert.equal(d.unprotected, true);
  assert.equal(d.maskingRequired, false);
});

test('cloud + enabled + scan NULL → BLOCKED (fail-closed: guardrail not consulted)', () => {
  const d = enforceEgressDlp('cloud', 'raw', ENABLED_MASK, null);
  assert.equal(d.action, 'blocked');
  assert.equal(d.content, '');
  assert.equal(d.maskingRequired, true);
  assert.equal(d.screened, false);
  assert.match(d.reason, /not consulted/);
});

test('cloud + enabled + guardrail NOT configured → BLOCKED (fail-closed)', () => {
  const scan: EgressScan = { ...CLEAN, configured: false, reachable: false };
  const d = enforceEgressDlp('cloud', 'raw', ENABLED_MASK, scan);
  assert.equal(d.action, 'blocked');
  assert.match(d.reason, /not configured/);
});

test('cloud + enabled + guardrail UNREACHABLE → BLOCKED (fail-closed)', () => {
  const scan: EgressScan = { ...CLEAN, configured: true, reachable: false };
  const d = enforceEgressDlp('cloud', 'raw', ENABLED_MASK, scan);
  assert.equal(d.action, 'blocked');
  assert.match(d.reason, /unreachable/);
});

test('cloud + strictness BLOCK + PII detected → BLOCKED (refuse egress, even masked)', () => {
  const d = enforceEgressDlp('cloud', 'raw', ENABLED_BLOCK, HIT);
  assert.equal(d.action, 'blocked');
  assert.equal(d.content, '');
  assert.equal(d.screened, true);
  assert.deepEqual(d.masked, ['EMAIL_ADDRESS', 'IN_PAN']);
  assert.match(d.reason, /EMAIL_ADDRESS, IN_PAN/);
});

test('cloud + strictness MASK + PII detected → MASKED, sanitized content egresses', () => {
  const d = enforceEgressDlp('cloud', 'contact me at jane@acme.com', ENABLED_MASK, HIT);
  assert.equal(d.action, 'masked');
  assert.equal(d.content, 'contact me at [REDACTED]');
  assert.equal(d.screened, true);
  assert.deepEqual(d.masked, ['EMAIL_ADDRESS', 'IN_PAN']);
});

test('cloud + enabled + screened CLEAN → passthrough (screened, nothing masked)', () => {
  const d = enforceEgressDlp('cloud', 'the original text', ENABLED_MASK, CLEAN);
  assert.equal(d.action, 'passthrough');
  assert.equal(d.content, 'the original text');
  assert.equal(d.screened, true);
  assert.equal(d.maskingRequired, true);
  assert.deepEqual(d.masked, []);
});

test('cloud + strictness BLOCK + CLEAN → passthrough (block only fires on a hit)', () => {
  const d = enforceEgressDlp('cloud', 'the original text', ENABLED_BLOCK, CLEAN);
  assert.equal(d.action, 'passthrough');
  assert.equal(d.screened, true);
});

test('describeEntities: block with no entity names still reads legibly', () => {
  const scan: EgressScan = { ...HIT, entities: [] };
  const d = enforceEgressDlp('cloud', 'raw', ENABLED_BLOCK, scan);
  assert.equal(d.action, 'blocked');
  assert.match(d.reason, /sensitive content/);
});

// ── normalizeEgressPolicy ────────────────────────────────────────────────────────────────────────

test('normalizeEgressPolicy: absent/garbage → secure DEFAULT (enabled, mask)', () => {
  assert.deepEqual(normalizeEgressPolicy(null), DEFAULT_EGRESS_DLP_POLICY);
  assert.deepEqual(normalizeEgressPolicy(undefined), DEFAULT_EGRESS_DLP_POLICY);
  assert.deepEqual(normalizeEgressPolicy('nope'), DEFAULT_EGRESS_DLP_POLICY);
  assert.deepEqual(normalizeEgressPolicy(42), DEFAULT_EGRESS_DLP_POLICY);
});

test('normalizeEgressPolicy: only explicit false disables; block strictness honored', () => {
  assert.deepEqual(normalizeEgressPolicy({ enabled: false }), { enabled: false, strictness: 'mask' });
  assert.deepEqual(normalizeEgressPolicy({ strictness: 'block' }), { enabled: true, strictness: 'block' });
  assert.deepEqual(normalizeEgressPolicy({ enabled: true, strictness: 'weird' }), {
    enabled: true,
    strictness: 'mask',
  });
  // A truthy non-boolean enabled defaults ON (only an explicit false turns it off).
  assert.deepEqual(normalizeEgressPolicy({ enabled: 'yes' }), { enabled: true, strictness: 'mask' });
});

test('egressMaskingRequired: only a cloud route with DLP on requires masking', () => {
  assert.equal(egressMaskingRequired('cloud', ENABLED_MASK), true);
  assert.equal(egressMaskingRequired('cloud', DISABLED), false);
  assert.equal(egressMaskingRequired('on-prem', ENABLED_MASK), false);
});

// ── egressDlpRunDemand: the governed-run (app/agent) demand from the per-org policy ──────────────

test('egressDlpRunDemand: a cloud-permitted run under mask policy demands masking, not block', () => {
  const d = egressDlpRunDemand('cloud', ENABLED_MASK);
  assert.equal(d.maskFloor, true);
  assert.equal(d.blockOnPii, false);
});

test('egressDlpRunDemand: a cloud-permitted run under BLOCK policy demands mask floor AND block', () => {
  const d = egressDlpRunDemand('cloud', ENABLED_BLOCK);
  assert.equal(d.maskFloor, true);
  assert.equal(d.blockOnPii, true);
});

test('egressDlpRunDemand: a cloud-permitted run with DLP DISABLED demands nothing', () => {
  const d = egressDlpRunDemand('cloud', DISABLED);
  assert.deepEqual(d, { maskFloor: false, blockOnPii: false });
});

test('egressDlpRunDemand: a LOCAL run never egresses ⇒ demands nothing, even under block policy', () => {
  assert.deepEqual(egressDlpRunDemand('local', ENABLED_BLOCK), {
    maskFloor: false,
    blockOnPii: false,
  });
});

test('egressDlpRunDemand: a BLOCKED-egress run (refused upstream) demands nothing here', () => {
  assert.deepEqual(egressDlpRunDemand('block', ENABLED_BLOCK), {
    maskFloor: false,
    blockOnPii: false,
  });
});

// ── audit builders ─────────────────────────────────────────────────────────────────────────────

const ACTOR = { type: 'user' as const, id: 'ops@acme.com', label: 'Ops' };
const CTX = { actor: ACTOR, org: 'acme', project: null, runId: 'chatrun_1', model: 'openai:gpt-4o' };

test('egressDlpOutcome maps action → audit outcome', () => {
  const mk = (action: string) => ({ action } as never);
  assert.equal(egressDlpOutcome(mk('blocked')), 'blocked');
  assert.equal(egressDlpOutcome(mk('masked')), 'redacted');
  assert.equal(egressDlpOutcome(mk('passthrough')), 'ok');
});

test('egressDlpAuditEvent: masked event carries entity types + provider model, never content', () => {
  const d = enforceEgressDlp('cloud', 'contact me at x', ENABLED_MASK, HIT);
  const ev = egressDlpAuditEvent(CTX, d);
  assert.equal(ev.action, EGRESS_DLP_ACTION);
  assert.equal(ev.outcome, 'redacted');
  assert.equal(ev.resource, 'egress-dlp:masked:EMAIL_ADDRESS+IN_PAN');
  assert.equal(ev.model, 'openai:gpt-4o');
  assert.equal(ev.runId, 'chatrun_1');
  // The raw content must NEVER appear in the audit record.
  assert.ok(!JSON.stringify(ev).includes('contact me at'));
});

test('egressDlpAuditEvent: unprotected + blocked resources are distinct', () => {
  const unprotected = enforceEgressDlp('cloud', 'raw', DISABLED, null);
  assert.equal(egressDlpAuditEvent(CTX, unprotected).resource, 'egress-dlp:unprotected');
  const blocked = enforceEgressDlp('cloud', 'raw', ENABLED_MASK, null);
  assert.equal(egressDlpAuditEvent(CTX, blocked).resource, 'egress-dlp:blocked:none');
});

test('egressDlpAuditEvent: missing ctx model/runId default to null', () => {
  const d = enforceEgressDlp('cloud', 'x', ENABLED_MASK, HIT);
  const ev = egressDlpAuditEvent({ actor: ACTOR, org: 'acme' }, d);
  assert.equal(ev.model, null);
  assert.equal(ev.runId, null);
  assert.equal(ev.project, null);
});

test('egressDlpAuditable: masked/blocked/unprotected audited; clean passthrough not', () => {
  assert.equal(egressDlpAuditable(enforceEgressDlp('cloud', 'x', ENABLED_MASK, HIT)), true);
  assert.equal(egressDlpAuditable(enforceEgressDlp('cloud', 'x', ENABLED_MASK, null)), true);
  assert.equal(egressDlpAuditable(enforceEgressDlp('cloud', 'x', DISABLED, null)), true);
  assert.equal(egressDlpAuditable(enforceEgressDlp('cloud', 'x', ENABLED_MASK, CLEAN)), false);
  assert.equal(egressDlpAuditable(enforceEgressDlp('on-prem', 'x', ENABLED_MASK, null)), false);
});

test('egressDlpPolicyAuditEvent: records before→after transition', () => {
  const ev = egressDlpPolicyAuditEvent(
    { actor: ACTOR, org: 'acme' },
    { enabled: true, strictness: 'mask' },
    { enabled: false, strictness: 'block' },
  );
  assert.equal(ev.action, EGRESS_DLP_POLICY_ACTION);
  assert.equal(ev.outcome, 'ok');
  assert.equal(ev.resource, 'egress-dlp:off:block (was on:mask)');
  // The inverse transition covers the other arm of each on/off ternary.
  const ev2 = egressDlpPolicyAuditEvent(
    { actor: ACTOR, org: 'acme' },
    { enabled: false, strictness: 'block' },
    { enabled: true, strictness: 'mask' },
  );
  assert.equal(ev2.resource, 'egress-dlp:on:mask (was off:block)');
});

// ── PiiResult → EgressScan mapping ───────────────────────────────────────────────────────────────

test('egressScanFromPii: configured+reachable clean verdict', () => {
  const s = egressScanFromPii(
    { hits: false, entities: [], redacted: 'clean', engine: 'llm-guard', configured: true },
    'clean',
  );
  assert.deepEqual(s, { configured: true, reachable: true, hits: false, entities: [], sanitized: 'clean' });
});

test('egressScanFromPii: blocked (configured but unreachable) → reachable false', () => {
  const s = egressScanFromPii(
    { hits: true, entities: ['GUARDRAIL_UNAVAILABLE'], engine: 'llm-guard', configured: true, blocked: true },
    'raw',
  );
  assert.equal(s.configured, true);
  assert.equal(s.reachable, false);
  assert.equal(s.sanitized, 'raw'); // no redacted → falls back to original
});

test('egressScanFromPii: not configured → configured+reachable false; non-array entities → []', () => {
  const s = egressScanFromPii(
    { hits: false, entities: undefined as never, engine: 'llm-guard', configured: false },
    'orig',
  );
  assert.equal(s.configured, false);
  assert.equal(s.reachable, false);
  assert.deepEqual(s.entities, []);
});

// ── aggregate reducer ────────────────────────────────────────────────────────────────────────────

test('mergeEgressScans: empty set is a clean, screened aggregate', () => {
  assert.deepEqual(mergeEgressScans([]), {
    configured: true,
    reachable: true,
    hits: false,
    entities: [],
    sanitized: '',
  });
});

test('mergeEgressScans: weakest-unit wins (any unconfigured/unreachable/hit propagates; entities union)', () => {
  const a: EgressScan = { configured: true, reachable: true, hits: false, entities: ['A'], sanitized: '' };
  const b: EgressScan = { configured: true, reachable: false, hits: true, entities: ['B', 'A'], sanitized: '' };
  const merged = mergeEgressScans([a, b]);
  assert.equal(merged.configured, true);
  assert.equal(merged.reachable, false);
  assert.equal(merged.hits, true);
  assert.deepEqual([...merged.entities].sort(), ['A', 'B']);
});

test('mergeEgressScans: an unconfigured unit taints the whole payload', () => {
  const a: EgressScan = { configured: true, reachable: true, hits: false, entities: [], sanitized: '' };
  const b: EgressScan = { configured: false, reachable: false, hits: false, entities: [], sanitized: '' };
  assert.equal(mergeEgressScans([a, b]).configured, false);
});

// ── text-unit collection ─────────────────────────────────────────────────────────────────────────

test('collectTextUnits: string content, array text-parts, skipping empties + non-text', () => {
  const messages: EgressMessage[] = [
    { role: 'system', content: 'sys prompt' },
    { role: 'user', content: '' }, // empty skipped
    {
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'data:...' } }, // non-text skipped
        { type: 'text', text: '' }, // empty text part skipped
      ],
    },
  ];
  const units = collectTextUnits(messages);
  assert.equal(units.length, 2);
  assert.deepEqual(units[0], { msgIdx: 0, partIdx: null, text: 'sys prompt' });
  assert.deepEqual(units[1], { msgIdx: 2, partIdx: 0, text: 'hello' });
});

// ── sanitizeOutboundMessages — REAL guardrail adapter, fake ONLY at the HTTP boundary ──────────────

const ORIG_URL = process.env.OFFGRID_HTTP_GUARDRAIL_URL;
const ORIG_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIG_URL === undefined) delete process.env.OFFGRID_HTTP_GUARDRAIL_URL;
  else process.env.OFFGRID_HTTP_GUARDRAIL_URL = ORIG_URL;
  globalThis.fetch = ORIG_FETCH;
});

// Drive the REAL llmGuardPii adapter by faking the llm-guard HTTP response (a boundary fake).
function fakeGuard(body: Record<string, unknown>): void {
  process.env.OFFGRID_HTTP_GUARDRAIL_URL = 'http://llm-guard.test:8000';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

test('sanitizeOutboundMessages: no outbound text → screened passthrough without a network call', async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;
  const messages: EgressMessage[] = [{ role: 'user', content: '' }];
  const res = await sanitizeOutboundMessages(messages, ENABLED_MASK, 'acme');
  assert.equal(res.blocked, false);
  assert.equal(res.decision.action, 'passthrough');
  assert.equal(called, false);
});

test('sanitizeOutboundMessages: guardrail NOT configured → BLOCKED (fail-closed, real adapter)', async () => {
  delete process.env.OFFGRID_HTTP_GUARDRAIL_URL; // llmGuardPii → guardrailNotConfigured()
  const messages: EgressMessage[] = [{ role: 'user', content: 'my PAN is ABCDE1234F' }];
  const res = await sanitizeOutboundMessages(messages, ENABLED_MASK, 'acme');
  assert.equal(res.blocked, true);
  assert.equal(res.decision.action, 'blocked');
  assert.equal(res.messages, messages); // original returned untouched
});

test('sanitizeOutboundMessages: PII detected + mask → outbound payload IS sanitized (terminal artifact)', async () => {
  fakeGuard({ is_valid: false, scanners: { Anonymize: 0.9 }, sanitized_prompt: 'contact me at [EMAIL]' });
  const messages: EgressMessage[] = [
    { role: 'system', content: 'be helpful' },
    { role: 'user', content: 'contact me at jane@acme.com' },
  ];
  const res = await sanitizeOutboundMessages(messages, ENABLED_MASK, 'acme');
  assert.equal(res.blocked, false);
  assert.equal(res.decision.action, 'masked');
  // The raw email must NOT be in what egresses; every text unit is replaced by the sanitized value.
  assert.equal(res.messages[1].content, 'contact me at [EMAIL]');
  assert.ok(!JSON.stringify(res.messages).includes('jane@acme.com'));
  // The original array is not mutated (a fresh payload is built).
  assert.equal(messages[1].content, 'contact me at jane@acme.com');
});

test('sanitizeOutboundMessages: array content (image turn) masks the text part in place', async () => {
  fakeGuard({ is_valid: false, scanners: { Anonymize: 0.9 }, sanitized_prompt: '[MASKED]' });
  const messages: EgressMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'my card 4111 1111 1111 1111' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    },
  ];
  const res = await sanitizeOutboundMessages(messages, ENABLED_MASK, 'acme');
  assert.equal(res.decision.action, 'masked');
  const part = (res.messages[0].content as { type: string; text?: string }[])[0];
  assert.equal(part.text, '[MASKED]');
  // The image part is preserved untouched.
  assert.equal((res.messages[0].content as { type: string }[])[1].type, 'image_url');
});

test('sanitizeOutboundMessages: clean screen → passthrough, content unchanged', async () => {
  fakeGuard({ is_valid: true, scanners: { Anonymize: 0.0 }, sanitized_prompt: 'hello there' });
  const messages: EgressMessage[] = [{ role: 'user', content: 'hello there' }];
  const res = await sanitizeOutboundMessages(messages, ENABLED_MASK, 'acme');
  assert.equal(res.blocked, false);
  assert.equal(res.decision.action, 'passthrough');
  assert.equal(res.messages[0].content, 'hello there');
});

test('sanitizeOutboundMessages: strictness BLOCK + PII → refused (blocked, original kept)', async () => {
  fakeGuard({ is_valid: false, scanners: { Anonymize: 0.9 }, sanitized_prompt: '[EMAIL]' });
  const messages: EgressMessage[] = [{ role: 'user', content: 'email jane@acme.com' }];
  const res = await sanitizeOutboundMessages(messages, ENABLED_BLOCK, 'acme');
  assert.equal(res.blocked, true);
  assert.equal(res.decision.action, 'blocked');
});

test('sanitizeOutboundMessages: guardrail throws → fail-closed block (unreachable)', async () => {
  process.env.OFFGRID_HTTP_GUARDRAIL_URL = 'http://llm-guard.test:8000';
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  const messages: EgressMessage[] = [{ role: 'user', content: 'my PAN ABCDE1234F' }];
  const res = await sanitizeOutboundMessages(messages, ENABLED_MASK, 'acme');
  assert.equal(res.blocked, true);
  assert.equal(res.decision.action, 'blocked');
});
