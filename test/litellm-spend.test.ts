import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aggregateByKey,
  aggregateByModel,
  aggregateTimeSeries,
  assembleSpendView,
  maskToken,
  normalizeSpendLog,
  normalizeSpendLogs,
  parseGroupBy,
  parseRange,
  parseSpendTime,
  parseWindow,
  summarize,
  toDateStamp,
  type RawSpendLog,
  type SpendLogRow,
} from '../src/lib/litellm-spend.ts';

// A fixed clock so window math is deterministic: 2026-07-22T12:00:00Z.
const NOW = Date.parse('2026-07-22T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;

test('parseRange / parseGroupBy: coerce to valid, default on garbage', () => {
  assert.equal(parseRange('7d'), '7d');
  assert.equal(parseRange('30d'), '30d');
  assert.equal(parseRange('24h'), '24h');
  assert.equal(parseRange('90d'), '24h'); // unknown → default
  assert.equal(parseRange(undefined), '24h');
  assert.equal(parseRange(42), '24h');
  assert.equal(parseGroupBy('key'), 'key');
  assert.equal(parseGroupBy('model'), 'model');
  assert.equal(parseGroupBy('team'), 'model'); // unknown → default
  assert.equal(parseGroupBy(null), 'model');
});

test('toDateStamp: UTC YYYY-MM-DD', () => {
  assert.equal(toDateStamp(NOW), '2026-07-22');
  assert.equal(toDateStamp(NOW - DAY), '2026-07-21');
});

test('parseWindow: 24h → 24 hourly buckets with correct bounds', () => {
  const w = parseWindow('24h', NOW);
  assert.equal(w.range, '24h');
  assert.equal(w.startMs, NOW - 24 * HOUR);
  assert.equal(w.endMs, NOW);
  assert.equal(w.bucketMs, HOUR);
  assert.equal(w.bucketCount, 24);
  assert.equal(w.endDate, '2026-07-22');
  assert.equal(w.startDate, '2026-07-21');
});

test('parseWindow: 7d and 30d → daily buckets', () => {
  const w7 = parseWindow('7d', NOW);
  assert.equal(w7.bucketMs, DAY);
  assert.equal(w7.bucketCount, 7);
  assert.equal(w7.startMs, NOW - 7 * DAY);
  const w30 = parseWindow('30d', NOW);
  assert.equal(w30.bucketCount, 30);
  assert.equal(w30.startMs, NOW - 30 * DAY);
});

test('parseSpendTime: ISO string, ms epoch, numeric string, garbage → null', () => {
  assert.equal(parseSpendTime('2026-07-22T12:00:00.000Z'), NOW);
  assert.equal(parseSpendTime(NOW), NOW);
  assert.equal(parseSpendTime(String(NOW)), NOW);
  assert.equal(parseSpendTime('not-a-date'), null);
  assert.equal(parseSpendTime(null), null);
  assert.equal(parseSpendTime(undefined), null);
  assert.equal(parseSpendTime(0), null); // non-positive epoch is meaningless
  assert.equal(parseSpendTime(-5), null);
  assert.equal(parseSpendTime(''), null);
  assert.equal(parseSpendTime(Number.NaN), null);
});

test('maskToken: last-4 only, never the raw token; short/empty → null', () => {
  assert.equal(maskToken('sk-abcdef1234'), '…1234');
  assert.equal(maskToken('ab'), '…ab');
  assert.equal(maskToken('  sk-xyz9999  '), '…9999');
  assert.equal(maskToken(''), null);
  assert.equal(maskToken('   '), null);
  assert.equal(maskToken(null), null);
  assert.equal(maskToken(undefined), null);
});

test('normalizeSpendLog: maps fields, derives tokens, never leaks raw key', () => {
  const raw: RawSpendLog = {
    request_id: 'req-1',
    api_key: 'sk-secretkey5678',
    model: 'qwen-2.5-14b',
    spend: 0,
    prompt_tokens: 100,
    completion_tokens: 50,
    startTime: '2026-07-22T11:30:00.000Z',
    end_user: 'analyst-a',
    metadata: { user_api_key_alias: 'team-tax', user_api_key: 'sk-secretkey5678' },
  };
  const row = normalizeSpendLog(raw);
  assert.equal(row.requestId, 'req-1');
  assert.equal(row.keyMasked, '…5678');
  assert.equal(row.keyAlias, 'team-tax');
  assert.equal(row.model, 'qwen-2.5-14b');
  assert.equal(row.spend, 0);
  assert.equal(row.tokens, 150); // derived from prompt+completion when total absent
  assert.equal(row.promptTokens, 100);
  assert.equal(row.completionTokens, 50);
  assert.equal(row.ts, Date.parse('2026-07-22T11:30:00.000Z'));
  assert.equal(row.endUser, 'analyst-a');
  // The raw key must never appear anywhere in the serialized row.
  assert.ok(!JSON.stringify(row).includes('secretkey'));
});

test('normalizeSpendLog: degrades missing/garbage fields to safe defaults', () => {
  const row = normalizeSpendLog({});
  assert.equal(row.model, 'unknown');
  assert.equal(row.spend, 0);
  assert.equal(row.tokens, 0);
  assert.equal(row.keyMasked, null);
  assert.equal(row.keyAlias, null);
  assert.equal(row.ts, null);
  assert.equal(row.requestId, null);
  assert.equal(row.endUser, null);
  // total_tokens present wins over the prompt+completion sum.
  const withTotal = normalizeSpendLog({ total_tokens: 200, prompt_tokens: 1, completion_tokens: 1 });
  assert.equal(withTotal.tokens, 200);
  // negative numbers coerce to 0 (never negative usage).
  const neg = normalizeSpendLog({ spend: -3, total_tokens: -9 });
  assert.equal(neg.spend, 0);
  assert.equal(neg.tokens, 0);
});

test('normalizeSpendLogs: drops non-objects, tolerates non-arrays', () => {
  assert.deepEqual(normalizeSpendLogs('nope'), []);
  assert.deepEqual(normalizeSpendLogs(null), []);
  const rows = normalizeSpendLogs([{ model: 'a' }, null, 42, { model: 'b' }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.model), ['a', 'b']);
});

// A small fixture: two models, two keys, spread across the last 24h.
function fixture(): SpendLogRow[] {
  return normalizeSpendLogs([
    {
      model: 'qwen',
      api_key: 'sk-aaaa1111',
      total_tokens: 100,
      prompt_tokens: 60,
      completion_tokens: 40,
      spend: 0,
      startTime: new Date(NOW - 2 * HOUR).toISOString(),
      metadata: { user_api_key_alias: 'team-tax' },
    },
    {
      model: 'qwen',
      api_key: 'sk-bbbb2222',
      total_tokens: 300,
      prompt_tokens: 200,
      completion_tokens: 100,
      spend: 0,
      startTime: new Date(NOW - 3 * HOUR).toISOString(),
      metadata: { user_api_key_alias: 'team-audit' },
    },
    {
      model: 'gpt-4o-mini',
      api_key: 'sk-aaaa1111',
      total_tokens: 50,
      prompt_tokens: 30,
      completion_tokens: 20,
      spend: 0.0025,
      startTime: new Date(NOW - 5 * HOUR).toISOString(),
      metadata: { user_api_key_alias: 'team-tax' },
    },
  ]);
}

test('aggregateByModel: buckets tokens+spend, sorts by spend then tokens', () => {
  const byModel = aggregateByModel(fixture());
  assert.equal(byModel.length, 2);
  // gpt-4o-mini has spend > 0 so it sorts first despite fewer tokens.
  assert.equal(byModel[0].model, 'gpt-4o-mini');
  assert.equal(byModel[0].spend, 0.0025);
  assert.equal(byModel[0].requests, 1);
  assert.equal(byModel[0].tokens, 50);
  assert.equal(byModel[1].model, 'qwen');
  assert.equal(byModel[1].requests, 2);
  assert.equal(byModel[1].tokens, 400);
  assert.equal(byModel[1].promptTokens, 260);
  assert.equal(byModel[1].completionTokens, 140);
  assert.equal(byModel[1].spend, 0);
});

test('aggregateByModel: on all-free traffic, tokens break the tie (ordering by volume)', () => {
  const rows = normalizeSpendLogs([
    { model: 'small', total_tokens: 10, spend: 0 },
    { model: 'big', total_tokens: 900, spend: 0 },
  ]);
  const byModel = aggregateByModel(rows);
  assert.deepEqual(byModel.map((m) => m.model), ['big', 'small']);
});

test('aggregateByKey: alias-first identity, unattributed fallback', () => {
  const byKey = aggregateByKey(fixture());
  const tax = byKey.find((k) => k.key === 'team-tax');
  const audit = byKey.find((k) => k.key === 'team-audit');
  assert.ok(tax && audit);
  assert.equal(tax.requests, 2); // qwen + gpt on the same alias
  assert.equal(tax.tokens, 150);
  assert.equal(tax.spend, 0.0025);
  assert.equal(tax.keyAlias, 'team-tax');
  assert.equal(audit.requests, 1);
  assert.equal(audit.tokens, 300);
  // rows without an alias fall back to masked token, then '(unattributed)'.
  const anon = aggregateByKey(
    normalizeSpendLogs([{ model: 'm', total_tokens: 1 }, { model: 'm', api_key: 'sk-zzzz9999', total_tokens: 1 }]),
  );
  assert.ok(anon.some((k) => k.key === '(unattributed)'));
  assert.ok(anon.some((k) => k.key === '…9999'));
});

test('aggregateTimeSeries: fixed length, zero-filled, correct bucket placement', () => {
  const w = parseWindow('24h', NOW);
  const series = aggregateTimeSeries(fixture(), w);
  assert.equal(series.length, 24);
  // Every bucket present and chronologically ordered.
  for (let i = 1; i < series.length; i += 1) {
    assert.ok(series[i].bucketStart > series[i - 1].bucketStart);
  }
  // Total across buckets equals the fixture totals (nothing dropped inside the window).
  const totalReq = series.reduce((s, b) => s + b.requests, 0);
  const totalTokens = series.reduce((s, b) => s + b.tokens, 0);
  assert.equal(totalReq, 3);
  assert.equal(totalTokens, 450);
});

test('aggregateTimeSeries: drops rows outside the window and without a timestamp', () => {
  const w = parseWindow('24h', NOW);
  const rows = normalizeSpendLogs([
    { model: 'm', total_tokens: 5, startTime: new Date(NOW - 48 * HOUR).toISOString() }, // too old
    { model: 'm', total_tokens: 7 }, // no timestamp
    { model: 'm', total_tokens: 9, startTime: new Date(NOW - HOUR).toISOString() }, // in-window
  ]);
  const series = aggregateTimeSeries(rows, w);
  const totalTokens = series.reduce((s, b) => s + b.tokens, 0);
  assert.equal(totalTokens, 9);
  // The single in-window row lands in the last bucket.
  assert.equal(series[series.length - 1].tokens, 9);
});

test('summarize: totals + averages; allFree only with $0 traffic', () => {
  const s = summarize(fixture());
  assert.equal(s.requests, 3);
  assert.equal(s.tokens, 450);
  assert.equal(s.spend, 0.0025);
  assert.equal(s.avgTokensPerRequest, 150);
  assert.ok(Math.abs(s.avgCostPerRequest - 0.0025 / 3) < 1e-12);
  assert.equal(s.allFree, false); // one row cost money

  const free = summarize(normalizeSpendLogs([{ model: 'm', total_tokens: 5, spend: 0 }]));
  assert.equal(free.allFree, true);

  const empty = summarize([]);
  assert.equal(empty.requests, 0);
  assert.equal(empty.avgTokensPerRequest, 0);
  assert.equal(empty.avgCostPerRequest, 0);
  assert.equal(empty.allFree, false); // no traffic ⇒ not "all free"
});

test('assembleSpendView: composes the full view; carries flags + defaults aggregates', () => {
  const w = parseWindow('7d', NOW);
  const view = assembleSpendView(fixture(), w, { configured: true, live: true });
  assert.equal(view.configured, true);
  assert.equal(view.live, true);
  assert.equal(view.window.range, '7d');
  assert.equal(view.summary.requests, 3);
  assert.equal(view.byModel.length, 2);
  assert.equal(view.byKey.length, 2);
  assert.equal(view.timeSeries.length, 7);
  assert.equal(view.aggregates.globalSpendKeys.available, false);
  assert.equal(view.aggregates.globalSpendModels.available, false);
  assert.equal(view.error, undefined);

  const withAgg = assembleSpendView([], w, {
    configured: true,
    live: false,
    error: 'proxy down',
    aggregates: {
      globalSpendKeys: { available: true },
      globalSpendModels: { available: false, reason: '404' },
    },
  });
  assert.equal(withAgg.error, 'proxy down');
  assert.equal(withAgg.aggregates.globalSpendKeys.available, true);
  assert.equal(withAgg.aggregates.globalSpendModels.reason, '404');
  assert.equal(withAgg.summary.requests, 0);
});

test('assembleSpendView: unconfigured proxy → safe empty view', () => {
  const w = parseWindow('24h', NOW);
  const view = assembleSpendView([], w, { configured: false, live: false });
  assert.equal(view.configured, false);
  assert.equal(view.live, false);
  assert.deepEqual(view.byModel, []);
  assert.deepEqual(view.byKey, []);
  assert.equal(view.summary.requests, 0);
});
