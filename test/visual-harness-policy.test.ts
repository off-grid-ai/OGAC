import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import {
  batchItems,
  dynamicSegmentCoverage,
  isCanonicalRoute,
  pageDirectoryRecord,
  pageFailureReasons,
  resolveVisualAuth,
  selectCanonicalRouteRecords,
  visualGateExitCode,
} from '../scripts/lib/visual-harness-policy.mjs';

test('page directories preserve console ownership while stripping route groups', () => {
  assert.deepEqual(pageDirectoryRecord('(console)/solutions/quality/[destination]'), {
    route: '/solutions/quality/[destination]',
    surface: 'console',
  });
  assert.deepEqual(pageDirectoryRecord('(marketing)/features'), {
    route: '/features',
    surface: 'public',
  });
  assert.deepEqual(pageDirectoryRecord(''), { route: '/', surface: 'public' });
});

test('canonical selection excludes historical aliases and respects console-only coverage', () => {
  const selected = selectCanonicalRouteRecords(
    [
      pageDirectoryRecord('(console)/build/apps/[id]'),
      pageDirectoryRecord('(console)/workspace/projects'),
      pageDirectoryRecord('(console)/solutions/apps/[id]'),
      pageDirectoryRecord('(console)/work/projects'),
      pageDirectoryRecord('(console)/operations/health/[destination]'),
      pageDirectoryRecord('(marketing)/features'),
    ],
    { includePublic: false },
  );

  assert.deepEqual(
    selected.routes.map(({ route }) => route),
    ['/operations/health/[destination]', '/solutions/apps/[id]', '/work/projects'],
  );
  assert.deepEqual(
    selected.aliases.map(({ route, canonicalRoute }) => [route, canonicalRoute]),
    [
      ['/build/apps/[id]', '/solutions/apps/[id]'],
      ['/workspace/projects', '/work/projects'],
    ],
  );
  assert.equal(isCanonicalRoute('/runtime/models/routing'), true);
  assert.equal(isCanonicalRoute('/gateway/ai/routing'), false);
});

test('actual route tree selects the new IA and removes migrated primary surfaces', () => {
  const root = join(process.cwd(), 'src/app');
  const records: ReturnType<typeof pageDirectoryRecord>[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'api') walk(path);
      } else if (entry.name === 'page.tsx') {
        records.push(pageDirectoryRecord(relative(root, directory)));
      }
    }
  }
  walk(root);

  const selected = selectCanonicalRouteRecords(records, { includePublic: false });
  const routes = new Set(selected.routes.map(({ route }) => route));
  assert.ok(routes.has('/solutions/quality/[destination]'));
  assert.ok(routes.has('/data/lineage/[destination]'));
  assert.ok(routes.has('/runtime/models/[destination]'));
  assert.ok(routes.has('/governance/policies/[destination]'));
  assert.ok(routes.has('/insights/usage/traffic'));
  assert.ok(routes.has('/operations/health/[destination]'));
  assert.ok(routes.has('/work/projects'));
  assert.equal(routes.has('/build/apps/[id]'), false);
  assert.equal(routes.has('/workspace/projects'), false);
  assert.equal(routes.has('/insights/analytics'), false);
  assert.ok(
    selected.aliases.length > 20,
    'the live compatibility tree should not inflate coverage',
  );
});

test('auth resolves safe sources without breaking legacy CLI precedence', () => {
  assert.deepEqual(
    resolveVisualAuth({
      cli: { user: 'cli@example.com', password: 'cli-secret' },
      env: { OFFGRID_VISUAL_USER: 'env@example.com', OFFGRID_VISUAL_PASSWORD: 'env-secret' },
      file: { user: 'file@example.com', password: 'file-secret' },
    }),
    { user: 'cli@example.com', password: 'cli-secret', error: '' },
  );
  assert.deepEqual(
    resolveVisualAuth({
      env: { OFFGRID_VISUAL_USER: 'env@example.com', OFFGRID_VISUAL_PASSWORD: 'env-secret' },
      file: { user: 'file@example.com', password: 'file-secret' },
    }),
    { user: 'env@example.com', password: 'env-secret', error: '' },
  );
  assert.deepEqual(resolveVisualAuth({ file: { user: 'file@example.com', password: 'secret' } }), {
    user: 'file@example.com',
    password: 'secret',
    error: '',
  });
  assert.match(resolveVisualAuth({ env: { OFFGRID_VISUAL_USER: 'missing-pass' } }).error, /Both/);
});

test('contextual destinations expand fully while entity ids stay bounded', () => {
  assert.equal(dynamicSegmentCoverage('[destination]'), 'all');
  assert.equal(dynamicSegmentCoverage('[id]'), 'first');
  assert.equal(dynamicSegmentCoverage('[runId]'), 'first');
  assert.deepEqual(batchItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.throws(() => batchItems([1], 0), /positive integer/);
});

test('page health ignores business copy containing 500 but fails real visual signals', () => {
  assert.deepEqual(
    pageFailureReasons({
      status: 200,
      bodyText: 'Claims throughput improved from 500 to 5000 per day.',
      layoutOverflowPx: 1,
    }),
    [],
  );

  const reasons = pageFailureReasons({
    status: 503,
    bodyText: 'Application error: a server-side exception has occurred.',
    consoleErrors: ['Failed to fetch'],
    pageErrors: ['TypeError'],
    captureError: 'target closed',
    layoutOverflowPx: 12,
    redirectedToSignin: true,
  });
  assert.deepEqual(reasons, [
    'navigation returned HTTP 503',
    'authenticated route redirected to sign-in',
    'application error boundary rendered',
    '1 browser console error(s)',
    '1 uncaught page error(s)',
    'screenshot capture failed: target closed',
    'document overflows viewport by 12px',
  ]);
  assert.equal(visualGateExitCode([{ ok: true }, { ok: false }]), 1);
  assert.equal(visualGateExitCode([{ ok: true }]), 0);
});
