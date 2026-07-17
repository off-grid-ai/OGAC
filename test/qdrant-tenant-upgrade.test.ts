import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateLegacyQdrantPayloads } from '../src/lib/qdrant-migration.ts';

test('Qdrant legacy payload upgrade is idempotent and assigns only missing orgs to default', async () => {
  const points = [
    { id: 'legacy', payload: { title: 'Old Brain document' } },
    { id: 'bank', payload: { title: 'Bank document', org_id: 'bank' } },
  ];
  const calls: unknown[] = [];
  const boundary = async (path: string, method: 'PUT', body: Record<string, unknown>) => {
    calls.push({ path, method, body: structuredClone(body) });
    for (const point of points) {
      if (!('org_id' in point.payload)) Object.assign(point.payload, body.payload);
    }
    return { ok: true, status: 200 };
  };

  await migrateLegacyQdrantPayloads('offgrid-brain', 'default', boundary);
  await migrateLegacyQdrantPayloads('offgrid-brain', 'default', boundary);

  assert.equal(points[0].payload.org_id, 'default');
  assert.equal(points[1].payload.org_id, 'bank');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    path: '/collections/offgrid-brain/points/payload',
    method: 'PUT',
    body: {
      payload: { org_id: 'default' },
      filter: { must: [{ is_empty: { key: 'org_id' } }] },
    },
  });
});

test('Qdrant legacy payload upgrade fails closed when the remote store rejects it', async () => {
  await assert.rejects(
    () =>
      migrateLegacyQdrantPayloads('offgrid-brain', 'default', async () => ({
        ok: false,
        status: 503,
      })),
    /tenant payload migration failed \(503\)/,
  );
});
