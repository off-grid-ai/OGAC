import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRunAuditDoc } from '../src/lib/siem.ts';
import { correlationIds } from '../src/lib/correlation.ts';

// The governed-run audit doc must carry the runId as both the doc id and a queryable `runId` field,
// so `_search?q=<runId>` (the C2 harness's OpenSearch probe) hits. No network — pure doc shaping.

test('buildRunAuditDoc keys the doc by the runId (id + runId field == auditId)', () => {
  const doc = buildRunAuditDoc({
    runId: 'run_abc12345',
    agentId: 'agent-1',
    outcome: 'done',
    model: 'gemma-local',
  });
  const expected = correlationIds('run_abc12345').auditId;
  assert.equal(doc.id, expected); // used as OpenSearch _id
  assert.equal(doc.runId, expected); // queryable field
  assert.equal(doc.id, 'run_abc12345');
});

test('buildRunAuditDoc carries run metadata and defaults', () => {
  const doc = buildRunAuditDoc({
    runId: 'run_xyz',
    agentId: 'support-bot',
    outcome: 'blocked',
    model: 'gemma-local',
    caller: 'mac@wednesday.is',
  });
  assert.equal(doc.deviceId, 'agent:support-bot');
  assert.equal(doc.outcome, 'blocked');
  assert.equal(doc.keyId, 'mac@wednesday.is');
  assert.equal(doc.tokens, 0); // defaulted
  assert.equal(doc.leftDevice, true);
  assert.equal(typeof doc.ts, 'string');
});

test('the audit doc runId round-trips to the same key the other planes use', () => {
  const runId = 'run_De4dB33f';
  const doc = buildRunAuditDoc({ runId, agentId: 'a', outcome: 'done', model: 'm' });
  const ids = correlationIds(runId);
  assert.equal(doc.runId, ids.auditId);
  assert.equal(doc.runId, ids.lineageRunId);
  assert.equal(doc.runId, ids.provenanceRef);
});
