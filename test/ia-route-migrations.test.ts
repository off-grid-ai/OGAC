import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IA_ROUTE_MIGRATIONS,
  canonicalPath,
  nextRedirects,
} from '../src/modules/route-migrations.mjs';

test('IA migrations have one owner for every legacy prefix', () => {
  const seen = new Set<string>();
  for (const migration of IA_ROUTE_MIGRATIONS) {
    assert.ok(!seen.has(migration.from), `duplicate legacy owner: ${migration.from}`);
    assert.notEqual(migration.from, migration.to, `self redirect: ${migration.from}`);
    seen.add(migration.from);
  }
});

test('old deep links resolve directly to canonical entity owners', () => {
  assert.equal(canonicalPath('/build/apps/app-42/runs/run-7'), '/solutions/apps/app-42/runs/run-7');
  assert.equal(
    canonicalPath('/build/pipelines/credit-risk/policy'),
    '/runtime/pipelines/credit-risk/policy',
  );
  assert.equal(canonicalPath('/data/etl/job-9'), '/data/flows/orchestration/job-9');
  assert.equal(canonicalPath('/build/apps/runs/run-9'), '/operations/runs/run-9');
  assert.equal(
    canonicalPath('/data/integrations/cache'),
    '/operations/configuration/adapters/cache',
  );
  assert.equal(canonicalPath('/gateway/services/langfuse'), '/operations/services/langfuse');
  assert.equal(canonicalPath('/insights/audit'), '/governance/evidence/audit');
});

test('canonical paths are stable and never redirected back to legacy URLs', () => {
  for (const path of [
    '/work/chat/conversation-1',
    '/solutions/apps/app-42',
    '/runtime/pipelines/credit-risk',
    '/operations/nodes/node-from-registry',
    '/operations/clusters/cluster-from-registry',
    '/operations/services/service-from-registry',
  ]) {
    assert.equal(canonicalPath(path), path);
  }
});

test('Next redirect rules preserve child paths and use permanent redirects', () => {
  const rules = nextRedirects();
  assert.ok(
    rules.some(
      (rule) =>
        rule.source === '/gateway/services/:path*' &&
        rule.destination === '/operations/services/:path*' &&
        rule.permanent,
    ),
  );
  assert.ok(
    !rules.some((rule) => rule.source === '/gateway/:path*'),
    'bare historical /gateway must not hijack its legacy child routes',
  );
});
