import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_OBJECT_UPLOAD_BYTES,
  parseObjectScopeResource,
  parseObjectStoreCredential,
  relativeObjectKey,
  resolveObjectAccessScope,
  scopedObjectKey,
  scopedObjectPrefix,
  serializeObjectStoreCredential,
  validateObjectUpload,
} from '@/lib/object-store';

const bindings = [
  {
    id: 'dom_claims',
    orgId: 'org_suraksha',
    label: 'Settled claim evidence',
    connectorId: 'con_minio',
    resource: 'claims-archive/settled/2026',
  },
  {
    id: 'dom_foreign',
    orgId: 'org_bharat',
    label: 'Foreign archive',
    connectorId: 'con_minio',
    resource: 'bharat-private/contracts',
  },
] as const;

test('domain resource freezes one approved bucket and optional prefix', () => {
  assert.deepEqual(parseObjectScopeResource('claims-archive/settled/2026'), {
    ok: true,
    bucket: 'claims-archive',
    prefix: 'settled/2026/',
  });
  assert.deepEqual(parseObjectScopeResource('claims-archive'), {
    ok: true,
    bucket: 'claims-archive',
    prefix: '',
  });
  for (const invalid of ['', '/bucket/x', 's3://bucket/x', 'bucket/../x', 'Bad-Bucket/x', 'ab/x']) {
    assert.equal(parseObjectScopeResource(invalid).ok, false, invalid);
  }
});

test('scope resolver requires the active org, connector and exact domain together', () => {
  const resolved = resolveObjectAccessScope({
    orgId: 'org_suraksha',
    connectorId: 'con_minio',
    domainId: 'dom_claims',
    bindings,
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.scope.prefix, 'settled/2026/');

  assert.equal(
    resolveObjectAccessScope({
      orgId: 'org_suraksha',
      connectorId: 'con_minio',
      domainId: 'dom_foreign',
      bindings,
    }).ok,
    false,
    "an org cannot select another tenant's domain even on a same-id connector",
  );
  assert.equal(
    resolveObjectAccessScope({
      orgId: 'org_suraksha',
      connectorId: 'con_other',
      domainId: 'dom_claims',
      bindings,
    }).ok,
    false,
  );
});

test('relative navigation cannot escape its approved prefix or bucket', () => {
  const resolved = resolveObjectAccessScope({
    orgId: 'org_suraksha',
    connectorId: 'con_minio',
    domainId: 'dom_claims',
    bindings,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const scope = resolved.scope;
  assert.deepEqual(scopedObjectKey(scope, 'july/claim-12.pdf'), {
    ok: true,
    key: 'settled/2026/july/claim-12.pdf',
  });
  assert.deepEqual(scopedObjectPrefix(scope, ''), { ok: true, prefix: 'settled/2026/' });
  assert.deepEqual(scopedObjectPrefix(scope, 'july'), { ok: true, prefix: 'settled/2026/july/' });
  assert.equal(relativeObjectKey(scope, 'settled/2026/july/claim-12.pdf'), 'july/claim-12.pdf');
  assert.equal(relativeObjectKey(scope, 'private/claim-12.pdf'), null);
  for (const escape of [
    '../private.pdf',
    'july/../../private.pdf',
    '/private.pdf',
    'a\\b.pdf',
    '',
  ]) {
    assert.equal(scopedObjectKey(scope, escape).ok, false, escape);
  }
  assert.equal(scopedObjectPrefix(scope, '../private').ok, false);
});

test('uploads are bounded by size, approved media type and safe relative key', () => {
  assert.deepEqual(
    validateObjectUpload({ relativeKey: 'claim-12.pdf', size: 42, contentType: 'application/pdf' }),
    { ok: true },
  );
  assert.equal(
    validateObjectUpload({ relativeKey: '../x', size: 1, contentType: 'text/plain' }).ok,
    false,
  );
  assert.equal(
    validateObjectUpload({ relativeKey: 'x.html', size: 1, contentType: 'text/html' }).ok,
    false,
  );
  assert.equal(
    validateObjectUpload({ relativeKey: 'x.pdf', size: 0, contentType: 'application/pdf' }).ok,
    false,
  );
  assert.equal(
    validateObjectUpload({
      relativeKey: 'x.pdf',
      size: MAX_OBJECT_UPLOAD_BYTES + 1,
      contentType: 'application/pdf',
    }).ok,
    false,
  );
});

test('connector S3 keypair stays one opaque vaulted value and malformed values fail closed', () => {
  const encoded = serializeObjectStoreCredential({ accessKey: 'access', secretKey: 'secret' });
  assert.deepEqual(parseObjectStoreCredential(encoded), {
    accessKey: 'access',
    secretKey: 'secret',
  });
  for (const malformed of [null, '', 'access:secret', '{}', '{"accessKey":"only"}', 'not-json']) {
    assert.equal(parseObjectStoreCredential(malformed), null);
  }
});
