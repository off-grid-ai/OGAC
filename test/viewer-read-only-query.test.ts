import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  READ_ONLY_QUERY_PATHS,
  isReadOnlyQueryPost,
  isViewerWriteAttempt,
} from '../src/lib/viewer-policy.ts';

// This is a SECURITY control, so the tests are written to try to get a write past it. The allowlist
// exists because the read-only demo account promised "can view everything" and could not search the
// organisation's memory — the query travels in a POST body and the method rule refused it as a change.

test('a viewer may run the allowlisted read-only query POST', () => {
  assert.equal(isViewerWriteAttempt('viewer', 'POST', '/api/v1/organizational-brain/search'), false);
});

test('every other viewer POST is still refused', () => {
  for (const path of [
    '/api/v1/admin/apps/bhapp_reimb/run',
    '/api/v1/admin/quality/drift-projects',
    '/api/v1/organizational-brain/sources',
    '/api/v1/organizational-brain/documents',
  ]) {
    assert.equal(isViewerWriteAttempt('viewer', 'POST', path), true, `${path} must stay blocked`);
  }
});

test('the allowlist does NOT leak to sub-paths — a prefix match would be a write exemption nobody reviewed', () => {
  for (const path of [
    '/api/v1/organizational-brain/search/delete',
    '/api/v1/organizational-brain/search/../sources',
    '/api/v1/organizational-brain/searchx',
    '/api/v1/organizational-brain/search-and-destroy',
  ]) {
    assert.equal(isReadOnlyQueryPost('POST', path), false, `${path} must not match`);
    assert.equal(isViewerWriteAttempt('viewer', 'POST', path), true, `${path} must stay blocked`);
  }
});

test('the exemption is POST-only — the same path with a mutating method stays blocked', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal(
      isViewerWriteAttempt('viewer', method, '/api/v1/organizational-brain/search'),
      true,
      `${method} on the search path must stay blocked`,
    );
  }
});

test('a trailing slash is tolerated but nothing else is normalised away', () => {
  assert.equal(isReadOnlyQueryPost('POST', '/api/v1/organizational-brain/search/'), true);
  // Paths are case-sensitive: silently case-folding would let /API/... slip through a reviewer's eye.
  assert.equal(isReadOnlyQueryPost('POST', '/API/V1/ORGANIZATIONAL-BRAIN/SEARCH'), false);
  // A caller must pass a pathname, not a URL with a query string.
  assert.equal(isReadOnlyQueryPost('POST', '/api/v1/organizational-brain/search?x=1'), false);
});

test('omitting the path keeps the ORIGINAL method rule — the change is additive', () => {
  // Every pre-existing caller passed no path. Their behaviour must be byte-identical.
  assert.equal(isViewerWriteAttempt('viewer', 'POST'), true);
  assert.equal(isViewerWriteAttempt('viewer', 'GET'), false);
  assert.equal(isViewerWriteAttempt('admin', 'POST'), false);
});

test('a non-viewer is unaffected by the allowlist either way', () => {
  for (const role of ['admin', 'compliance', 'member', undefined]) {
    assert.equal(isViewerWriteAttempt(role, 'POST', '/api/v1/organizational-brain/search'), false);
    assert.equal(isViewerWriteAttempt(role, 'POST', '/api/v1/admin/apps/x/run'), false);
  }
});

test('the allowlist is small and every entry is an absolute /api path', () => {
  // A guard against the list growing casually: each entry has to look like a reviewed API route.
  assert.ok(READ_ONLY_QUERY_PATHS.length <= 5, 'keep this list short enough to review by eye');
  for (const p of READ_ONLY_QUERY_PATHS) {
    assert.match(p, /^\/api\/v1\//, `${p} must be an absolute versioned API path`);
    assert.doesNotMatch(p, /[*?]/, `${p} must not contain a wildcard`);
  }
});

test('junk input is never an exemption', () => {
  for (const bad of [null, undefined, '', '   ', '/']) {
    assert.equal(isReadOnlyQueryPost('POST', bad as never), false);
  }
  assert.equal(isReadOnlyQueryPost(null as never, '/api/v1/organizational-brain/search'), false);
});
