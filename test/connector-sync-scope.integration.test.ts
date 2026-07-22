import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const RUN = randomUUID().slice(0, 8);
const ORG_A = `test-connector-sync-scope-a-${RUN}`;
const ORG_B = `test-connector-sync-scope-b-${RUN}`;
const dbUp = await dbReachable();

test(
  'syncConnector scopes connector state and ingest history to the caller org',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { createConnector, deleteConnector, listConnectors, listIngestJobs, syncConnector } =
      await import('@/lib/store');

    const connector = await createConnector({
      name: 'Tenant B operational source',
      type: 'rest',
      endpoint: 'https://example.test/events',
      orgId: ORG_B,
    });
    t.after(() => deleteConnector(connector.id, ORG_B));

    const before = (await listConnectors(ORG_B)).find((item) => item.id === connector.id);
    assert.ok(before);

    assert.equal(await syncConnector(connector.id, ORG_A), null);
    assert.deepEqual(
      (await listConnectors(ORG_B)).find((item) => item.id === connector.id),
      before,
      "another tenant's sync attempt did not mutate connector state",
    );
    assert.ok(
      !(await listIngestJobs(ORG_B)).some((job) => job.connectorId === connector.id),
      "another tenant's sync attempt did not create ingest history",
    );

    const job = await syncConnector(connector.id, ORG_B);
    assert.equal(job?.connectorId, connector.id);
    assert.ok(
      (await listConnectors(ORG_B)).find((item) => item.id === connector.id)?.lastSync,
      'same-tenant sync stamped connector state',
    );
    assert.ok(
      (await listIngestJobs(ORG_B)).some((item) => item.id === job?.id),
      'same-tenant sync recorded ingest history',
    );
  },
);
