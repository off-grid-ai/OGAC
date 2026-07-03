import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
// @ts-expect-error — .mjs helper, no types
import { dbAvailable } from './helpers/db-available.mjs';

// INTEGRATION: exercises the REAL alert-rule + saved-view CRUD in src/lib/analytics-rules.ts against
// a REAL Postgres. Tables self-create via ensureAnalyticsRulesSchema. evaluateRules() is exercised
// against the pure policy (metricValue/evaluateRule) using a synthesized analytics snapshot — the
// live computeAnalytics() query hits OpenSearch, so the persistence + firing wiring is what we assert
// here directly through the rows we own. Skips gracefully (green) when the DB is down.

const { ok, reason } = await dbAvailable();
const skip = ok ? undefined : reason;

const CREATED_BY = 'test-int-analytics';
const ruleIds: string[] = [];
const viewIds: string[] = [];

describe('analytics rules + views CRUD (integration)', { skip }, () => {
  let mod: typeof import('../src/lib/analytics-rules.ts');

  before(async () => {
    mod = await import('../src/lib/analytics-rules.ts');
    await mod.ensureAnalyticsRulesSchema();
  });

  after(async () => {
    if (!mod) return;
    for (const id of ruleIds) await mod.deleteRule(id).catch(() => {});
    for (const id of viewIds) await mod.deleteView(id).catch(() => {});
  });

  test('alert rule: create → read → update → delete', async () => {
    const created = await mod.createRule(
      {
        name: 'p95 latency guard',
        metric: 'p95',
        comparator: 'gt',
        threshold: 1200,
        windowMinutes: 15,
        enabled: true,
      },
      CREATED_BY,
    );
    ruleIds.push(created.id);
    assert.ok(created.id);
    assert.equal(created.metric, 'p95');
    assert.equal(created.threshold, 1200);
    assert.equal(created.createdBy, CREATED_BY);

    // READ via list
    const list = await mod.listRules();
    assert.ok(list.find((r) => r.id === created.id));

    // UPDATE
    const updated = await mod.updateRule(created.id, {
      name: 'p95 latency guard (tightened)',
      metric: 'p95',
      comparator: 'gte',
      threshold: 900,
      windowMinutes: 30,
      enabled: false,
    });
    assert.ok(updated);
    assert.equal(updated?.name, 'p95 latency guard (tightened)');
    assert.equal(updated?.comparator, 'gte');
    assert.equal(updated?.threshold, 900);
    assert.equal(updated?.windowMinutes, 30);
    assert.equal(updated?.enabled, false);

    // DELETE
    await mod.deleteRule(created.id);
    const after = await mod.listRules();
    assert.equal(after.find((r) => r.id === created.id), undefined);
    ruleIds.splice(ruleIds.indexOf(created.id), 1);
  });

  test('updateRule returns null for an unknown id', async () => {
    const res = await mod.updateRule('does-not-exist-int', {
      name: 'x',
      metric: 'p50',
      comparator: 'lt',
      threshold: 1,
      windowMinutes: 5,
      enabled: true,
    });
    assert.equal(res, null);
  });

  test('saved view: create → read → update → delete', async () => {
    const created = await mod.createView(
      { name: 'Blocked, last 24h', range: '24h', model: '', outcome: 'blocked' },
      CREATED_BY,
    );
    viewIds.push(created.id);
    assert.ok(created.id);
    assert.equal(created.outcome, 'blocked');
    assert.equal(created.range, '24h');

    const list = await mod.listViews();
    assert.ok(list.find((v) => v.id === created.id));

    const updated = await mod.updateView(created.id, {
      name: 'OK, last 7d, gpt-4o',
      range: '7d',
      model: 'gpt-4o',
      outcome: 'ok',
    });
    assert.ok(updated);
    assert.equal(updated?.model, 'gpt-4o');
    assert.equal(updated?.outcome, 'ok');

    await mod.deleteView(created.id);
    const after = await mod.listViews();
    assert.equal(after.find((v) => v.id === created.id), undefined);
    viewIds.splice(viewIds.indexOf(created.id), 1);
  });

  test('evaluateRules fires against a synthesized snapshot via the pure policy', async () => {
    // A rule that MUST fire: totalEvents > 10 when the snapshot has 100.
    const firing = await mod.createRule(
      {
        name: 'volume spike',
        metric: 'totalEvents',
        comparator: 'gt',
        threshold: 10,
        windowMinutes: 60,
        enabled: true,
      },
      CREATED_BY,
    );
    ruleIds.push(firing.id);

    // Use the re-exported pure policy directly (no OpenSearch) to prove the persisted rule +
    // decision logic agree — the same metricValue/evaluateRule evaluateRules() composes internally.
    const snapshot = {
      p50: 100,
      p95: 400,
      totalEvents: 100,
      totalTokens: 5000,
      egressRate: 12,
      outcomes: { ok: 80, redacted: 10, blocked: 10 },
    };
    const value = mod.metricValue(snapshot, 'totalEvents');
    assert.equal(value, 100);
    assert.equal(mod.evaluateRule(firing, value), true);

    // A disabled rule never fires even when breaching.
    const disabled = { ...firing, enabled: false };
    assert.equal(mod.evaluateRule(disabled, value), false);

    await mod.deleteRule(firing.id);
    ruleIds.splice(ruleIds.indexOf(firing.id), 1);
  });
});
