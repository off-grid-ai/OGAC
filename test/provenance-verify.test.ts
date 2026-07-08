import assert from 'node:assert/strict';
import { sign as edSign, generateKeyPairSync, verify as edVerify } from 'node:crypto';
import { test } from 'node:test';
import {
  classifyVerification,
  normalizePem,
  rebuildRunPayload,
  rotationPlan,
} from '../src/lib/provenance-verify.ts';

// ── Pure logic: NO mocks. classifyVerification / rebuildRunPayload / rotationPlan are zero-IO. ──

test('rebuildRunPayload: binds runId (provenanceRef) + maps citation refs', () => {
  const run = {
    id: 'run_123',
    agentId: 'agent_a',
    query: 'q',
    answer: 'a',
    citations: [{ ref: 'doc:1' }, { ref: 'doc:2' }],
  };
  assert.deepEqual(rebuildRunPayload(run), {
    runId: 'run_123',
    agentId: 'agent_a',
    query: 'q',
    answer: 'a',
    refs: ['doc:1', 'doc:2'],
  });
});

test('rebuildRunPayload: missing citations → empty refs, never throws', () => {
  const run = { id: 'r', agentId: 'x', query: 'q', answer: 'a', citations: undefined as never };
  assert.deepEqual(rebuildRunPayload(run).refs, []);
});

test('classifyVerification: no signature → unsigned', () => {
  const v = classifyVerification({ hasSignature: false, signatureValid: null });
  assert.equal(v.status, 'unsigned');
  assert.equal(v.ok, false);
});

test('classifyVerification: valid signature → verified', () => {
  const v = classifyVerification({ hasSignature: true, signatureValid: true });
  assert.equal(v.status, 'verified');
  assert.equal(v.ok, true);
});

test('classifyVerification: invalid + differing keys → key-mismatch', () => {
  const v = classifyVerification({
    hasSignature: true,
    signatureValid: false,
    manifestPublicKey: 'AAAA',
    activePublicKey: 'BBBB',
  });
  assert.equal(v.status, 'key-mismatch');
  assert.equal(v.ok, false);
});

test('classifyVerification: invalid + same key → tampered', () => {
  const v = classifyVerification({
    hasSignature: true,
    signatureValid: false,
    manifestPublicKey: 'SAME',
    activePublicKey: 'SAME',
  });
  assert.equal(v.status, 'tampered');
  assert.equal(v.ok, false);
});

test('classifyVerification: could-not-evaluate (null) → key-mismatch, never a false verified', () => {
  const v = classifyVerification({ hasSignature: true, signatureValid: null });
  assert.equal(v.status, 'key-mismatch');
  assert.equal(v.ok, false);
});

test('normalizePem: cosmetic differences do not read as a mismatch', () => {
  const a = '-----BEGIN PUBLIC KEY-----\nAAAA\nBBBB\n-----END PUBLIC KEY-----\n';
  const b = '-----BEGIN PUBLIC KEY-----\r\nAAAABBBB\r\n-----END PUBLIC KEY-----';
  assert.equal(normalizePem(a), normalizePem(b));
  assert.equal(normalizePem(null), '');
});

test('rotationPlan: ed25519 with env PEM → env-pem mode, deferred install step', () => {
  const p = rotationPlan('Ed25519', true);
  assert.equal(p.mode, 'env-pem');
  assert.equal(p.canApplyInProcess, false);
  assert.equal(p.supportsKeypair, true);
  assert.match(p.remainingStep, /OFFGRID_ED25519_PRIVATE_KEY/);
});

test('rotationPlan: ed25519 without env PEM → ephemeral mode', () => {
  const p = rotationPlan('Ed25519', false);
  assert.equal(p.mode, 'ephemeral');
  assert.equal(p.supportsKeypair, true);
});

test('rotationPlan: HMAC → hmac mode, no keypair, cannot apply in-process', () => {
  const p = rotationPlan('HMAC-SHA256', false);
  assert.equal(p.mode, 'hmac');
  assert.equal(p.supportsKeypair, false);
  assert.equal(p.canApplyInProcess, false);
});

// ── Integration: REAL ed25519 signing round-trip proving the classifier's inputs are honest. ──
// Mirrors the ed25519Signing port (canonical JSON, ed25519_ prefix) with a real keypair — no mocks.

function canonical(payload: unknown): string {
  return JSON.stringify(payload);
}

test('real ed25519 round-trip: honest verified vs tampered vs key-mismatch', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');

  const payload = rebuildRunPayload({
    id: 'run_x',
    agentId: 'a',
    query: 'q',
    answer: 'the answer',
    citations: [{ ref: 'doc:1' }],
  });
  const sig = edSign(null, Buffer.from(canonical(payload)), privateKey);

  // 1. Verified — same key, untouched payload.
  const validUnderActive = edVerify(null, Buffer.from(canonical(payload)), publicKey, sig);
  assert.equal(validUnderActive, true);
  assert.equal(
    classifyVerification({ hasSignature: true, signatureValid: validUnderActive }).status,
    'verified',
  );

  // 2. Tampered — same key, altered answer → signature no longer verifies.
  const tampered = { ...payload, answer: 'a DIFFERENT answer' };
  const validTampered = edVerify(null, Buffer.from(canonical(tampered)), publicKey, sig);
  assert.equal(validTampered, false);
  assert.equal(
    classifyVerification({
      hasSignature: true,
      signatureValid: validTampered,
      manifestPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      activePublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }).status,
    'tampered',
  );

  // 3. Key-mismatch — verify the ORIGINAL payload under a DIFFERENT (rotated) key.
  const validUnderOther = edVerify(null, Buffer.from(canonical(payload)), other.publicKey, sig);
  assert.equal(validUnderOther, false);
  assert.equal(
    classifyVerification({
      hasSignature: true,
      signatureValid: validUnderOther,
      manifestPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      activePublicKey: other.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }).status,
    'key-mismatch',
  );
});
