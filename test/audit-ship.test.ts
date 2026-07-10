import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAuditEvent } from '../src/lib/audit-event.ts';
import { auditEventToDoc, buildRunAuditDoc } from '../src/lib/siem.ts';
import { correlationIds } from '../src/lib/correlation.ts';

// Pure ship-doc shaping (Phase 4.11). No network — buildQuery/searchAudit hit OpenSearch, but the
// doc shaping (auditEventToDoc) is pure and is what the aggregations key on, so we lock it here.

test('auditEventToDoc flattens actor + carries the canonical fields for term-aggs', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'mac@getoffgridai.co', label: 'Mac' },
    org: 'acme',
    project: 'proj-1',
    action: 'chat.send',
    resource: 'conv:123',
    model: 'gpt-4o',
    tokens: { prompt: 10, completion: 20, total: 30 },
    outcome: 'ok',
  });
  const doc = auditEventToDoc(ev);
  assert.equal(doc.actorId, 'mac@getoffgridai.co');
  assert.equal(doc.actorType, 'user');
  assert.deepEqual(doc.actor, { type: 'user', id: 'mac@getoffgridai.co', label: 'Mac' });
  assert.equal(doc.action, 'chat.send');
  assert.equal(doc.org, 'acme');
  assert.equal(doc.project, 'proj-1');
  assert.equal(doc.resource, 'conv:123');
  assert.equal(doc.model, 'gpt-4o');
  assert.equal(doc.promptTokens, 10);
  assert.equal(doc.completionTokens, 20);
  assert.equal(doc.tokens, 30); // legacy total field
  assert.equal(doc.outcome, 'ok');
  // costUsd derived: 30/1000 * 0.005 = 0.00015 → 0.0001 (Number(x.toFixed(4)) on the float repr)
  assert.equal(doc.costUsd, 0.0001);
});

test('auditEventToDoc keeps legacy device-doc fields populated (same index/mapping)', () => {
  const doc = auditEventToDoc(
    buildAuditEvent({ actor: { type: 'user', id: 'u', label: 'u' }, action: 'flag.toggle', resource: 'flag:x' }),
  );
  // deviceId falls back to the resource so old device-oriented views still render a value.
  assert.equal(doc.deviceId, 'flag:x');
  assert.equal(typeof doc.tokens, 'number');
  assert.equal(doc.leftDevice, false);
  assert.equal(doc.keyId, 'u'); // actor id billed field
});

test('a run event doc is keyed by the correlated auditId (== runId) so q=<runId> hits', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'u', label: 'u' },
    action: 'agent.run',
    resource: 'agent:sales',
    runId: 'run_abc12345',
    outcome: 'ok',
  });
  const doc = auditEventToDoc(ev);
  assert.equal(doc.id, correlationIds('run_abc12345').auditId);
  assert.equal(doc.runId, 'run_abc12345');
});

test('a non-run event gets a stable-shaped uuid id (no runId)', () => {
  const doc = auditEventToDoc(
    buildAuditEvent({ actor: { type: 'user', id: 'u', label: 'u' }, action: 'secret.write', resource: 'secret:k' }),
  );
  assert.match(doc.id, /^[0-9a-f-]{36}$/);
  assert.equal(doc.runId, null);
});

test('buildRunAuditDoc (C2 path) is unchanged — still keyed by runId', () => {
  const doc = buildRunAuditDoc({ runId: 'run_abc12345', agentId: 'sales', outcome: 'done', model: 'gemma-local' });
  assert.equal(doc.id, 'run_abc12345');
  assert.equal(doc.runId, 'run_abc12345');
  assert.equal(doc.deviceId, 'agent:sales');
});
