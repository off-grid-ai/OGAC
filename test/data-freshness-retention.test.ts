import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateFreshness,
  summarizeFreshness,
} from '../src/lib/data-freshness.ts';
import { evaluateRetention, normalizeRetentionAction } from '../src/lib/data-retention.ts';

// PURE unit tests for the freshness-SLA + retention evaluators. `now` is injected so the rules are
// deterministic. A silent bad sync must be LOUD (broken); a fresh one quiet.

const NOW = new Date('2026-07-08T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

test('freshness: within SLA is fresh, past SLA is stale', () => {
  const fresh = evaluateFreshness({ freshnessSlaHours: 24, lastRefreshAt: hoursAgo(3) }, NOW);
  assert.equal(fresh.state, 'fresh');
  assert.equal(fresh.alerting, false);
  assert.equal(fresh.ageHours, 3);

  const stale = evaluateFreshness({ freshnessSlaHours: 24, lastRefreshAt: hoursAgo(48) }, NOW);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.alerting, true);
});

test('freshness: a failed sync is BROKEN even if within SLA', () => {
  const r = evaluateFreshness(
    { freshnessSlaHours: 24, lastRefreshAt: hoursAgo(1), syncStatus: 'failed' },
    NOW,
  );
  assert.equal(r.state, 'broken');
  assert.equal(r.alerting, true);
});

test('freshness: no SLA short-circuits to no-sla (not alerting)', () => {
  const r = evaluateFreshness({ freshnessSlaHours: 0, lastRefreshAt: hoursAgo(999) }, NOW);
  assert.equal(r.state, 'no-sla');
  assert.equal(r.alerting, false);
});

test('freshness: never refreshed under an SLA is unknown (waiting on first sync)', () => {
  const r = evaluateFreshness({ freshnessSlaHours: 24, lastRefreshAt: null }, NOW);
  assert.equal(r.state, 'unknown');
  assert.equal(r.alerting, false);
});

test('summarizeFreshness: counts states + total alerting', () => {
  const s = summarizeFreshness([
    evaluateFreshness({ freshnessSlaHours: 24, lastRefreshAt: hoursAgo(1) }, NOW),
    evaluateFreshness({ freshnessSlaHours: 24, lastRefreshAt: hoursAgo(48) }, NOW),
    evaluateFreshness({ freshnessSlaHours: 24, lastRefreshAt: hoursAgo(1), syncStatus: 'failed' }, NOW),
    evaluateFreshness({ freshnessSlaHours: 0, lastRefreshAt: null }, NOW),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.fresh, 1);
  assert.equal(s.stale, 1);
  assert.equal(s.broken, 1);
  assert.equal(s.noSla, 1);
  assert.equal(s.alerting, 2, 'stale + broken alert');
});

test('retention: within window is active, past window is due for disposal', () => {
  const active = evaluateRetention({ retainDays: 90, anchorAt: daysAgo(30) }, NOW);
  assert.equal(active.state, 'active');
  assert.equal(active.dueForDisposal, false);
  assert.equal(active.daysRemaining, 60);

  const due = evaluateRetention({ retainDays: 90, anchorAt: daysAgo(120), action: 'anonymize' }, NOW);
  assert.equal(due.state, 'due');
  assert.equal(due.dueForDisposal, true);
  assert.equal(due.action, 'anonymize');
});

test('retention: legal hold overrides everything (never due)', () => {
  const r = evaluateRetention({ retainDays: 1, anchorAt: daysAgo(365), legalHold: true }, NOW);
  assert.equal(r.state, 'held');
  assert.equal(r.dueForDisposal, false);
});

test('retention: 0 days = indefinite (kept, not due)', () => {
  const r = evaluateRetention({ retainDays: 0, anchorAt: daysAgo(9999) }, NOW);
  assert.equal(r.state, 'indefinite');
  assert.equal(r.dueForDisposal, false);
});

test('normalizeRetentionAction: unknown → delete', () => {
  assert.equal(normalizeRetentionAction('archive'), 'archive');
  assert.equal(normalizeRetentionAction('ANONYMIZE'), 'anonymize');
  assert.equal(normalizeRetentionAction('nonsense'), 'delete');
});
