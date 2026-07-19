import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  consumeRecords,
  createTopic,
  createSchemaVersion,
  deleteSchemaSubject,
  deleteSchemaVersion,
  deleteTopic,
  getRedpandaOverview,
  produceRecord,
  runBfsiStreamJourney,
  updateTopic,
  type NativeKafkaPort,
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
    if (req.url === '/subjects/lender.delinquency-events-value/versions' && req.method === 'POST')
      return res.end(JSON.stringify({ id: 8 }));
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
  const records = new Map<string, Record<string, unknown>>();
  const nativeCalls: string[] = [];
  const kafkaPort: NativeKafkaPort = {
    async listTopics() {
      nativeCalls.push('list');
      return ['events'];
    },
    async createTopic(input) {
      nativeCalls.push(`create:${input.name}`);
      return true;
    },
    async updateTopic(name, input) {
      nativeCalls.push(`update:${name}:${input.partitions}:${input.retentionMs}`);
    },
    async deleteTopic(name) {
      nativeCalls.push(`delete:${name}`);
    },
    async produce(topic, key, value) {
      nativeCalls.push(`produce:${topic}:${key}`);
      if (typeof value.eventId === 'string') records.set(value.eventId, value);
      return [{ topicName: topic, partition: 0, baseOffset: '9' }];
    },
    async consumeMatching(topic, _group, eventId) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const value = records.get(eventId);
        if (value) return { partition: 0, offset: '9', value };
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error(`missing ${eventId} on ${topic}`);
    },
  };
  const config: RedpandaConfig = {
    adminUrl: base,
    schemaUrl: base,
    restUrl: base,
    brokers: ['127.0.0.1:19092'],
    clientId: 'test-console',
  };

  const overview = await getRedpandaOverview(config, fetch, kafkaPort);
  assert.equal(
    overview.boundaries.every((item) => item.state === 'ready'),
    true,
  );
  assert.equal(overview.topics[0]?.name, 'events');
  assert.deepEqual(overview.subjects, ['events-value']);
  await createSchemaVersion('events-value', { schema: '{}', schemaType: 'json' }, config);
  await deleteSchemaVersion('events-value', '2', config);
  await deleteSchemaSubject('events-value', config);
  await createTopic(
    { name: 'new-events', partitions: 3, retentionMs: 86_400_000 },
    config,
    kafkaPort,
  );
  await updateTopic('new-events', { partitions: 4, retentionMs: 172_800_000 }, config, kafkaPort);
  await deleteTopic('new-events', 'new-events', config, kafkaPort);
  await produceRecord(
    { topic: 'events', key: 'record-1', value: { eventId: 'record-1' } },
    config,
    kafkaPort,
  );
  const consumed = await consumeRecords(
    { group: 'console', topic: 'events', eventId: 'record-1' },
    config,
    kafkaPort,
  );
  assert.deepEqual(consumed.value, { eventId: 'record-1' });
  assert.deepEqual(nativeCalls.slice(0, 5), [
    'list',
    'create:new-events',
    'update:new-events:4:172800000',
    'delete:new-events',
    'produce:events:record-1',
  ]);

  const proof = await runBfsiStreamJourney('lender-delinquency', config, kafkaPort, fetch);
  assert.equal(proof.journey, 'lender-delinquency');
  assert.equal(proof.topic, 'lender.delinquency-events');
  assert.equal(proof.consumed.value.eventId, proof.eventId);
  assert.ok(
    calls.some((call) => call.url === '/subjects/lender.delinquency-events-value/versions'),
  );
});

test('reports optional HTTP boundaries as unconfigured without hiding admin failure', async () => {
  const overview = await getRedpandaOverview(
    {
      adminUrl: 'http://127.0.0.1:1',
      schemaUrl: null,
      restUrl: null,
      brokers: [],
      clientId: 'test-console',
    },
    async () => {
      throw new Error('offline');
    },
  );
  assert.deepEqual(
    overview.boundaries.map((item) => item.state),
    ['down', 'unconfigured', 'unconfigured', 'unconfigured'],
  );
  await assert.rejects(
    () =>
      produceRecord(
        { topic: 'x', value: 1 },
        { adminUrl: '', schemaUrl: null, restUrl: null, brokers: [], clientId: 'test-console' },
      ),
    /brokers are not configured/,
  );
});
