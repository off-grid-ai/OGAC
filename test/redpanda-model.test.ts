import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupTopics,
  normalizePartitions,
  parseSchema,
  requiredName,
} from '../src/lib/redpanda-model.ts';

test('normalizes Redpanda partitions and groups topic ownership', () => {
  const partitions = normalizePartitions([
    {
      ns: 'kafka',
      topic: 'events',
      partition_id: 0,
      leader_id: 1,
      replicas: [{ node_id: 1 }, { node_id: 2 }],
    },
    { namespace: 'kafka', topic: 'events', partition: 1, leader_id: 2, replica_ids: [2, 1] },
    { broken: true },
  ]);
  assert.equal(partitions.length, 2);
  assert.deepEqual(groupTopics(partitions), [
    { namespace: 'kafka', name: 'events', partitions: 2, leaders: [1, 2], replicas: [1, 2] },
  ]);
});

test('validates names and schemas at the pure boundary', () => {
  assert.equal(requiredName(' subject ', 'subject'), 'subject');
  assert.deepEqual(parseSchema({ schema: '{}', schemaType: 'json' }), {
    schema: '{}',
    schemaType: 'JSON',
  });
  assert.deepEqual(parseSchema({ schema: '{}' }), { schema: '{}', schemaType: 'AVRO' });
  assert.throws(() => requiredName('', 'topic'), /topic is required/);
  assert.throws(() => requiredName('x'.repeat(250), 'topic'), /249/);
  assert.throws(() => parseSchema(null), /schema body/);
  assert.throws(() => parseSchema({ schema: '{}', schemaType: 'xml' }), /schemaType/);
});

test('ignores malformed partition payloads', () => {
  assert.deepEqual(normalizePartitions(null), []);
  assert.deepEqual(normalizePartitions([null, 1, { ns: 'kafka' }]), []);
});
