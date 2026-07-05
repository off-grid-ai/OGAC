import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actorFrom,
  buildAuditEvent,
  costUsdFor,
  machineActor,
  normalizeTokens,
  outcomeFromStatus,
  pricePer1k,
} from '../src/lib/audit-event.ts';

// Pure canonical-audit logic (Phase 4.11). No I/O, no mocks — real functions, real assertions.
// Every producer emits THROUGH buildAuditEvent, so these lock the contract shape + normalization.

test('buildAuditEvent produces the canonical shape with required fields', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'mac@wednesday.is', label: 'Mac' },
    org: 'acme',
    action: 'chat.send',
    outcome: 'ok',
  });
  assert.equal(ev.actor.type, 'user');
  assert.equal(ev.actor.id, 'mac@wednesday.is');
  assert.equal(ev.org, 'acme');
  assert.equal(ev.action, 'chat.send');
  assert.equal(ev.outcome, 'ok');
  // ts defaults to a valid ISO timestamp
  assert.ok(!Number.isNaN(new Date(ev.ts).getTime()));
});

test('org defaults to "default"; outcome defaults to "ok"', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'u', label: 'u' },
    action: 'flag.toggle',
  });
  assert.equal(ev.org, 'default');
  assert.equal(ev.outcome, 'ok');
});

test('actor label falls back to id when empty', () => {
  const ev = buildAuditEvent({
    actor: { type: 'machine', id: 'svc-a', label: '' },
    action: 'agent.run',
  });
  assert.equal(ev.actor.label, 'svc-a');
});

test('optional fields are omitted (not null) when absent', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'u', label: 'u' },
    action: 'policy.change',
  });
  assert.ok(!('project' in ev));
  assert.ok(!('resource' in ev));
  assert.ok(!('model' in ev));
  assert.ok(!('tokens' in ev));
  assert.ok(!('costUsd' in ev));
  assert.ok(!('runId' in ev));
  assert.ok(!('ip' in ev));
});

test('ts accepts a Date or ISO string and normalizes to ISO', () => {
  const d = new Date('2026-07-05T10:00:00.000Z');
  assert.equal(buildAuditEvent({ actor: { type: 'user', id: 'u', label: 'u' }, action: 'a', ts: d }).ts, d.toISOString());
  assert.equal(
    buildAuditEvent({ actor: { type: 'user', id: 'u', label: 'u' }, action: 'a', ts: '2026-07-05T10:00:00Z' }).ts,
    '2026-07-05T10:00:00.000Z',
  );
});

test('ts falls back to now for a garbage value', () => {
  const ev = buildAuditEvent({ actor: { type: 'user', id: 'u', label: 'u' }, action: 'a', ts: 'not-a-date' });
  assert.ok(!Number.isNaN(new Date(ev.ts).getTime()));
});

test('normalizeTokens folds a partial triple; total defaults to prompt+completion', () => {
  assert.deepEqual(normalizeTokens({ prompt: 10, completion: 5 }), { prompt: 10, completion: 5, total: 15 });
  assert.deepEqual(normalizeTokens({ total: 42 }), { prompt: 0, completion: 0, total: 42 });
  assert.equal(normalizeTokens(null), undefined);
  assert.equal(normalizeTokens({ prompt: 0, completion: 0, total: 0 }), undefined);
});

test('normalizeTokens clamps negatives + truncates floats', () => {
  assert.deepEqual(normalizeTokens({ prompt: -3, completion: 2.9 }), { prompt: 0, completion: 2, total: 2 });
});

test('costUsd is DERIVED from model + total tokens when not supplied', () => {
  // gpt-4o = $0.005/1K → 2000 tokens = $0.01
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'u', label: 'u' },
    action: 'chat.send',
    model: 'gpt-4o',
    tokens: { prompt: 1000, completion: 1000 },
  });
  assert.equal(ev.tokens?.total, 2000);
  assert.equal(ev.costUsd, 0.01);
});

test('local models are free — costUsd 0', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'u', label: 'u' },
    action: 'chat.send',
    model: 'gemma-local',
    tokens: { total: 5000 },
  });
  assert.equal(ev.costUsd, 0);
});

test('an explicit costUsd wins over the derived one', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'u', label: 'u' },
    action: 'chat.send',
    model: 'gpt-4o',
    tokens: { total: 2000 },
    costUsd: 0.99,
  });
  assert.equal(ev.costUsd, 0.99);
});

test('no cost is emitted without tokens', () => {
  const ev = buildAuditEvent({
    actor: { type: 'user', id: 'u', label: 'u' },
    action: 'chat.send',
    model: 'gpt-4o',
  });
  assert.ok(!('costUsd' in ev));
});

test('pricePer1k: known, unknown-cloud, and *-local models', () => {
  assert.equal(pricePer1k('gpt-4o'), 0.005);
  assert.equal(pricePer1k('cloud-claude'), 0.009);
  assert.equal(pricePer1k('some-unknown-model'), 0.002); // default cloud
  assert.equal(pricePer1k('mistral-local'), 0); // any *local* is free
  assert.equal(costUsdFor('gemma-local', 999999), 0);
});

test('outcome normalization maps run statuses onto the canonical outcome', () => {
  assert.equal(outcomeFromStatus('done'), 'ok');
  assert.equal(outcomeFromStatus('pending_review'), 'ok');
  assert.equal(outcomeFromStatus('denied'), 'blocked');
  assert.equal(outcomeFromStatus('blocked'), 'blocked');
  assert.equal(outcomeFromStatus('cancelled'), 'blocked');
  assert.equal(outcomeFromStatus('error'), 'error');
  assert.equal(outcomeFromStatus('failed'), 'error');
  assert.equal(outcomeFromStatus('anything-else'), 'ok');
});

test('buildAuditEvent maps a run status passed as outcome', () => {
  const ev = buildAuditEvent({ actor: { type: 'user', id: 'u', label: 'u' }, action: 'agent.run', outcome: 'denied' });
  assert.equal(ev.outcome, 'blocked');
});

test('actorFrom: email → user, clientId(no email) → machine, neither → unknown user', () => {
  assert.deepEqual(actorFrom({ email: 'mac@wednesday.is', name: 'Mac' }), {
    type: 'user',
    id: 'mac@wednesday.is',
    label: 'Mac',
  });
  assert.deepEqual(actorFrom({ clientId: 'svc-runner', name: 'Runner' }), {
    type: 'machine',
    id: 'svc-runner',
    label: 'Runner',
  });
  assert.deepEqual(actorFrom(null), { type: 'user', id: 'unknown', label: 'unknown' });
});

test('actorFrom label falls back to id when name absent', () => {
  assert.equal(actorFrom({ email: 'a@b.c' }).label, 'a@b.c');
  assert.equal(actorFrom({ clientId: 'svc' }).label, 'svc');
});

test('actorFrom: a user email takes precedence even if a clientId is also present', () => {
  assert.equal(actorFrom({ email: 'a@b.c', clientId: 'svc' }).type, 'user');
});

test('machineActor builds a machine actor with a fallback label', () => {
  assert.deepEqual(machineActor('svc-1'), { type: 'machine', id: 'svc-1', label: 'svc-1' });
  assert.deepEqual(machineActor('svc-1', 'Sync Bot'), { type: 'machine', id: 'svc-1', label: 'Sync Bot' });
  assert.equal(machineActor('  ').id, 'unknown');
});

test('a full producer event round-trips every field', () => {
  const ev = buildAuditEvent({
    ts: '2026-07-05T00:00:00Z',
    actor: { type: 'machine', id: 'svc-sync', label: 'Sync' },
    org: 'acme',
    project: 'proj-1',
    action: 'connector.sync',
    resource: 'connector:con_abc',
    model: 'cloud-claude',
    tokens: { prompt: 100, completion: 200, total: 300 },
    outcome: 'ok',
    runId: 'run_deadbeef',
    ip: '10.0.0.1',
  });
  assert.deepEqual(ev, {
    ts: '2026-07-05T00:00:00.000Z',
    actor: { type: 'machine', id: 'svc-sync', label: 'Sync' },
    org: 'acme',
    project: 'proj-1',
    action: 'connector.sync',
    resource: 'connector:con_abc',
    model: 'cloud-claude',
    tokens: { prompt: 100, completion: 200, total: 300 },
    costUsd: 0.0027, // 300/1000 * 0.009
    outcome: 'ok',
    runId: 'run_deadbeef',
    ip: '10.0.0.1',
  });
});
