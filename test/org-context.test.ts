import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type OrgContext,
  summarizeOrgContext,
} from '@/lib/org-context';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Builder Epic Phase 1C — org-context assembler.
//   • UNIT: summarizeOrgContext is pure (zero-IO). Test counts, names, and the NO-SECRET guarantee
//     against a hand-built OrgContext fixture.
//   • INTEGRATION: getOrgContext returns every documented field without throwing when the DB is up;
//     skips green otherwise (repo integration-test convention).
// ─────────────────────────────────────────────────────────────────────────────────────────────

// A fully-populated fixture whose leaf objects carry SECRETS (endpoints, auth, rule bodies, doc
// text) so we can assert the summary never surfaces them.
function fixture(): OrgContext {
  return {
    orgId: 'acme',
    connectors: [
      {
        id: 'con_1',
        name: 'CoreBank Postgres',
        type: 'postgres',
        status: 'connected',
        lastSync: null,
        endpoint: 'postgres://user:s3cret@corebank:5432/db', // secret
        auth: 'password', // secret-ish
        description: 'core banking',
        custom: false,
      },
      {
        id: 'con_2',
        name: 'CRM REST',
        type: 'http',
        status: 'connected',
        lastSync: null,
        endpoint: 'https://crm.internal/api?token=abc123', // secret
        auth: 'api-key',
        description: 'crm',
        custom: true,
      },
    ],
    dataDomains: [
      { id: 'dom_1', label: 'Customers', connectorId: 'con_1', resource: 'customers' },
      { id: 'dom_2', label: 'Transactions', connectorId: 'con_1', resource: 'txns' },
    ],
    dataDomainsAvailable: true,
    datasets: [{ id: 'ds_1', name: 'Loans 2024', source: 'con_1', rows: 100, classification: 'pii', updatedAt: 'now' }],
    tools: [
      { id: 't1', name: 'search', type: 'http', endpoint: 'https://x/search?key=SEKRET', description: '', enabled: true, policy: 'allow' },
      { id: 't2', name: 'transfer', type: 'http', endpoint: 'https://x/transfer', description: '', enabled: true, policy: 'approval' },
      { id: 't3', name: 'delete', type: 'http', endpoint: 'https://x/delete', description: '', enabled: false, policy: 'blocked' },
      { id: 't4', name: 'lookup', type: 'mcp', endpoint: 'mcp://x', description: '', enabled: true, policy: 'allow' },
    ],
    guardrailRules: [
      { id: 'g1', matcher: 'entity', pattern: 'US_SSN', action: 'redact', label: 'SSN redact', enabled: true, createdAt: 'now' },
      { id: 'g2', matcher: 'regex', pattern: '\\d{16}', action: 'mask', label: 'PAN mask', enabled: false, createdAt: 'now' },
    ],
    policy: {
      version: 7,
      egressAllowed: false,
      guardrails: ['pii', 'toxicity'],
      allowedModels: ['llama-3.1-70b', 'qwen-2.5-72b'],
      routingRules: [],
      updatedAt: 'now',
    },
    routingRules: [
      { id: 'r1', name: 'pii-local', priority: 1, attribute: 'class', operator: 'eq', value: 'pii', action: 'local', model: 'llama-3.1-70b', fallback: '', enabled: true },
      { id: 'r2', name: 'off', priority: 2, attribute: 'x', operator: 'eq', value: 'y', action: 'block', model: '', fallback: '', enabled: false },
    ],
    allowedModels: ['llama-3.1-70b', 'qwen-2.5-72b'],
    brainDocuments: [
      { id: 'b1', title: 'Handbook', source: 'upload', text: 'CONFIDENTIAL internal handbook body' }, // secret text
      { id: 'b2', title: 'Runbook', source: 'upload', text: 'secret ops runbook' }, // secret text
    ],
  };
}

test('summarizeOrgContext — counts and names', () => {
  const s = summarizeOrgContext(fixture());

  assert.equal(s.orgId, 'acme');

  assert.equal(s.connectors.count, 2);
  assert.deepEqual(s.connectors.names, ['CoreBank Postgres', 'CRM REST']);

  assert.equal(s.dataDomains.count, 2);
  assert.deepEqual(s.dataDomains.names, ['Customers', 'Transactions']);
  assert.equal(s.dataDomains.available, true);

  assert.equal(s.datasets.count, 1);
  assert.deepEqual(s.datasets.names, ['Loans 2024']);

  assert.equal(s.tools.count, 4);
  assert.deepEqual(s.tools.names, ['search', 'transfer', 'delete', 'lookup']);
  assert.deepEqual(s.tools.policies, { allow: 2, approval: 1, blocked: 1 });

  assert.equal(s.guardrails.count, 2);
  assert.equal(s.guardrails.enabled, 1);
  assert.equal(s.guardrails.on, true);

  assert.equal(s.policy.version, 7);
  assert.equal(s.policy.egressAllowed, false);
  assert.equal(s.policy.guardrailCount, 2);

  assert.equal(s.routing.count, 2);
  assert.equal(s.routing.enabled, 1);

  assert.equal(s.models.count, 2);
  assert.deepEqual(s.models.names, ['llama-3.1-70b', 'qwen-2.5-72b']);

  assert.equal(s.brain.documentCount, 2);
});

test('summarizeOrgContext — guardrails.on is true when only policy-level guardrails exist', () => {
  const ctx = fixture();
  // No enabled rule-level guardrails, but the policy bundle names guardrails → still "on".
  ctx.guardrailRules = ctx.guardrailRules.map((r) => ({ ...r, enabled: false }));
  const s = summarizeOrgContext(ctx);
  assert.equal(s.guardrails.enabled, 0);
  assert.equal(s.guardrails.on, true);
});

test('summarizeOrgContext — guardrails.on is false with no rules and no policy guardrails', () => {
  const ctx = fixture();
  ctx.guardrailRules = [];
  ctx.policy = { ...ctx.policy, guardrails: [] };
  const s = summarizeOrgContext(ctx);
  assert.equal(s.guardrails.on, false);
});

test('summarizeOrgContext — reflects unavailable data-domains (1B not merged)', () => {
  const ctx = fixture();
  ctx.dataDomains = [];
  ctx.dataDomainsAvailable = false;
  const s = summarizeOrgContext(ctx);
  assert.equal(s.dataDomains.count, 0);
  assert.deepEqual(s.dataDomains.names, []);
  assert.equal(s.dataDomains.available, false);
});

test('summarizeOrgContext — leaks NO secrets (endpoints, auth, rule bodies, doc text)', () => {
  const s = summarizeOrgContext(fixture());
  const blob = JSON.stringify(s);
  // Endpoints / credentials / tokens.
  assert.equal(blob.includes('s3cret'), false, 'no connector password');
  assert.equal(blob.includes('postgres://'), false, 'no connector endpoint');
  assert.equal(blob.includes('token=abc123'), false, 'no REST token');
  assert.equal(blob.includes('SEKRET'), false, 'no tool endpoint key');
  assert.equal(blob.includes('mcp://'), false, 'no tool endpoint');
  // Guardrail rule bodies (the pattern is the sensitive part).
  assert.equal(blob.includes('US_SSN'), false, 'no guardrail pattern');
  assert.equal(blob.includes('\\d{16}'), false, 'no regex body');
  // Brain document text.
  assert.equal(blob.includes('CONFIDENTIAL'), false, 'no doc body');
  assert.equal(blob.includes('runbook body'), false, 'no doc body');
});

// ─── Integration: real getOrgContext against a real Postgres ─────────────────────────────────────
const dbUp = await dbReachable();

test('getOrgContext returns every documented field without throwing', { skip: dbUp ? false : SKIP_MESSAGE }, async () => {
  const { getOrgContext } = await import('@/lib/org-context');
  const ctx = await getOrgContext('test-int-org-context');

  assert.equal(ctx.orgId, 'test-int-org-context');
  assert.ok(Array.isArray(ctx.connectors), 'connectors is an array');
  assert.ok(Array.isArray(ctx.dataDomains), 'dataDomains is an array');
  assert.equal(typeof ctx.dataDomainsAvailable, 'boolean');
  assert.ok(Array.isArray(ctx.datasets), 'datasets is an array');
  assert.ok(Array.isArray(ctx.tools), 'tools is an array');
  assert.ok(Array.isArray(ctx.guardrailRules), 'guardrailRules is an array');
  assert.ok(ctx.policy && typeof ctx.policy.version === 'number', 'policy bundle present');
  assert.ok(Array.isArray(ctx.routingRules), 'routingRules is an array');
  assert.ok(Array.isArray(ctx.allowedModels), 'allowedModels is an array');
  assert.ok(Array.isArray(ctx.brainDocuments), 'brainDocuments is an array');

  // The pure summary must derive cleanly from a real context too.
  const { summarizeOrgContext } = await import('@/lib/org-context');
  const s = summarizeOrgContext(ctx);
  assert.equal(s.orgId, 'test-int-org-context');
  assert.equal(s.connectors.count, ctx.connectors.length);
});
