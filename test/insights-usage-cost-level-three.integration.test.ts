import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  INSIGHTS_COST_DESTINATIONS,
  INSIGHTS_USAGE_DESTINATIONS,
} from '../src/lib/insights-usage-cost-routes.ts';
import { contextualModule } from '../src/modules/contextual-navigation.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');

test('Usage and Cost contextual modules consume the canonical destination arrays', () => {
  assert.deepEqual(contextualModule('insights-usage').destinations, INSIGHTS_USAGE_DESTINATIONS);
  assert.deepEqual(contextualModule('insights-cost').destinations, INSIGHTS_COST_DESTINATIONS);
});

test('Usage and Cost bases redirect into explicit contextual leaves', () => {
  for (const [module, destinations] of [
    ['usage', INSIGHTS_USAGE_DESTINATIONS],
    ['cost', INSIGHTS_COST_DESTINATIONS],
  ] as const) {
    const base = `src/app/(console)/insights/${module}`;
    assert.match(read(`${base}/page.tsx`), /redirect\(/);
    assert.match(read(`${base}/page.tsx`), /insightsUsageCostRouteWithSearchParams/);
    assert.match(read(`${base}/layout.tsx`), /ContextualModuleShell/);
    assert.doesNotMatch(read(`${base}/layout.tsx`), /<nav\b/i);

    for (const destination of destinations) {
      assert.ok(existsSync(`${ROOT}${base}/${destination.id}/page.tsx`));
      const leaf = read(`${base}/${destination.id}/page.tsx`);
      assert.match(leaf, new RegExp(`destination="${destination.id}"`));
      assert.doesNotMatch(leaf, /<h[12]\b|PageFrame|<nav\b/i);
    }
  }
});

test('legacy Analytics and Accounting routes redirect while retaining one live source', () => {
  const analytics = read('src/app/(console)/insights/analytics/page.tsx');
  const accounting = read('src/app/(console)/insights/accounting/page.tsx');

  assert.match(analytics, /export async function AnalyticsInsightsSource/);
  assert.match(analytics, /computeAnalytics/);
  assert.match(analytics, /safeSupersetDashboard/);
  assert.match(analytics, /redirect\(/);
  assert.match(accounting, /export async function AccountingInsightsSource/);
  assert.match(accounting, /computeAccounting/);
  assert.match(accounting, /redirect\(/);

  for (const source of [analytics, accounting]) {
    assert.match(source, /insightsUsageCostRouteWithSearchParams/);
    assert.doesNotMatch(source, /PageFrame|<h[12]\b|<nav\b/i);
  }
});

test('leaf views preserve live management and URL-filter controls without a second hierarchy', () => {
  const usage = read('src/components/insights/UsageInsightsView.tsx');
  const cost = read('src/components/insights/CostInsightsView.tsx');

  for (const control of [
    'AnalyticsAlerts',
    'GatewayUsage',
    'NativeSupersetPanel',
    'PipelineFacetSelect',
  ]) {
    assert.match(usage, new RegExp(control));
  }
  for (const control of [
    'PipelineFacetSelect',
    'insightsUsageCostRouteWithSearchParams',
    'range',
  ]) {
    assert.match(cost, new RegExp(control));
  }
  for (const source of [usage, cost]) {
    assert.match(source, /className="w-full space-y-6"/);
    assert.doesNotMatch(source, /<h[12]\b|<nav\b|max-w-[234]xl|mx-auto/i);
  }
});
