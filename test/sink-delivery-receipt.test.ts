import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildSinkDeliveryReceipt } from '../src/lib/sink-delivery-receipt.ts';

const base = {
  sink: 'webhook' as const,
  destination: 'http://127.0.0.1:9099',
  httpStatus: 200,
  signature: 'sha256=abc123',
  masked: false,
  orgId: 'org_bharat',
  runId: 'apprun_1',
  stepId: 'o1',
  sentAt: '2026-07-24T09:10:54.000Z',
};

test('buildSinkDeliveryReceipt: a signed delivery yields signed:true + a signature digest', () => {
  const r = buildSinkDeliveryReceipt(base);
  assert.equal(r.kind, 'sink-delivery');
  assert.equal(r.sink, 'webhook');
  assert.equal(r.destination, 'http://127.0.0.1:9099');
  assert.equal(r.httpStatus, 200);
  assert.equal(r.signed, true);
  // digest is sha256 of the signature header value — proof-of-signing without leaking the secret.
  assert.equal(r.signatureDigest, createHash('sha256').update('sha256=abc123').digest('hex'));
  assert.equal(r.masked, false);
  assert.equal(r.sentAt, '2026-07-24T09:10:54.000Z');
});

test('buildSinkDeliveryReceipt: no signature ⇒ signed:false, null digest (never claims a fake signature)', () => {
  const r = buildSinkDeliveryReceipt({ ...base, signature: null, sink: 'slack', httpStatus: null });
  assert.equal(r.signed, false);
  assert.equal(r.signatureDigest, null);
  assert.equal(r.httpStatus, null);
  assert.equal(r.sink, 'slack');
});

test('buildSinkDeliveryReceipt: whitespace-only signature is treated as unsigned', () => {
  const r = buildSinkDeliveryReceipt({ ...base, signature: '   ' });
  assert.equal(r.signed, false);
  assert.equal(r.signatureDigest, null);
});

test('buildSinkDeliveryReceipt: idempotencyKey is stable per (org,run,step,sink,destination) and changes with destination', () => {
  const a = buildSinkDeliveryReceipt(base);
  const b = buildSinkDeliveryReceipt({ ...base, sentAt: '2026-07-24T10:00:00.000Z' }); // time differs
  assert.equal(a.idempotencyKey, b.idempotencyKey, 'idempotency is independent of send time');
  const c = buildSinkDeliveryReceipt({ ...base, destination: 'http://other' });
  assert.notEqual(a.idempotencyKey, c.idempotencyKey, 'a different destination is a different action');
});
