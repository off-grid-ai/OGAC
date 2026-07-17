import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { datasets } from '../src/db/schema.ts';
import { retrieveAgentSources } from '../src/lib/agent-retrieval.ts';
import { createDomain, deleteDomain } from '../src/lib/data-domains-store.ts';
import type { PipelineContract } from '../src/lib/pipeline-enforcement.ts';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '../src/lib/pipeline-governance.ts';
import { connectorSource } from '../src/lib/retrieval/connector-source.ts';
import { createConnector, deleteConnector } from '../src/lib/store.ts';
// @ts-expect-error helper is intentionally plain JS
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe(
  'agent retrieval uses the real router/store with tenant-safe structured access',
  { skip },
  () => {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const orgA = `retrieval_a_${suffix}`;
    const orgB = `retrieval_b_${suffix}`;
    const token = `arrears${suffix.replaceAll('_', '')}`;
    const datasetId = `ds_${suffix}`;
    let connectorA = '';
    let domainA = '';
    let connectorB = '';
    let domainB = '';

    const contract: PipelineContract = {
      pipelineId: `pl_${suffix}`,
      dataAllowlist: [],
      routing: {},
      orgPolicyDefaults: ORG_POLICY_DEFAULTS,
      orgGuardrailDefaults: ORG_GUARDRAIL_DEFAULTS,
      policyOverlay: {},
      guardrailOverlay: {},
    };

    before(async () => {
      await db.insert(datasets).values({
        id: datasetId,
        orgId: orgA,
        name: `${token} mortgage arrears`,
        source: 'warehouse',
        rows: 17,
        classification: 'internal',
      });
      const aConnector = await createConnector({
        name: `${token} A connector`,
        type: 'rest',
        endpoint: 'https://example.invalid/data',
        orgId: orgA,
      });
      connectorA = aConnector.id;
      const aDomain = await createDomain(
        {
          label: `${token} mortgage arrears`,
          connectorId: connectorA,
          resource: 'arrears',
        },
        orgA,
      );
      domainA = aDomain.id;
      const connector = await createConnector({
        name: `${token} B connector`,
        type: 'rest',
        endpoint: 'https://example.invalid/data',
        orgId: orgB,
      });
      connectorB = connector.id;
      const domain = await createDomain(
        {
          label: `${token} mortgage arrears`,
          connectorId: connectorB,
          resource: 'arrears',
        },
        orgB,
      );
      domainB = domain.id;
    });

    after(async () => {
      await db.delete(datasets).where(eq(datasets.id, datasetId));
      if (domainA) await deleteDomain(domainA, orgA);
      if (connectorA) await deleteConnector(connectorA, orgA);
      if (domainB) await deleteDomain(domainB, orgB);
      if (connectorB) await deleteConnector(connectorB, orgB);
    });

    test('bound database query with no authorized domain cannot fall through to dataset catalog', async () => {
      const legacy = await retrieveAgentSources({
        query: `count ${token} mortgage arrears records`,
        k: 8,
        orgId: orgA,
        contract: null,
        asker: { subject: 'analyst@a.test', roles: [] },
      });
      assert.equal(legacy.allow, true);
      assert.ok(
        legacy.allow && legacy.routed.hits.some((hit) => hit.ref === `dataset:${datasetId}`),
        'precondition: the real legacy router can see A dataset catalog',
      );

      const governed = await retrieveAgentSources({
        query: `count ${token} mortgage arrears records`,
        k: 8,
        orgId: orgA,
        contract,
        asker: { subject: 'analyst@a.test', roles: [] },
      });
      assert.equal(governed.allow, false);
      assert.deepEqual(governed.requestedDomainIds, [domainA]);
      assert.equal(governed.allow ? null : governed.denied.requested, domainA);
    });

    test('bound database query with no matching declared domain returns zero structured hits', async () => {
      const noMatch = await retrieveAgentSources({
        query: `count unrelated_${token}x records`,
        k: 8,
        orgId: orgA,
        contract,
        asker: { subject: 'analyst@a.test', roles: [] },
      });
      assert.equal(noMatch.allow, true);
      assert.deepEqual(noMatch.requestedDomainIds, []);
      assert.deepEqual(noMatch.allow ? noMatch.routed.hits : [], []);
    });

    test('connector source cannot resolve an org B connector from an org A request', async () => {
      const [bDomain] = await import('../src/lib/data-domains-store.ts').then((m) =>
        m.listDomains(orgB),
      );
      assert.ok(bDomain);
      const hits = await connectorSource.search(`count ${token}`, 8, undefined, {
        orgId: orgA,
        structuredAccess: { state: 'authorized', domains: [bDomain!] },
      });
      assert.deepEqual(hits, []);
    });
  },
);
