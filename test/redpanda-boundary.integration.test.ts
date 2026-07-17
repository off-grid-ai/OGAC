import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  consumeRecords,
  createSchemaVersion,
  deleteSchemaSubject,
  deleteSchemaVersion,
  getRedpandaOverview,
  produceRecord,
  type RedpandaConfig,
} from '../src/lib/adapters/redpanda.ts';

test('uses real Admin, Schema Registry, and REST Proxy HTTP boundaries', async (t) => {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    calls.push({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      body: raw ? JSON.parse(raw) : null,
    });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/cluster/health_overview')
      return res.end(JSON.stringify({ is_healthy: true }));
    if (req.url === '/v1/brokers') return res.end(JSON.stringify([{ node_id: 1 }]));
    if (req.url === '/v1/partitions')
      return res.end(
        JSON.stringify([
          {
            ns: 'kafka',
            topic: 'events',
            partition_id: 0,
            leader_id: 1,
            replicas: [{ node_id: 1 }],
          },
        ]),
      );
    if (req.url === '/subjects' && req.method === 'GET')
      return res.end(JSON.stringify(['events-value']));
    if (req.url === '/topics' && req.method === 'GET') return res.end(JSON.stringify(['events']));
    if (req.url === '/subjects/events-value/versions' && req.method === 'POST')
      return res.end(JSON.stringify({ id: 7 }));
    if (req.url === '/subjects/events-value' && req.method === 'DELETE')
      return res.end(JSON.stringify([1, 2]));
    if (req.url === '/subjects/events-value/versions/2' && req.method === 'DELETE')
      return res.end('2');
    if (req.url === '/topics/events' && req.method === 'POST')
      return res.end(JSON.stringify({ offsets: [{ partition: 0, offset: 9 }] }));
    if (req.url === '/consumers/console' && req.method === 'POST')
      return res.end(
        JSON.stringify({
          instance_id: 'reader',
          base_uri: `${base}/consumers/console/instances/reader`,
        }),
      );
    if (req.url === '/consumers/console/instances/reader/subscription') return res.end('{}');
    if (req.url === '/consumers/console/instances/reader/records')
      return res.end(JSON.stringify([{ value: { id: 1 } }]));
    if (req.url === '/consumers/console/instances/reader' && req.method === 'DELETE')
      return res.end('{}');
    res.statusCode = 404;
    return res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const config: RedpandaConfig = { adminUrl: base, schemaUrl: base, restUrl: base };

  const overview = await getRedpandaOverview(config);
  assert.equal(
    overview.boundaries.every((item) => item.state === 'ready'),
    true,
  );
  assert.equal(overview.topics[0]?.name, 'events');
  assert.deepEqual(overview.subjects, ['events-value']);
  await createSchemaVersion('events-value', { schema: '{}', schemaType: 'json' }, config);
  await deleteSchemaVersion('events-value', '2', config);
  await deleteSchemaSubject('events-value', config);
  await produceRecord({ topic: 'events', value: { id: 1 } }, config);
  const consumed = await consumeRecords({ group: 'console', topic: 'events' }, config);
  assert.deepEqual(consumed.records, [{ value: { id: 1 } }]);
  assert(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/instances/reader')));
});

test('reports optional HTTP boundaries as unconfigured without hiding admin failure', async () => {
  const overview = await getRedpandaOverview(
    { adminUrl: 'http://127.0.0.1:1', schemaUrl: null, restUrl: null },
    async () => {
      throw new Error('offline');
    },
  );
  assert.deepEqual(
    overview.boundaries.map((item) => item.state),
    ['down', 'unconfigured', 'unconfigured'],
  );
  await assert.rejects(
    () => produceRecord({ topic: 'x', value: 1 }, { adminUrl: '', schemaUrl: null, restUrl: null }),
    /not configured/,
  );
});
