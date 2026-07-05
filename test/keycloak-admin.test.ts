import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKcBody } from '../src/lib/keycloak-admin.ts';

// Regression: the service-clients provisioning path threw "Unexpected end of JSON input" because
// fetchJson<void> called res.json() on Keycloak write responses that carry NO body:
//   • POST /roles (createRealmRole) → 201 Created, empty body
//   • PUT / DELETE / role-mapping   → 204 No Content
// parseKcBody must return undefined for those instead of throwing, while still parsing real JSON.

test('parseKcBody: 201 Created with empty body does not throw (Keycloak create)', async () => {
  const res = new Response(null, { status: 201, headers: { location: '/roles/svc-x' } });
  const out = await parseKcBody<void>(res);
  assert.equal(out, undefined);
});

test('parseKcBody: 204 No Content with empty body does not throw', async () => {
  const res = new Response(null, { status: 204 });
  const out = await parseKcBody<void>(res);
  assert.equal(out, undefined);
});

test('parseKcBody: 200 with empty body (no Content-Length JSON) does not throw', async () => {
  const res = new Response('', { status: 200 });
  const out = await parseKcBody<void>(res);
  assert.equal(out, undefined);
});

test('parseKcBody: 200 with whitespace-only body does not throw', async () => {
  const res = new Response('   \n', { status: 200 });
  const out = await parseKcBody<void>(res);
  assert.equal(out, undefined);
});

test('parseKcBody: 200 with a real JSON body is parsed', async () => {
  const res = new Response(JSON.stringify({ value: 's3cret' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const out = await parseKcBody<{ value: string }>(res);
  assert.deepEqual(out, { value: 's3cret' });
});

test('parseKcBody: 200 JSON array (listRealmRoles / listClients) is parsed', async () => {
  const res = new Response(JSON.stringify([{ id: '1', name: 'svc-gateway' }]), { status: 200 });
  const out = await parseKcBody<Array<{ id: string; name: string }>>(res);
  assert.deepEqual(out, [{ id: '1', name: 'svc-gateway' }]);
});
