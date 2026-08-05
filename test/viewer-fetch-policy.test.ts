// The client-side write short-circuit for the read-only viewer.
//
// Context: the public demo links hand out a viewer account. The server block was always correct, but
// the UI didn't know about it, so 216 write components rendered armed controls that failed on click —
// a stranger reads "Failed to add connector" as a broken product. One seam now stops the request in the
// browser and explains it. These tests pin the properties that make that seam safe, because the failure
// modes are asymmetric and both are bad: too strict silently breaks reads the demo is meant to show,
// too loose promises writes the server will refuse.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { methodOf, shouldBlockViewerRequest } from '@/lib/viewer-fetch-policy';
import { READ_ONLY_QUERY_PATHS, VIEWER_ROLE } from '@/lib/viewer-policy';

const ORIGIN = 'https://suraksha-onprem-console.getoffgridai.co';
// No default role parameter here: a default would swallow an explicitly-passed `undefined`, which is
// one of the roles that must be verified as unaffected. `blockAs` takes the role positionally instead.
const block = (method: string, url: string) =>
  shouldBlockViewerRequest(VIEWER_ROLE, method, url, ORIGIN);
const blockAs = (role: string | null | undefined, method: string, url: string) =>
  shouldBlockViewerRequest(role, method, url, ORIGIN);

test('a viewer’s mutating call to our API is stopped', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(block(method, '/api/v1/admin/connectors'), `${method} should be blocked`);
  }
});

test('a viewer’s reads are never touched', () => {
  // The whole promise of the account is "view everything". Blocking a read would break the demo it
  // exists to enable, which is the more damaging of the two failure directions.
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(block(method, '/api/v1/admin/connectors'), false, `${method} must pass`);
  }
});

test('nobody except a viewer is affected', () => {
  // The interceptor is mounted for all roles and must be inert for every other one.
  for (const role of ['admin', 'operator', 'compliance', '', null, undefined]) {
    assert.equal(
      blockAs(role, 'DELETE', '/api/v1/admin/connectors'),
      false,
      `role ${role} must pass`,
    );
  }
});

test('a viewer can still sign out', () => {
  // NextAuth signs out with a POST. Blocking it traps a visitor in the demo with no way out — the one
  // write every visitor must be able to perform, and the reason /api/auth is exempt.
  assert.equal(block('POST', '/api/auth/signout'), false);
  assert.equal(block('POST', '/api/auth/callback/password'), false);
  assert.equal(block('POST', '/api/auth/session'), false);
});

test('a POST that is semantically a read is allowed, from the shared allowlist', () => {
  // Not hardcoded: read the allowlist the SERVER uses, so this test fails if the client ever stops
  // agreeing with it. A viewer once could not search memory because the query travels in a POST body
  // and a method-only rule called it a write.
  assert.ok(READ_ONLY_QUERY_PATHS.length > 0, 'allowlist should be non-empty for this test to mean anything');
  for (const path of READ_ONLY_QUERY_PATHS) {
    assert.equal(block('POST', path), false, `${path} is a read and must pass`);
  }
});

test('the allowlist does not leak to neighbouring paths', () => {
  // The server matches exactly, so the client must too: a sub-route must not inherit a write exemption
  // nobody reviewed.
  for (const path of READ_ONLY_QUERY_PATHS) {
    assert.ok(block('POST', `${path}/delete`), `${path}/delete must stay blocked`);
    assert.ok(block('POST', `${path}-other`), `${path}-other must stay blocked`);
  }
});

test('cross-origin requests are left entirely alone', () => {
  // Silently failing someone else's endpoint would be a bug wearing a security costume. Our API only.
  assert.equal(block('POST', 'https://api.example.test/v1/things'), false);
  assert.equal(block('POST', 'https://evil.test/api/v1/admin/connectors'), false);
});

test('non-API routes on our own origin are left alone', () => {
  // A Next.js server-action POST to a page route is not an /api write; the middleware rule is scoped to
  // /api/ and this must match it or the console's own navigation starts failing.
  assert.equal(block('POST', '/overview'), false);
  assert.equal(block('POST', '/governance/posture'), false);
});

test('an absolute URL on our own origin is treated as ours', () => {
  // Components write fetch() both ways; the rule must not depend on which.
  assert.ok(block('POST', `${ORIGIN}/api/v1/admin/connectors`));
  assert.equal(block('GET', `${ORIGIN}/api/v1/admin/connectors`), false);
});

test('a query string never changes the decision', () => {
  // The middleware is given the pathname only. If the client keyed off the full URL, an endpoint could
  // be blocked or allowed here but not there.
  assert.ok(block('POST', '/api/v1/admin/connectors?tab=new&x=1'));
  assert.equal(block('POST', `/api/auth/signout?callbackUrl=%2F`), false);
});

test('a trailing slash never changes the decision', () => {
  assert.ok(block('POST', '/api/v1/admin/connectors/'));
  for (const path of READ_ONLY_QUERY_PATHS) {
    assert.equal(block('POST', `${path}/`), false);
  }
});

test('an unparseable URL is not ours to judge', () => {
  // Let fetch fail on it the way it normally would, rather than swallowing it as "blocked".
  assert.equal(block('POST', 'http://['), false);
});

test('methodOf resolves the method the way fetch does', () => {
  // fetch(input, init): an explicit init.method wins over a Request's own method; absent both it's GET.
  assert.equal(methodOf({ method: 'delete' }, 'POST'), 'DELETE');
  assert.equal(methodOf(null, 'post'), 'POST');
  assert.equal(methodOf(undefined, null), 'GET');
  assert.equal(methodOf({}, undefined), 'GET');
});

test('a lowercase method is still recognised as a write', () => {
  // fetch accepts any casing; a case-sensitive check here would let every lowercase write straight
  // through to a 403 — precisely the experience being fixed.
  assert.ok(block('post', '/api/v1/admin/connectors'));
  assert.ok(block('delete', '/api/v1/admin/connectors'));
});
