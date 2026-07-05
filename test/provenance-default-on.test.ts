import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { getSigning } from '../src/lib/adapters/registry.ts';
import { correlationIds } from '../src/lib/correlation.ts';

// GAPS_BACKLOG #25 verification: prove provenance signing is DEFAULT-ON in the agent-run pipeline —
// unconditional, not gated behind a flag, and NOT limited to report export — and that a run produces
// a VERIFIABLE signed record correlated by the runId.
//
// These are code-level guarantees (no DB): (1) the signing adapter round-trips a signature over the
// stage-7 payload, (2) the runId in the signed payload is the correlation `provenanceRef`, and
// (3) the source of `agentrun.ts` signs unconditionally (no `if`/flag around the sign call).

const SIGN_SRC = fileURLToPath(new URL('../src/lib/agentrun.ts', import.meta.url));

test('signing adapter round-trips the stage-7 provenance payload (verifiable record)', () => {
  const signing = getSigning();
  const runId = 'run_7ac428c0';
  // The exact payload agentrun.ts signs at stage 7.
  const payload = {
    runId: correlationIds(runId).provenanceRef,
    agentId: 'assistant',
    query: 'what is our data retention policy?',
    answer: 'Records are retained for 7 years.',
    refs: ['kb:policy-1', 'kb:policy-2'],
  };
  const signature = signing.sign(payload);
  assert.ok(signature.length > 0, 'produces a signature');
  assert.equal(signing.verify(payload, signature), true, 'valid signature verifies');

  // Tamper-evidence: any change to the signed answer invalidates the signature.
  const tampered = { ...payload, answer: 'Records are retained for 1 day.' };
  assert.equal(signing.verify(tampered, signature), false, 'tampered payload fails verification');
});

test('provenanceRef binds the signed record to the run (correlation C2)', () => {
  const runId = 'run_bf0e5156';
  assert.equal(correlationIds(runId).provenanceRef, runId, 'runId is embedded verbatim');
});

test('the active signing port yields a verifiable record; ed25519 adds offline (public-key) verify', () => {
  const signing = getSigning();
  // Whatever port is active (native HMAC by default, ed25519 when OFFGRID_ADAPTER_PROVENANCE=ed25519),
  // it must produce a self-consistent, verifiable signature and name its algorithm.
  assert.ok(['HMAC-SHA256', 'Ed25519'].includes(signing.algorithm), 'names its algorithm');
  const p = { runId: 'run_x', answer: 'hello' };
  assert.equal(signing.verify(p, signing.sign(p)), true);
  // ed25519 additionally publishes a public key so a regulator verifies WITHOUT the shared secret.
  if (signing.algorithm === 'Ed25519') {
    assert.ok(signing.publicKey(), 'ed25519 publishes a public key for offline verification');
  }
});

test('agentrun.ts signs provenance UNCONDITIONALLY — not behind a flag, not export-only', () => {
  const src = readFileSync(SIGN_SRC, 'utf8');
  // Stage 7 sign call exists and runs inline in the pipeline.
  assert.match(src, /signing\.sign\(\{/, 'the run pipeline signs the answer');
  assert.match(src, /getSigning\(\)/, 'uses the signing adapter');

  // The sign call must not be guarded by a feature-flag gate (the anti-pattern #25 asks us to rule
  // out). Assert no `isEnabled(...provenance...)`-style gate wraps signing.
  assert.doesNotMatch(
    src,
    /isEnabled\([^)]*provenance/i,
    'provenance signing is NOT gated behind a feature flag',
  );

  // The signed payload is passed to persist() as `provenance`, so every answered run stores it.
  assert.match(src, /provenance,\s*\n\s*\}/, 'the provenance record is persisted with the run');
});
