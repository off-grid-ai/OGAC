import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDomainDashboard, DOMAIN_DASHBOARD_IDS } from '../src/lib/domain-dashboard.ts';

test('registry defines every consumable top-level domain exactly once', () => {
  assert.deepEqual(DOMAIN_DASHBOARD_IDS, [
    'work',
    'solutions',
    'data',
    'runtime',
    'governance',
    'insights',
    'operations',
  ]);
  const routes = DOMAIN_DASHBOARD_IDS.flatMap((id) =>
    buildDomainDashboard(id).modules.map((module) => module.href),
  );
  assert.equal(new Set(routes).size, routes.length);
});

test('dashboard projects canonical sidebar owners instead of a second module registry', () => {
  const data = buildDomainDashboard('data');
  assert.deepEqual(
    data.modules.map((module) => module.label),
    ['Sources', 'Domains', 'Flows', 'Warehouse', 'Catalog', 'Knowledge', 'Lineage'],
  );
  assert.equal(data.primaryAction.href, '/data/sources');
  assert.match(data.summary, /governed intelligence/);
});

test('dashboard removes missing facts and caps recent activity', () => {
  const activities = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    label: `Run ${index}`,
    detail: 'done',
    href: `/operations/runs/${index}`,
  }));
  const model = buildDomainDashboard('operations', {
    facts: [null, { label: 'Services', value: '4 / 5', description: 'responding' }, undefined],
    activities,
  });
  assert.equal(model.facts.length, 1);
  assert.equal(model.activities.length, 6);
  assert.equal(model.activities.at(-1)?.id, '5');
});
