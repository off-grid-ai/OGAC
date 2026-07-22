import assert from 'node:assert/strict';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const dbUp = await dbReachable();
const TOKEN = 'app-compile-context-test';

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test(
  'compile preview excludes a declared domain whose connector is not resolver-available',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const orgId = `compile_context_${suffix}`;
    const prior = {
      org: process.env.OFFGRID_ORG,
      token: process.env.OFFGRID_ADMIN_TOKEN,
      gateway: process.env.OFFGRID_GATEWAY_URL,
      authSecret: process.env.AUTH_SECRET,
    };
    process.env.OFFGRID_ORG = orgId;
    process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
    process.env.OFFGRID_GATEWAY_URL = 'http://127.0.0.1:1';
    process.env.AUTH_SECRET = 'app-compile-context-secret-32-characters';

    const { createDomain, deleteDomain } = await import('../src/lib/data-domains-store.ts');
    const domain = await createDomain(
      {
        label: 'Ghost invoice store',
        aliases: ['invoice'],
        connectorId: `missing_connector_${suffix}`,
        resource: 'ghost_invoices',
      },
      orgId,
    );
    t.after(async () => {
      await deleteDomain(domain.id, orgId).catch(() => undefined);
      restore('OFFGRID_ORG', prior.org);
      restore('OFFGRID_ADMIN_TOKEN', prior.token);
      restore('OFFGRID_GATEWAY_URL', prior.gateway);
      restore('AUTH_SECRET', prior.authSecret);
    });

    const { POST } = await import('../src/app/api/v1/admin/apps/compile/route.ts');
    const response = await POST(
      new Request('http://console.local/api/v1/admin/apps/compile', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ description: 'read the invoice, then decide' }),
      }),
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      spec: { steps: Array<{ kind: string; domain?: string }> };
      gaps: string[];
    };
    assert.equal(body.spec.steps.some((step) => step.domain === domain.id), false);
    assert.equal(body.spec.steps.some((step) => step.kind === 'connector-query'), false);
    assert.equal(body.gaps.some((gap) => /invoice/i.test(gap)), true);
  },
);
