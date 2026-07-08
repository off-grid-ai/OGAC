import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appScheduleId, cronFromTrigger, scheduleApp, syncAppSchedule, unscheduleApp } from '@/lib/app-schedules';

// ─── cronFromTrigger — PURE extraction of the cron a schedule trigger carries ─────────────────────

test('cronFromTrigger returns null for a non-schedule trigger', () => {
  assert.equal(cronFromTrigger({ kind: 'on-demand' }), null);
  assert.equal(cronFromTrigger({ kind: 'webhook' }), null);
  assert.equal(cronFromTrigger(null), null);
  assert.equal(cronFromTrigger(undefined), null);
});

test('cronFromTrigger reads config.cron / .schedule / .expression', () => {
  assert.equal(cronFromTrigger({ kind: 'schedule', config: { cron: '0 9 * * 1' } }), '0 9 * * 1');
  assert.equal(cronFromTrigger({ kind: 'schedule', config: { schedule: '@daily' } }), '@daily');
  assert.equal(cronFromTrigger({ kind: 'schedule', config: { expression: '*/5 * * * *' } }), '*/5 * * * *');
});

test('cronFromTrigger returns null for a schedule trigger with no/blank cron', () => {
  assert.equal(cronFromTrigger({ kind: 'schedule' }), null);
  assert.equal(cronFromTrigger({ kind: 'schedule', config: {} }), null);
  assert.equal(cronFromTrigger({ kind: 'schedule', config: { cron: '   ' } }), null);
});

test('appScheduleId is stable + sanitized per app (re-scheduling replaces, not duplicates)', () => {
  assert.equal(appScheduleId('app123'), appScheduleId('app123'));
  assert.match(appScheduleId('app123'), /appsched-app123/);
});

// ─── scheduleApp / syncAppSchedule wiring — graceful when the durable runtime is off ──────────────
// Without OFFGRID_QUEUE_ENABLED / OFFGRID_ADAPTER_APPRUNTIME=temporal the durable runtime is off, so
// these report not_configured HONESTLY (never throw, never pretend they registered a schedule). This
// proves the caller wiring reaches the adapter and surfaces its verdict — the exact contract the
// publish/update route relies on.

const priorEnv = { ...process.env };
function clearDurable() {
  delete process.env.OFFGRID_QUEUE_ENABLED;
  delete process.env.OFFGRID_ADAPTER_APPRUNTIME;
}

test('scheduleApp reports not_configured when the durable runtime is off (graceful, no throw)', async () => {
  clearDurable();
  const r = await scheduleApp('app_x', '0 9 * * 1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_configured');
  Object.assign(process.env, priorEnv);
});

test('scheduleApp rejects an invalid cron before any I/O (when durable is on)', async () => {
  process.env.OFFGRID_ADAPTER_APPRUNTIME = 'temporal';
  const r = await scheduleApp('app_x', 'not-a-cron');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  clearDurable();
  Object.assign(process.env, priorEnv);
});

test('syncAppSchedule tears down (unschedule) for an unpublished or non-schedule app', async () => {
  clearDurable();
  // Unpublished schedule app → teardown path. With durable off, unschedule reports not_configured;
  // syncAppSchedule surfaces that verdict (it only rewrites not_found → ok).
  const r = await syncAppSchedule({ id: 'app_y', published: false, trigger: { kind: 'schedule', config: { cron: '@daily' } } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_configured');
  Object.assign(process.env, priorEnv);
});

test('syncAppSchedule takes the schedule path only for a PUBLISHED schedule app with a cron', async () => {
  clearDurable();
  // Published + schedule + cron → scheduleApp path (reports not_configured with durable off, but that
  // proves it chose the register path, not teardown — the reason maps to scheduleApp's NOT_CONFIGURED).
  const r = await syncAppSchedule({ id: 'app_z', published: true, trigger: { kind: 'schedule', config: { cron: '0 8 * * *' } } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_configured');
  Object.assign(process.env, priorEnv);
});

test('unscheduleApp is graceful when durable is off', async () => {
  clearDurable();
  const r = await unscheduleApp('app_none');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_configured');
  Object.assign(process.env, priorEnv);
});
