import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSchedulesView,
  isValidCron,
  sanitizeScheduleId,
  scheduleRunIdSeed,
  shapeSchedule,
  toScheduleSpec,
} from '../src/lib/temporal-schedules.ts';

// Pure-logic tests for Temporal schedule validation + shaping — no cluster, no mocks.

test('isValidCron: accepts 5/6-field cron + @macros, rejects garbage', () => {
  assert.equal(isValidCron('0 9 * * *'), true);
  assert.equal(isValidCron('0 0 9 * * *'), true); // 6-field (seconds)
  assert.equal(isValidCron('@daily'), true);
  assert.equal(isValidCron('@hourly'), true);
  assert.equal(isValidCron('CRON_TZ=America/New_York 0 9 * * *'), true);
  assert.equal(isValidCron(''), false);
  assert.equal(isValidCron('   '), false);
  assert.equal(isValidCron('0 9 *'), false); // too few fields
  assert.equal(isValidCron('@nonsense'), false);
});

test('sanitizeScheduleId: keeps id charset URL/Temporal-safe', () => {
  assert.equal(sanitizeScheduleId('my schedule/x'), 'my-schedule-x');
  assert.equal(sanitizeScheduleId('--edge--'), 'edge');
  assert.equal(sanitizeScheduleId('good.id_1-2'), 'good.id_1-2');
});

test('toScheduleSpec: validates required fields', () => {
  assert.throws(() => toScheduleSpec({ query: 'q', cron: '0 9 * * *' }), /agentId required/);
  assert.throws(() => toScheduleSpec({ agentId: 'a', cron: '0 9 * * *' }), /query required/);
  assert.throws(() => toScheduleSpec({ agentId: 'a', query: 'q', cron: 'bad' }), /valid cron/);
});

test('toScheduleSpec: normalizes + defaults + auto-generates id', () => {
  const spec = toScheduleSpec({
    agentId: 'support',
    query: 'summarize overnight tickets',
    cron: '0 9 * * *',
    caller: 'ops@x.io',
    requireReview: true,
    orgId: 'org_1',
    note: 'daily brief',
  });
  assert.equal(spec.input.agentId, 'support');
  assert.equal(spec.input.query, 'summarize overnight tickets');
  assert.equal(spec.input.caller, 'ops@x.io');
  assert.equal(spec.input.requireReview, true);
  assert.equal(spec.input.orgId, 'org_1');
  assert.equal(spec.cron, '0 9 * * *');
  assert.equal(spec.note, 'daily brief');
  assert.equal(spec.paused, false);
  assert.ok(spec.scheduleId.startsWith('agentsched-support-'), spec.scheduleId);
  // Explicit id is honored + sanitized.
  const withId = toScheduleSpec({ agentId: 'a', query: 'q', cron: '@daily', scheduleId: 'my sched' });
  assert.equal(withId.scheduleId, 'my-sched');
});

test('scheduleRunIdSeed: stable per schedule', () => {
  assert.equal(scheduleRunIdSeed('sched-x'), 'sched_sched-x');
});

test('shapeSchedule: maps raw description to JSON-safe row', () => {
  const row = shapeSchedule({
    scheduleId: 'agentsched-a-1',
    paused: true,
    note: 'brief',
    cronExpressions: ['0 9 * * *'],
    workflowType: 'AgentRunWorkflow',
    recentActions: [new Date('2026-01-01T09:00:00.000Z')],
    nextActions: ['2026-01-02T09:00:00.000Z'],
    numActionsTaken: 5n,
  });
  assert.equal(row.scheduleId, 'agentsched-a-1');
  assert.equal(row.paused, true);
  assert.deepEqual(row.cron, ['0 9 * * *']);
  assert.equal(row.workflowType, 'AgentRunWorkflow');
  assert.deepEqual(row.recentActions, ['2026-01-01T09:00:00.000Z']);
  assert.deepEqual(row.nextActions, ['2026-01-02T09:00:00.000Z']);
  assert.equal(row.numActionsTaken, 5);
});

test('buildSchedulesView: shapes list + carries flags/note', () => {
  const view = buildSchedulesView([{ scheduleId: 's1' }], { configured: true, reachable: true });
  assert.equal(view.object, 'temporal_schedules');
  assert.equal(view.configured, true);
  assert.equal(view.schedules.length, 1);
  assert.equal(view.schedules[0].scheduleId, 's1');
  assert.equal(view.schedules[0].paused, false);

  const empty = buildSchedulesView([], { configured: false, reachable: false, note: 'not enabled' });
  assert.deepEqual(empty.schedules, []);
  assert.equal(empty.note, 'not enabled');
});
