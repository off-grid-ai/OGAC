import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStaleBundleError } from '../src/lib/stale-bundle.ts';

// A deploy while someone has a tab open makes that tab request JS chunks that no longer exist. The
// resulting ChunkLoadError looks like a crash but means "this tab is out of date". Getting this
// predicate wrong in either direction is costly: miss it and a viewer sees "Something went wrong here"
// on a healthy product; over-match it and a REAL bug gets hidden behind an automatic page reload.

test('the wordings webpack and Next actually emit are all recognised', () => {
  for (const error of [
    { name: 'ChunkLoadError', message: 'Loading chunk 26224 failed.' },
    { name: 'Error', message: 'Loading chunk app-layout failed.' },
    { name: 'TypeError', message: 'Failed to fetch dynamically imported module: /_next/static/x.js' },
    { name: 'TypeError', message: 'error loading dynamically imported module' },
    { name: 'TypeError', message: 'Importing a module script failed.' },
  ]) {
    assert.equal(isStaleBundleError(error), true, `should match: ${error.message}`);
  }
});

test('genuine application errors are NOT treated as a stale tab', () => {
  // Reloading on these would hide a real defect behind a refresh, and could loop.
  for (const error of [
    { name: 'Error', message: 'Cannot read properties of undefined (reading \'trim\')' },
    { name: 'Error', message: 'pipeline not found in this organisation' },
    { name: 'TypeError', message: 'fetch failed' },
    { name: 'Error', message: 'Hydration failed because the initial UI does not match' },
    { name: 'Error', message: 'chunk of work failed to process' },
  ]) {
    assert.equal(isStaleBundleError(error), false, `should NOT match: ${error.message}`);
  }
});

test('a missing or malformed error is not a stale bundle', () => {
  assert.equal(isStaleBundleError(null), false);
  assert.equal(isStaleBundleError(undefined), false);
  assert.equal(isStaleBundleError({}), false);
  assert.equal(isStaleBundleError({ name: 'ChunkLoadError' }), true);
});
