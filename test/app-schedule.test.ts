import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildScheduleView,
  DEFAULT_TIMEZONE,
  describeSchedule,
  expandCron,
  isValidTimezone,
  nextFireTimes,
  normalizeScheduleConfig,
  SCHEDULE_PRESETS,
  validateScheduleConfig,
  type ScheduleConfig,
} from '../src/lib/app-schedule.ts';

// ─── isValidTimezone ──────────────────────────────────────────────────────────────────────────────
test('isValidTimezone: UTC + a real IANA zone pass; junk + empty fail', () => {
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('utc'), true);
  assert.equal(isValidTimezone('Asia/Kolkata'), true);
  assert.equal(isValidTimezone('America/New_York'), true);
  assert.equal(isValidTimezone('Mars/Phobos'), false);
  assert.equal(isValidTimezone(''), false);
  assert.equal(isValidTimezone('   '), false);
});

// ─── normalizeScheduleConfig ───────────────────────────────────────────────────────────────────────
test('normalizeScheduleConfig: reads cron aliases + defaults tz to UTC + enabled defaults true', () => {
  assert.deepEqual(normalizeScheduleConfig({ cron: '0 9 * * 1' }), {
    cron: '0 9 * * 1',
    timezone: 'UTC',
    enabled: true,
  });
  assert.equal(normalizeScheduleConfig({ schedule: '@daily' }).cron, '@daily');
  assert.equal(normalizeScheduleConfig({ expression: '*/5 * * * *' }).cron, '*/5 * * * *');
});

test('normalizeScheduleConfig: invalid tz falls back to UTC; explicit enabled:false disables', () => {
  const cfg = normalizeScheduleConfig({ cron: '@daily', timezone: 'Nowhere/Land', enabled: false });
  assert.equal(cfg.timezone, DEFAULT_TIMEZONE);
  assert.equal(cfg.enabled, false);
});

test('normalizeScheduleConfig: empty/absent config → empty cron (the not-yet-configured dead-end)', () => {
  assert.equal(normalizeScheduleConfig(undefined).cron, '');
  assert.equal(normalizeScheduleConfig(null).cron, '');
  assert.equal(normalizeScheduleConfig({}).cron, '');
  assert.equal(normalizeScheduleConfig({ cron: 42 as unknown as string }).cron, '');
});

// ─── validateScheduleConfig ────────────────────────────────────────────────────────────────────────
test('validateScheduleConfig: a valid cron + tz is ok', () => {
  const v = validateScheduleConfig({ cron: '0 9 * * 1', timezone: 'Asia/Kolkata', enabled: true });
  assert.equal(v.ok, true);
  assert.equal(v.reason, '');
});

test('validateScheduleConfig: empty cron is rejected with a plain-language reason (dead-end honesty)', () => {
  const v = validateScheduleConfig({ cron: '', timezone: 'UTC', enabled: true });
  assert.equal(v.ok, false);
  assert.match(v.reason, /No schedule set/i);
});

test('validateScheduleConfig: a malformed cron is rejected with the offending value', () => {
  const v = validateScheduleConfig({ cron: 'not a cron', timezone: 'UTC', enabled: true });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not a valid schedule/i);
});

test('validateScheduleConfig: an invalid timezone is rejected', () => {
  // A valid cron but a bad tz (normalize would fix it, but validate guards the raw path too).
  const v = validateScheduleConfig({ cron: '@daily', timezone: 'Bad/Zone', enabled: true });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not a known timezone/i);
});

// ─── describeSchedule ──────────────────────────────────────────────────────────────────────────────
test('describeSchedule: armed vs paused vs none', () => {
  assert.match(describeSchedule({ cron: '@daily', timezone: 'UTC', enabled: true }), /armed/);
  assert.match(describeSchedule({ cron: '@daily', timezone: 'UTC', enabled: false }), /paused/);
  assert.match(describeSchedule({ cron: '', timezone: 'UTC', enabled: true }), /No schedule set/);
});

// ─── expandCron (the evaluator internals) ────────────────────────────────────────────────────────
test('expandCron: macros expand; 6-field drops seconds; junk → null', () => {
  assert.ok(expandCron('@daily'));
  assert.ok(expandCron('0 0 30 0 0 0'.replace('30 0 0 0', '* * * *'))); // 6-field "0 0 * * * *"
  assert.equal(expandCron(''), null);
  assert.equal(expandCron('1 2 3'), null); // wrong field count
  assert.equal(expandCron('@notamacro'), null);
});

test('expandCron: ranges, lists, steps, and out-of-range rejection', () => {
  const f = expandCron('0,30 9-17 * * *')!;
  assert.ok(f.minute.has(0) && f.minute.has(30) && !f.minute.has(15));
  assert.ok(f.hour.has(9) && f.hour.has(17) && !f.hour.has(8));
  // step
  const s = expandCron('*/15 * * * *')!;
  assert.deepEqual([...s.minute].sort((a, b) => a - b), [0, 15, 30, 45]);
  // out of range
  assert.equal(expandCron('99 * * * *'), null);
  assert.equal(expandCron('* 25 * * *'), null);
  // bad step
  assert.equal(expandCron('*/0 * * * *'), null);
});

// ─── nextFireTimes (the real computation) ────────────────────────────────────────────────────────
test('nextFireTimes: computes the next daily-9am-UTC fires from a fixed instant', () => {
  const from = new Date('2026-03-01T00:00:00.000Z');
  const fires = nextFireTimes({ cron: '0 9 * * *', timezone: 'UTC', enabled: true }, 3, from);
  assert.deepEqual(fires, [
    '2026-03-01T09:00:00.000Z',
    '2026-03-02T09:00:00.000Z',
    '2026-03-03T09:00:00.000Z',
  ]);
});

test('nextFireTimes: honors the timezone — 9am Asia/Kolkata is 03:30 UTC', () => {
  const from = new Date('2026-03-01T00:00:00.000Z');
  const fires = nextFireTimes({ cron: '0 9 * * *', timezone: 'Asia/Kolkata', enabled: true }, 1, from);
  assert.equal(fires[0], '2026-03-01T03:30:00.000Z'); // IST is UTC+5:30
});

test('nextFireTimes: a weekday cron only fires on that weekday', () => {
  // 2026-03-02 is a Monday. "0 9 * * 1" (Mon 9am UTC) → the 2nd, then the 9th.
  const from = new Date('2026-03-01T00:00:00.000Z');
  const fires = nextFireTimes({ cron: '0 9 * * 1', timezone: 'UTC', enabled: true }, 2, from);
  assert.deepEqual(fires, ['2026-03-02T09:00:00.000Z', '2026-03-09T09:00:00.000Z']);
});

test('nextFireTimes: an invalid schedule yields no fires (caller shows the reason instead)', () => {
  assert.deepEqual(nextFireTimes({ cron: '', timezone: 'UTC', enabled: true }), []);
  assert.deepEqual(nextFireTimes({ cron: 'bad', timezone: 'UTC', enabled: true }), []);
});

// ─── buildScheduleView ─────────────────────────────────────────────────────────────────────────────
test('buildScheduleView: valid+enabled → previews fires; paused → no preview but valid', () => {
  const from = new Date('2026-03-01T00:00:00.000Z');
  const armed = buildScheduleView('app1', { cron: '0 9 * * *', timezone: 'UTC', enabled: true }, true, from);
  assert.equal(armed.valid, true);
  assert.equal(armed.nextFires.length, 3);
  assert.equal(armed.runtimeConfigured, true);

  const paused = buildScheduleView('app1', { cron: '0 9 * * *', timezone: 'UTC', enabled: false }, true, from);
  assert.equal(paused.valid, true);
  assert.deepEqual(paused.nextFires, []); // paused: not misleading the operator with fire times
  assert.match(paused.description, /paused/);
});

test('buildScheduleView: not-configured runner surfaces honestly on the view', () => {
  const v = buildScheduleView('app1', { cron: '@daily', timezone: 'UTC', enabled: true }, false);
  assert.equal(v.runtimeConfigured, false);
  assert.equal(v.object, 'app_schedule');
});

test('buildScheduleView: an unset schedule is invalid with the dead-end reason', () => {
  const v = buildScheduleView('app1', { cron: '', timezone: 'UTC', enabled: true }, true);
  assert.equal(v.valid, false);
  assert.match(v.reason, /No schedule set/);
  assert.deepEqual(v.nextFires, []);
});

// ─── presets are usable data ─────────────────────────────────────────────────────────────────────
test('SCHEDULE_PRESETS: every preset cron is itself valid', () => {
  for (const p of SCHEDULE_PRESETS) {
    const v = validateScheduleConfig({ cron: p.cron, timezone: 'UTC', enabled: true } satisfies ScheduleConfig);
    assert.equal(v.ok, true, `${p.cron} should be valid`);
  }
});
