import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBfsiStreamContract,
  groupTopics,
  normalizePartitions,
  parseSchema,
  parseTopicCreate,
  parseTopicUpdate,
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

test('sorts numeric broker ids numerically and preserves alternate Redpanda field names', () => {
  const partitions = normalizePartitions([
    {
      namespace: 'kafka',
      topic: 'events',
      partition: 0,
      leader_id: 10,
      replica_ids: [10, 2],
    },
    {
      ns: 'kafka',
      topic: 'events',
      partition_id: 1,
      leader_id: 2,
      replicas: [{ node_id: 2 }, { node_id: 10 }],
    },
  ]);

  assert.deepEqual(groupTopics(partitions), [
    { namespace: 'kafka', name: 'events', partitions: 2, leaders: [2, 10], replicas: [2, 10] },
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
  assert.throws(() => parseSchema({ schema: 'x'.repeat(128 * 1024 + 1) }), /128 KB/);
});

test('ignores malformed partition payloads', () => {
  assert.deepEqual(normalizePartitions(null), []);
  assert.deepEqual(normalizePartitions([null, 1, { ns: 'kafka' }]), []);
});

test('validates bounded topic create and update contracts', () => {
  assert.deepEqual(parseTopicCreate({ name: ' lender.delinquency-events ' }), {
    name: 'lender.delinquency-events',
    partitions: 1,
    replicationFactor: 1,
    retentionMs: 604_800_000,
  });
  assert.deepEqual(parseTopicUpdate({ partitions: 3, retentionMs: 86_400_000 }), {
    partitions: 3,
    retentionMs: 86_400_000,
  });
  assert.throws(() => parseTopicCreate({ name: 'x', partitions: 0 }), /partitions/);
  assert.throws(() => parseTopicCreate({ name: 'x', replicationFactor: 4 }), /replicationFactor/);
  assert.throws(() => parseTopicUpdate({}), /partitions or retentionMs/);
  assert.throws(() => parseTopicUpdate({ retentionMs: 1 }), /retentionMs/);
});

test('builds deterministic BFSI stream contracts with caller-owned correlation ids', () => {
  const lender = buildBfsiStreamContract('lender-delinquency', 'evt-lender-1');
  assert.equal(lender.topic, 'lender.delinquency-events');
  assert.equal(lender.subject, 'lender.delinquency-events-value');
  assert.equal(lender.sample.eventId, 'evt-lender-1');
  assert.match(lender.schema, /daysPastDue/);

  const insurer = buildBfsiStreamContract('insurance-claim', 'evt-claim-1');
  assert.equal(insurer.topic, 'insurance.claim-events');
  assert.equal(insurer.sample.eventId, 'evt-claim-1');
  assert.match(insurer.schema, /estimatedIndemnity/);
  assert.throws(() => buildBfsiStreamContract('other', 'evt'), /journey must be/);
});
