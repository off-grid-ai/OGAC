import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeTabForPath, appTabHref, lifecycleTabs } from '../src/lib/app-lifecycle.ts';

// Per-app lifecycle nav (Builder Epic #116). The five screens are the structure every app inherits;
// this pure model drives the scoped SubNav and keeps every tab deep-linkable.

test('lifecycleTabs: the lifecycle in flow order (+ Quality)', () => {
  const tabs = lifecycleTabs('app_42');
  assert.deepEqual(
    tabs.map((t) => t.tab),
    ['build', 'input', 'runs', 'review', 'reports', 'quality', 'access'],
  );
  assert.ok(tabs.every((t) => t.hint.length > 0), 'every tab carries a helper hint');
});

test('activeTabForPath: the quality tab resolves from its sub-path', () => {
  assert.equal(activeTabForPath('/build/apps/app_42/quality', 'app_42'), 'quality');
});

test('activeTabForPath: the access tab resolves from its sub-path', () => {
  assert.equal(activeTabForPath('/build/apps/app_42/access', 'app_42'), 'access');
  assert.equal(appTabHref('app_42', 'access'), '/build/apps/app_42/access');
});

test('appTabHref: build is the bare app path; others hang off it', () => {
  assert.equal(appTabHref('app_42', 'build'), '/build/apps/app_42');
  assert.equal(appTabHref('app_42', 'input'), '/build/apps/app_42/input');
  assert.equal(appTabHref('app_42', 'reports'), '/build/apps/app_42/reports');
});

test('activeTabForPath: bare app path selects Build', () => {
  assert.equal(activeTabForPath('/build/apps/app_42', 'app_42'), 'build');
});

test('activeTabForPath: a named sub-segment selects that tab', () => {
  assert.equal(activeTabForPath('/build/apps/app_42/input', 'app_42'), 'input');
  assert.equal(activeTabForPath('/build/apps/app_42/runs', 'app_42'), 'runs');
  assert.equal(activeTabForPath('/build/apps/app_42/review', 'app_42'), 'review');
  assert.equal(activeTabForPath('/build/apps/app_42/reports', 'app_42'), 'reports');
});

test('activeTabForPath: a deep run path still resolves to the runs tab', () => {
  assert.equal(activeTabForPath('/build/apps/app_42/runs/run_9', 'app_42'), 'runs');
});

test('activeTabForPath: an unknown sub-segment falls back to Build', () => {
  assert.equal(activeTabForPath('/build/apps/app_42/nonsense', 'app_42'), 'build');
});

test('activeTabForPath: a path for a different app is not claimed', () => {
  assert.equal(activeTabForPath('/build/apps/other', 'app_42'), null);
  assert.equal(activeTabForPath('/build/studio', 'app_42'), null);
});
