import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeTabForPath, appTabHref, lifecycleTabs } from '../src/lib/app-lifecycle.ts';

// Per-app lifecycle nav (Builder Epic #116). The five screens are the structure every app inherits;
// this pure model drives the scoped SubNav and keeps every tab deep-linkable.

test('lifecycleTabs: the lifecycle in flow order (+ Quality, Access, Schedule, Safety)', () => {
  const tabs = lifecycleTabs('app_42');
  assert.deepEqual(
    tabs.map((t) => t.tab),
    ['build', 'input', 'runs', 'review', 'reports', 'quality', 'access', 'schedule', 'controls'],
  );
  assert.ok(
    tabs.every((t) => t.hint.length > 0),
    'every tab carries a helper hint',
  );
});

test('activeTabForPath: the schedule tab resolves from its sub-path', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/schedule', 'app_42'), 'schedule');
  assert.equal(appTabHref('app_42', 'schedule'), '/solutions/apps/app_42/schedule');
});

test('activeTabForPath: the safety (controls) tab resolves from its sub-path', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/controls', 'app_42'), 'controls');
  assert.equal(appTabHref('app_42', 'controls'), '/solutions/apps/app_42/controls');
});

test('activeTabForPath: the quality tab resolves from its sub-path', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/quality', 'app_42'), 'quality');
});

test('activeTabForPath: the access tab resolves from its sub-path', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/access', 'app_42'), 'access');
  assert.equal(appTabHref('app_42', 'access'), '/solutions/apps/app_42/access');
});

test('appTabHref: build is the bare app path; others hang off it', () => {
  assert.equal(appTabHref('app_42', 'build'), '/solutions/apps/app_42');
  assert.equal(appTabHref('app_42', 'input'), '/solutions/apps/app_42/input');
  assert.equal(appTabHref('app_42', 'reports'), '/solutions/apps/app_42/reports');
});

test('activeTabForPath: bare app path selects Build', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42', 'app_42'), 'build');
});

test('activeTabForPath: a named sub-segment selects that tab', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/input', 'app_42'), 'input');
  assert.equal(activeTabForPath('/solutions/apps/app_42/runs', 'app_42'), 'runs');
  assert.equal(activeTabForPath('/solutions/apps/app_42/review', 'app_42'), 'review');
  assert.equal(activeTabForPath('/solutions/apps/app_42/reports', 'app_42'), 'reports');
});

test('activeTabForPath: a deep run path still resolves to the runs tab', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/runs/run_9', 'app_42'), 'runs');
});

test('activeTabForPath: an unknown sub-segment falls back to Build', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/nonsense', 'app_42'), 'build');
});

test('activeTabForPath: a path for a different app is not claimed', () => {
  assert.equal(activeTabForPath('/solutions/apps/other', 'app_42'), null);
  assert.equal(activeTabForPath('/build/studio', 'app_42'), null);
});
