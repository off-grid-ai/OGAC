import assert from 'node:assert/strict';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const dbUp = await dbReachable();
const TOKEN = 'enterprise-context-route-test';

function request(appId?: string, authenticated = true): Request {
  const url = new URL('http://console.local/api/v1/admin/enterprise-context');
  if (appId !== undefined) url.searchParams.set('appId', appId);
  return new Request(url, {
    headers: authenticated ? { authorization: `Bearer ${TOKEN}` } : {},
  });
}

test('enterprise context route rejects unauthenticated and malformed requests before resolving context', async () => {
  const priorToken = process.env.OFFGRID_ADMIN_TOKEN;
  const priorSecret = process.env.AUTH_SECRET;
  process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
  process.env.AUTH_SECRET = 'enterprise-context-route-secret-32-characters';
  const { GET } = await import('../src/app/api/v1/admin/enterprise-context/route.ts');
  try {
    const unauthorized = await GET(request(undefined, false));
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: 'unauthorized' });

    const malformed = await GET(request('../../another-org'));
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: 'appId must be a valid App identifier',
    });
  } finally {
    if (priorToken === undefined) delete process.env.OFFGRID_ADMIN_TOKEN;
    else process.env.OFFGRID_ADMIN_TOKEN = priorToken;
    if (priorSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = priorSecret;
  }
});

test(
  'real route composes tenant stores and the resolver without exposing another tenant App',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const orgA = `context_a_${suffix}`;
    const orgB = `context_b_${suffix}`;
    const priorToken = process.env.OFFGRID_ADMIN_TOKEN;
    const priorOrg = process.env.OFFGRID_ORG;
    process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
    process.env.OFFGRID_ORG = orgA;

    const { createConnector, deleteConnector } = await import('../src/lib/store.ts');
    const { createDomain, deleteDomain } = await import('../src/lib/data-domains-store.ts');
    const { createApp, deleteApp } = await import('../src/lib/apps-store.ts');
    const { createPipeline, deletePipeline } = await import('../src/lib/pipelines.ts');
    const { GET } = await import('../src/app/api/v1/admin/enterprise-context/route.ts');

    const connector = await createConnector({
      name: `Integration CRM ${suffix}`,
      type: 'rest',
      endpoint: 'http://crm.local/api',
      auth: 'api-key',
      description: 'Must never appear in the context response.',
      orgId: orgA,
    });
    const domain = await createDomain(
      {
        label: `Customer opportunities ${suffix}`,
        connectorId: connector.id,
        resource: 'opportunities',
      },
      orgA,
    );
    const pipeline = await createPipeline(
      {
        name: `Customer decisions ${suffix}`,
        description: 'Published governed pipeline.',
        visibility: 'org',
        status: 'published',
      },
      'service@offgrid.local',
      orgA,
    );
    const otherTenantApp = await createApp(orgB, 'owner@b.test', {
      title: `Other tenant secret App ${suffix}`,
      summary: 'Must not cross the tenant boundary.',
      visibility: 'org',
      published: true,
      trigger: { kind: 'on-demand' },
      steps: [{ id: 'review', label: 'Review', kind: 'human' }],
      edges: [],
    });

    t.after(async () => {
      await deleteApp(otherTenantApp.id, orgB).catch(() => undefined);
      await deletePipeline(pipeline.id, orgA).catch(() => undefined);
      await deleteDomain(domain.id, orgA).catch(() => undefined);
      await deleteConnector(connector.id, orgA).catch(() => undefined);
      if (priorToken === undefined) delete process.env.OFFGRID_ADMIN_TOKEN;
      else process.env.OFFGRID_ADMIN_TOKEN = priorToken;
      if (priorOrg === undefined) delete process.env.OFFGRID_ORG;
      else process.env.OFFGRID_ORG = priorOrg;
    });

    const response = await GET(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = (await response.json()) as {
      object: string;
      data: {
        tenant: { effectiveOrgId: string };
        resources: Array<{
          ref: string;
          disposition: string;
          canSelect: boolean;
          action?: { connectorCompatibility: string };
        }>;
        slices: Array<{ id: string; status: string; reasonCode: string }>;
      };
    };
    assert.equal(body.object, 'enterprise_context');
    assert.equal(body.data.tenant.effectiveOrgId, orgA);
    const data = body.data.resources.find((resource) => resource.ref === `data:${domain.id}`);
    assert.equal(data?.disposition, 'ready');
    assert.equal(data?.canSelect, true);
    const governedPipeline = body.data.resources.find(
      (resource) => resource.ref === `pipeline:${pipeline.id}`,
    );
    assert.equal(governedPipeline?.disposition, 'ready');
    assert.equal(governedPipeline?.canSelect, true);
    const action = body.data.resources.find(
      (resource) => resource.ref === 'action:crm.create-task',
    );
    assert.equal(action?.disposition, 'approval-required');
    assert.equal(action?.canSelect, true);
    assert.equal(action?.action?.connectorCompatibility, 'compatible');
    assert.equal(
      body.data.slices.every((entry) => entry.status === 'ready'),
      true,
    );
    assert.doesNotMatch(JSON.stringify(body), /api-key|Must never appear in the context response/);

    const crossTenant = await GET(request(otherTenantApp.id));
    assert.equal(crossTenant.status, 200);
    const crossBody = (await crossTenant.json()) as typeof body;
    assert.equal(
      crossBody.data.slices.find((entry) => entry.id === 'app')?.reasonCode,
      'app-not-visible',
    );
    assert.doesNotMatch(JSON.stringify(crossBody), new RegExp(otherTenantApp.title));
    assert.doesNotMatch(JSON.stringify(crossBody), new RegExp(orgB));
  },
);
