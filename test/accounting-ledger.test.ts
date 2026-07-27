import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLedgerAccounting,
  chooseAccounting,
  foldAttributed,
  foldByModel,
  hasAttributedSpend,
  type LedgerGroupRow,
} from '../src/lib/accounting-ledger.ts';
import { emptyAccounting } from '../src/lib/accounting-aggs.ts';

// Phase 4.11 wants spend per user / per project / per model. The gateway index has the right shape
// but cannot attribute governed runs today (caller="node", no org). The audit ledger now can, so the
// rollup reads that instead — without touching the ~10 gateway call sites.

const RANGE = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-27T00:00:00.000Z' };

const row = (over: Partial<LedgerGroupRow> = {}): LedgerGroupRow => ({
  label: 'priya@bank.example',
  model: 'gpt-4o',
  requests: 1,
  promptTokens: 100,
  completionTokens: 20,
  tokens: 120,
  costUsd: 0.001,
  ...over,
});

test('spend is attributed per user with the per-model split behind it', () => {
  const [priya] = foldAttributed([
    row({ model: 'gpt-4o', requests: 2, tokens: 200, costUsd: 0.004 }),
    row({ model: 'gemma-local', requests: 5, tokens: 5000, costUsd: 0 }),
  ]);

  assert.equal(priya.label, 'priya@bank.example');
  assert.equal(priya.requests, 7);
  assert.equal(priya.tokens, 5200);
  assert.equal(priya.costUsd, 0.004);
  assert.deepEqual(
    priya.byModel.map((m) => m.model),
    ['gpt-4o', 'gemma-local'],
    'the costliest model first',
  );
});

test('cost is summed from the ledger, never re-priced from combined tokens', () => {
  // Each row was priced with the model that actually served it. Re-pricing a user's combined token
  // total would mix a local model's zero rate with a cloud rate and disagree with the per-run ledger.
  const [user] = foldAttributed([
    row({ model: 'gemma-local', tokens: 100000, costUsd: 0 }),
    row({ model: 'gpt-4o', tokens: 1000, costUsd: 0.02 }),
  ]);
  assert.equal(user.tokens, 101000);
  assert.equal(user.costUsd, 0.02, 'the 100k local tokens must not be priced at the cloud rate');
});

test('the biggest spender is listed first', () => {
  const folded = foldAttributed([
    row({ label: 'small@bank.example', costUsd: 0.001, tokens: 10 }),
    row({ label: 'big@bank.example', costUsd: 5, tokens: 900 }),
    row({ label: 'mid@bank.example', costUsd: 0.5, tokens: 400 }),
  ]);
  assert.deepEqual(folded.map((f) => f.label), [
    'big@bank.example',
    'mid@bank.example',
    'small@bank.example',
  ]);
});

test('a missing actor or model is labelled, not dropped', () => {
  const folded = foldAttributed([row({ label: null }), row({ label: '   ' })]);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].label, '(unattributed)');
  assert.equal(folded[0].requests, 2, 'both rows still counted');

  assert.equal(foldByModel([row({ model: null })])[0].model, '(unknown)');
});

test('the per-model total ignores who spent it', () => {
  const models = foldByModel([
    row({ label: 'a@x.example', model: 'gpt-4o', tokens: 100, costUsd: 0.01, requests: 1 }),
    row({ label: 'b@x.example', model: 'gpt-4o', tokens: 300, costUsd: 0.03, requests: 2 }),
  ]);
  assert.equal(models.length, 1);
  assert.equal(models[0].tokens, 400);
  assert.equal(models[0].requests, 3);
  assert.equal(models[0].costUsd, 0.04);
});

test('org totals come from the actor rollup, so project-less calls are not lost', () => {
  // Project is optional on an audit event; totalling the project rollup would silently drop every
  // call that had no project and understate org spend.
  const actorRows = [
    row({ label: 'a@x.example', tokens: 100, costUsd: 0.01 }),
    row({ label: 'b@x.example', tokens: 900, costUsd: 0.09 }),
  ];
  const projectRows = [row({ label: 'retail-kyc', tokens: 100, costUsd: 0.01 })];

  const view = buildLedgerAccounting(actorRows, projectRows, RANGE);
  assert.equal(view.totals.tokens, 1000);
  assert.equal(view.totals.costUsd, 0.1);
  assert.equal(view.byActor.length, 2);
  assert.equal(view.byProject.length, 1);
  assert.deepEqual(view.range, RANGE);
});

// ─── which source to believe ──────────────────────────────────────────────────────────────────────

test('the ledger wins whenever it can attribute spend', () => {
  const ledger = buildLedgerAccounting([row({ label: 'priya@bank.example' })], [], RANGE);
  const index = buildLedgerAccounting([row({ label: null, tokens: 9999 })], [], RANGE);

  const chosen = chooseAccounting(ledger, index);
  assert.equal(chosen.source, 'ledger');
  assert.equal(chosen.accounting.byActor[0].label, 'priya@bank.example');
});

test('the gateway index is used when only it can attribute', () => {
  const ledger = emptyAccounting(RANGE);
  const index = buildLedgerAccounting([row({ label: 'someone@x.example' })], [], RANGE);

  assert.equal(chooseAccounting(ledger, index).source, 'gateway-index');
});

test('unattributed traffic is explained, not rendered as a confident zero', () => {
  // The real state today: the gateway saw traffic but stamped no caller. An operator must be told
  // that, rather than shown an empty table that reads as "nobody spent anything".
  const ledger = emptyAccounting(RANGE);
  const index = buildLedgerAccounting([row({ label: null, tokens: 5000, costUsd: 1.25 })], [], RANGE);

  const chosen = chooseAccounting(ledger, index);
  assert.equal(chosen.source, 'gateway-index');
  assert.match(chosen.note ?? '', /not attributed to a user/);
  assert.equal(chosen.accounting.totals.tokens, 5000, 'the spend itself is still shown');
});

test('genuinely no data reports none, with no misleading note', () => {
  const chosen = chooseAccounting(emptyAccounting(RANGE), emptyAccounting(RANGE));
  assert.equal(chosen.source, 'none');
  assert.equal(chosen.note, undefined);
});

test('an all-unattributed rollup does not count as attributed', () => {
  assert.equal(hasAttributedSpend(buildLedgerAccounting([row({ label: null })], [], RANGE)), false);
  assert.equal(hasAttributedSpend(buildLedgerAccounting([row()], [], RANGE)), true);
  assert.equal(hasAttributedSpend(emptyAccounting(RANGE)), false);
});

test('a zero-cost local-model user still counts as attributed', () => {
  // On-prem models are free; "attributed" must mean "we know who", not "it cost money", or every
  // fully-local tenant would look unattributed.
  const ledger = buildLedgerAccounting(
    [row({ label: 'priya@bank.example', model: 'gemma-local', tokens: 4000, costUsd: 0 })],
    [],
    RANGE,
  );
  assert.equal(hasAttributedSpend(ledger), true);
  assert.equal(chooseAccounting(ledger, emptyAccounting(RANGE)).source, 'ledger');
});
