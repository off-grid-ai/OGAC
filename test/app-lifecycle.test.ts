import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { activeTabForPath, appTabHref, lifecycleTabs } from '../src/lib/app-lifecycle.ts';

// Per-app lifecycle nav (Builder Epic #116). The five screens are the structure every app inherits;
// this pure model drives the scoped SubNav and keeps every tab deep-linkable.

test('lifecycleTabs: the lifecycle in flow order (+ Quality, Access, Schedule, Safety)', () => {
  const tabs = lifecycleTabs('app_42');
  assert.deepEqual(
    tabs.map((t) => t.tab),
    // WORK leads: an app opens on what is waiting for you, not on its own configuration
    // (docs/APP_AS_PRODUCT.md item 3). Build moved to its own segment when Work took the base path.
    // Dashboard sits beside Work: both answer "how is this process doing", before you touch the build.
    ['work', 'dashboard', 'build', 'input', 'runs', 'review', 'reports', 'quality', 'access', 'schedule', 'controls'],
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

test('appTabHref: work is the bare app path; others hang off it', () => {
  assert.equal(appTabHref('app_42', 'work'), '/solutions/apps/app_42');
  assert.equal(appTabHref('app_42', 'build'), '/solutions/apps/app_42/build');
  assert.equal(appTabHref('app_42', 'input'), '/solutions/apps/app_42/input');
  assert.equal(appTabHref('app_42', 'reports'), '/solutions/apps/app_42/reports');
});

test('activeTabForPath: bare app path selects Work', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42', 'app_42'), 'work');
  assert.equal(activeTabForPath('/solutions/apps/app_42/build', 'app_42'), 'build');
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

test('activeTabForPath: an unknown sub-segment falls back to Work', () => {
  assert.equal(activeTabForPath('/solutions/apps/app_42/nonsense', 'app_42'), 'work');
});

test('activeTabForPath: a path for a different app is not claimed', () => {
  assert.equal(activeTabForPath('/solutions/apps/other', 'app_42'), null);
  assert.equal(activeTabForPath('/build/studio', 'app_42'), null);
});

// ─── Exactly one h1 per app page ─────────────────────────────────────────────────────────────────
// The app shell (AppLifecycleNav) renders the app's NAME as the h1, so it is present and correct on
// every tab including those with no heading of their own. A tab page adding its own h1 therefore gives
// the page two — an incoherent document outline, and a screen reader announcing two page titles.
// This was shipped briefly when the app name was promoted to h1 while five tab pages still had theirs.
test('no per-app tab page declares its own h1 — the shell owns it', () => {
  const dir = 'src/app/(console)/build/apps/[id]';
  const offenders: string[] = [];

  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'page.tsx' && readFileSync(full, 'utf8').includes('<h1')) {
        offenders.push(full);
      }
    }
  };
  walk(dir);

  assert.deepEqual(offenders, [], 'these tab pages must use h2; the app name is the page h1');
});

test('the app shell renders the app name as the page h1', () => {
  // The other half of the invariant: if the shell stops declaring one, app pages have no heading at
  // all — which is how they came to rely on the mobile gate's hidden h1.
  const nav = readFileSync('src/components/build/AppLifecycleNav.tsx', 'utf8');
  assert.match(nav, /<h1[^>]*>\s*\{title\}/, 'AppLifecycleNav must render {title} as an h1');
});

test('an app presents THREE destinations, not eleven', () => {
  // Eleven tabs made this unusable. Everything that answers "what is happening with this process" — the
  // counts, the queue, the results, the run button — belongs on ONE screen, so those routes are `inline`:
  // real and deep-linkable, reached from Work, never listed as peers.
  const tabs = lifecycleTabs('app_1');
  assert.deepEqual(
    tabs.filter((t) => t.group === 'primary').map((t) => t.label),
    ['Work', 'Build', 'Reports'],
  );
  assert.deepEqual(
    tabs.filter((t) => t.group === 'inline').map((t) => t.label),
    ['Dashboard', 'Start a case', 'Runs', 'Review'],
  );
  // Every inline tab must still resolve to a real route, or "reached from Work" would be a lie.
  for (const tab of tabs.filter((t) => t.group === 'inline')) {
    assert.match(tab.href, /^\/solutions\/apps\/app_1\//);
    assert.equal(activeTabForPath(tab.href, 'app_1'), tab.tab);
  }
});
