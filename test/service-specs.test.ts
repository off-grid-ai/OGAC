import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getServiceSpec, resolveSpecUrl, SERVICE_SPECS } from '../src/lib/service-specs.ts';

// PURE unit tests for the API-spec catalog — no I/O.

test('catalog has the console + the native services, each well-formed', () => {
  assert.ok(getServiceSpec('console'), 'console present');
  assert.equal(getServiceSpec('console')!.kind, 'console');
  for (const s of SERVICE_SPECS) {
    assert.ok(s.id && s.label, `${s.id} has id+label`);
    if (s.kind === 'native') {
      assert.ok(s.envVar && s.specPath, `${s.id} native has envVar+specPath`);
    }
    if (s.kind === 'stub') assert.ok(s.note, `${s.id} stub has a note`);
  }
});

test('resolveSpecUrl builds from env base + spec path, trimming slashes', () => {
  const qdrant = getServiceSpec('qdrant')!;
  assert.equal(
    resolveSpecUrl(qdrant, { OFFGRID_QDRANT_URL: 'http://127.0.0.1:6333/' }),
    'http://127.0.0.1:6333/openapi/openapi-3.1.0.json',
  );
});

test('resolveSpecUrl returns null when the env var is unset', () => {
  assert.equal(resolveSpecUrl(getServiceSpec('langfuse')!, {}), null);
});

test('resolveSpecUrl returns null for console + stub specs', () => {
  assert.equal(resolveSpecUrl(getServiceSpec('console')!), null);
  assert.equal(resolveSpecUrl(getServiceSpec('keycloak')!), null);
});
