import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runOrgBrainSearch,
  type BrainRuntimeResolver,
  type ComposableToolCtx,
} from '../src/lib/adapters/tool-primitives.ts';
import {
  resolveBrainAuthorization,
  type BrainAccessPolicyEntry,
  type BrainAuthorizationContext,
  type BrainCitation,
  type BrainSearchResult,
  type OrganizationalBrainPort,
} from '../src/lib/organizational-brain/contracts.ts';
import { formatBrainCitations } from '../src/lib/organizational-brain/search-format.ts';

// The RBAC layer (resolveBrainAuthorization / requireBrainCapability) is exercised for REAL against a
// real in-memory access policy. The only thing faked is the Onyx HTTP boundary — a fake
// OrganizationalBrainPort injected via the resolver, so we prove the gate fires before any search.

const POLICY: readonly BrainAccessPolicyEntry[] = [
  {
    tenantId: 'bharatunion',
    roles: ['relationship-manager'],
    subjectIds: ['rm@bharatunion.example'],
    documentSetSlugs: ['customer-360'],
    capabilities: ['retrieve'],
  },
  {
    // A principal that matches on role but only holds ingest (no retrieve) — RBAC must still deny.
    tenantId: 'bharatunion',
    roles: ['data-engineer'],
    documentSetSlugs: ['ingest-staging'],
    capabilities: ['ingest'],
  },
];

const SAMPLE_CITATIONS: readonly BrainCitation[] = [
  {
    title: 'KYC re-verification SOP',
    excerpt: 'Re-run KYC when PAN and Aadhaar names diverge by more than one token.',
    sourceType: 'confluence',
    provenanceUri: 'ogac://bharatunion/customer-360/doc-1',
  },
  {
    title: 'IFSC routing table',
    excerpt: 'HDFC0000123 routes to the Mumbai Fort branch clearing zone.',
    sourceType: 'notion',
  },
];

// A fake port placed ONLY at the Onyx HTTP boundary; records whether search was reached.
function fakeBrain(citations: readonly BrainCitation[] = SAMPLE_CITATIONS): {
  port: OrganizationalBrainPort;
  calls: { context: BrainAuthorizationContext; query: string; limit?: number }[];
} {
  const calls: { context: BrainAuthorizationContext; query: string; limit?: number }[] = [];
  const unimplemented = (name: string) => (): never => {
    throw new Error(`fakeBrain.${name} should not be called`);
  };
  const port: OrganizationalBrainPort = {
    async search(context, input): Promise<BrainSearchResult> {
      calls.push({ context, query: input.query, limit: input.limit });
      return { query: input.query, citations };
    },
    upsertDocument: unimplemented('upsertDocument') as OrganizationalBrainPort['upsertDocument'],
    deleteDocument: unimplemented('deleteDocument') as OrganizationalBrainPort['deleteDocument'],
    listSources: unimplemented('listSources') as OrganizationalBrainPort['listSources'],
    createSource: unimplemented('createSource') as OrganizationalBrainPort['createSource'],
    setSourceState: unimplemented('setSourceState') as OrganizationalBrainPort['setSourceState'],
    triggerSourceSync: unimplemented('triggerSourceSync') as OrganizationalBrainPort['triggerSourceSync'],
    deleteSource: unimplemented('deleteSource') as OrganizationalBrainPort['deleteSource'],
  };
  return { port, calls };
}

function resolverFor(
  port: OrganizationalBrainPort,
  policy: readonly BrainAccessPolicyEntry[] = POLICY,
): BrainRuntimeResolver {
  return (actor) => ({ authorization: resolveBrainAuthorization(actor, policy), brain: port });
}

// ── formatter (pure) ─────────────────────────────────────────────────────────────────────────────

test('formatBrainCitations renders numbered title/excerpt/provenance blocks', () => {
  const output = formatBrainCitations(SAMPLE_CITATIONS);
  assert.match(output, /1\. KYC re-verification SOP/);
  assert.match(output, /Re-run KYC when PAN and Aadhaar names diverge/);
  assert.match(output, /source: ogac:\/\/bharatunion\/customer-360\/doc-1/);
  assert.match(output, /2\. IFSC routing table/);
  // the second citation has no provenanceUri → no source line for it
  assert.equal(output.match(/source:/g)!.length, 1);
});

test('formatBrainCitations reports an empty result honestly (never a blank string)', () => {
  assert.equal(formatBrainCitations([]), 'No matching passages found in the organizational brain.');
});

// ── RBAC behavior (real gate, faked boundary) ──────────────────────────────────────────────────────

test('ALLOW: an actor whose role is in the policy gets the cited output', async () => {
  const { port, calls } = fakeBrain();
  const ctx: ComposableToolCtx = { orgId: 'bharatunion', actor: 'someone@bharatunion.example', actorRole: 'relationship-manager' };
  const result = await runOrgBrainSearch(ctx, 'KYC re-verification', resolverFor(port));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ran');
  assert.equal(result.primitiveId, 'org_brain_search');
  assert.match(result.output!, /KYC re-verification SOP/);
  assert.equal(result.detail, 'retrieved 2 cited passage(s) from the organizational brain');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.query, 'KYC re-verification');
  assert.equal(calls[0]!.limit, 5);
});

test('ALLOW: an actor whose SUBJECT is in the policy (no role) gets the cited output', async () => {
  const { port, calls } = fakeBrain();
  const ctx: ComposableToolCtx = { orgId: 'bharatunion', actor: 'rm@bharatunion.example' };
  const result = await runOrgBrainSearch(ctx, 'IFSC routing', resolverFor(port));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ran');
  assert.equal(calls.length, 1);
});

test('DENY: an actor whose role/subject is NOT in the policy is blocked, no search call', async () => {
  const { port, calls } = fakeBrain();
  const ctx: ComposableToolCtx = { orgId: 'bharatunion', actor: 'intern@bharatunion.example', actorRole: 'intern' };
  const result = await runOrgBrainSearch(ctx, 'salary data', resolverFor(port));
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.detail, 'not authorized to retrieve from the organizational brain (RBAC)');
  assert.equal(calls.length, 0, 'the brain must never be reached on an RBAC denial');
});

test('DENY: a matching principal WITHOUT the retrieve capability is blocked, no search call', async () => {
  const { port, calls } = fakeBrain();
  const ctx: ComposableToolCtx = { orgId: 'bharatunion', actor: 'eng@bharatunion.example', actorRole: 'data-engineer' };
  const result = await runOrgBrainSearch(ctx, 'anything', resolverFor(port));
  assert.equal(result.status, 'blocked');
  assert.equal(calls.length, 0);
});

test('TENANT ISOLATION: same subject/role under a different tenant is blocked, no search call', async () => {
  const { port, calls } = fakeBrain();
  const ctx: ComposableToolCtx = { orgId: 'other-bank', actor: 'rm@bharatunion.example', actorRole: 'relationship-manager' };
  const result = await runOrgBrainSearch(ctx, 'customer 360', resolverFor(port));
  assert.equal(result.status, 'blocked');
  assert.equal(calls.length, 0);
});

test('an empty query is an honest error, not a brain reach', async () => {
  const { port, calls } = fakeBrain();
  const ctx: ComposableToolCtx = { orgId: 'bharatunion', actor: 'rm@bharatunion.example' };
  const result = await runOrgBrainSearch(ctx, '   ', resolverFor(port));
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.equal(calls.length, 0);
});

test('a brain-boundary failure surfaces as a structured error (never throws)', async () => {
  const failing = fakeBrain();
  failing.port.search = async () => {
    throw new Error('onyx unavailable');
  };
  const ctx: ComposableToolCtx = { orgId: 'bharatunion', actor: 'rm@bharatunion.example' };
  const result = await runOrgBrainSearch(ctx, 'policy', resolverFor(failing.port));
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.match(result.detail, /onyx unavailable/);
});
