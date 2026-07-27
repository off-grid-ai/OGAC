import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  credentialLeaves,
  legacyEnvNames,
  provisionableServices,
  validateCredentialSecret,
} from '../src/lib/service-credential-provisioning.ts';
import {
  b64,
  langfuseEnvAuthConfigured,
  legacyLangfuseAuth,
} from '../src/lib/langfuse-auth.ts';

// Phase 4.10-B: getting service credentials OUT of a plaintext env file on the box and INTO OpenBao.

// ─── what an operator may provision, and the shape each service needs ─────────────────────────────

test('a submission is validated against the service\'s actual auth plan', () => {
  // Langfuse is HTTP Basic (pk:sk) — a bearer token would be stored in leaves the broker never reads,
  // which looks configured but authenticates nothing.
  const wrongKind = validateCredentialSecret({ service: 'langfuse', token: 'sk-lf-abc' });
  assert.equal(wrongKind.ok, false);
  assert.match((wrongKind as { reason: string }).reason, /public key \+ secret key/);

  const right = validateCredentialSecret({
    service: 'langfuse',
    publicKey: 'pk-lf-abc',
    secretKey: 'sk-lf-xyz',
  });
  assert.equal(right.ok, true);
  assert.deepEqual((right as { value: unknown }).value, {
    service: 'langfuse',
    publicKey: 'pk-lf-abc',
    secretKey: 'sk-lf-xyz',
  });
});

test('fleet takes a bearer token, and a keypair is rejected for it', () => {
  const ok = validateCredentialSecret({ service: 'fleet', token: '  fleet-token-123  ' });
  assert.equal(ok.ok, true);
  assert.deepEqual((ok as { value: unknown }).value, { service: 'fleet', token: 'fleet-token-123' });

  const bad = validateCredentialSecret({ service: 'fleet', publicKey: 'a', secretKey: 'b' });
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /API token/);
});

test('seaweedfs takes an S3 keypair', () => {
  const ok = validateCredentialSecret({ service: 'seaweedfs', publicKey: 'AKIA', secretKey: 'shh' });
  assert.equal(ok.ok, true);

  const partial = validateCredentialSecret({ service: 'seaweedfs', publicKey: 'AKIA' });
  assert.equal(partial.ok, false);
  assert.match((partial as { reason: string }).reason, /access key \+ secret key/);
});

test('an unknown or non-provisionable service is refused', () => {
  for (const service of ['', 'opa', 'presidio', 'marquez', 'nonsense', 'gateway']) {
    const res = validateCredentialSecret({ service, token: 'x', publicKey: 'a', secretKey: 'b' });
    assert.equal(res.ok, false, `${service || '(blank)'} must not be provisionable here`);
  }
  assert.deepEqual(provisionableServices(), ['langfuse', 'fleet', 'seaweedfs']);
});

test('blank values are not accepted as a credential', () => {
  assert.equal(validateCredentialSecret({ service: 'fleet', token: '   ' }).ok, false);
  assert.equal(
    validateCredentialSecret({ service: 'langfuse', publicKey: 'pk', secretKey: '  ' }).ok,
    false,
  );
  assert.equal(validateCredentialSecret(null).ok, false);
  assert.equal(validateCredentialSecret(undefined).ok, false);
});

test('each service maps to the exact vault leaves its broker plan reads', () => {
  assert.deepEqual(credentialLeaves('langfuse'), ['langfuse/public-key', 'langfuse/secret-key']);
  assert.deepEqual(credentialLeaves('fleet'), ['fleet/api-token']);
  assert.deepEqual(credentialLeaves('seaweedfs'), [
    'seaweedfs/s3-access-key',
    'seaweedfs/s3-secret-key',
  ]);
  // A service with no provisionable credential has no leaves to write.
  assert.deepEqual(credentialLeaves('opa'), []);
});

test('the env fallbacks are named so an operator knows what to go delete', () => {
  assert.deepEqual(legacyEnvNames('langfuse'), [
    'OFFGRID_LANGFUSE_AUTH',
    'OFFGRID_LANGFUSE_PUBLIC_KEY',
    'OFFGRID_LANGFUSE_SECRET_KEY',
  ]);
  assert.deepEqual(legacyEnvNames('fleet'), ['OFFGRID_FLEET_TOKEN', 'FLEET_TOKEN']);
  assert.deepEqual(legacyEnvNames('opa'), []);
});

// ─── the one Langfuse auth rule (previously three copies) ─────────────────────────────────────────

test('an explicit keypair beats the pre-encoded auth blob', () => {
  const header = legacyLangfuseAuth({
    OFFGRID_LANGFUSE_PUBLIC_KEY: 'pk-lf-1',
    OFFGRID_LANGFUSE_SECRET_KEY: 'sk-lf-2',
    OFFGRID_LANGFUSE_AUTH: 'c2hvdWxkLW5vdC13aW4=',
  } as NodeJS.ProcessEnv);

  assert.equal(header, `Basic ${b64('pk-lf-1:sk-lf-2')}`);
});

test('the pre-encoded auth blob is used when no explicit keypair is set', () => {
  assert.equal(
    legacyLangfuseAuth({ OFFGRID_LANGFUSE_AUTH: 'YWJjOmRlZg==' } as NodeJS.ProcessEnv),
    'Basic YWJjOmRlZg==',
  );
});

test('no env credential means none — never an empty Basic header', () => {
  // `Basic ` with nothing after it would be sent as a real (broken) auth attempt.
  assert.equal(legacyLangfuseAuth({} as NodeJS.ProcessEnv), null);
  assert.equal(legacyLangfuseAuth({ OFFGRID_LANGFUSE_AUTH: '   ' } as NodeJS.ProcessEnv), null);
  assert.equal(
    legacyLangfuseAuth({ OFFGRID_LANGFUSE_PUBLIC_KEY: 'pk', OFFGRID_LANGFUSE_SECRET_KEY: ' ' } as NodeJS.ProcessEnv),
    null,
  );
});

test('the sync gate reflects env only, so it cannot claim configured on the broker\'s behalf', () => {
  // The broker is async and returns none until provisioned; a sync gate that guessed would flip the
  // "is this wired?" answer before anything was actually provisioned.
  assert.equal(langfuseEnvAuthConfigured({} as NodeJS.ProcessEnv), false);
  assert.equal(
    langfuseEnvAuthConfigured({ OFFGRID_LANGFUSE_AUTH: 'YWJjOmRlZg==' } as NodeJS.ProcessEnv),
    true,
  );
});
