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

// ─── branch-completeness edges (both arms of every gate) ─────────────────────────────────────────
test('isValidTimezone: nullish input is false (the `tz ?? ""` arm)', () => {
  assert.equal(isValidTimezone(null as unknown as string), false);
  assert.equal(isValidTimezone(undefined as unknown as string), false);
});

test('expandCron: nullish spec → null (the `spec ?? ""` arm); a CRON_TZ prefix is stripped', () => {
  assert.equal(expandCron(null as unknown as string), null);
  assert.equal(expandCron(undefined as unknown as string), null);
  // CRON_TZ=/TZ= prefix is stripped before parsing (I/O syntax tolerated by the evaluator).
  assert.ok(expandCron('CRON_TZ=Asia/Kolkata 0 9 * * *'));
  assert.ok(expandCron('TZ=UTC @daily'));
});

test('expandCron: 7 means Sunday in the dow field, folded to 0 (standard-cron spelling)', () => {
  // Both 0 and 7 mean Sunday in standard cron. A bare "7" folds to 0; a range "5-7" folds its 7→0.
  const bare = expandCron('0 0 * * 7')!;
  assert.ok(bare.dow.has(0) && bare.dow.size === 1, 'bare 7 → {0}');
  const range = expandCron('0 0 * * 5-7')!;
  assert.ok(range.dow.has(5) && range.dow.has(6) && range.dow.has(0), '5-7 covers Fri, Sat, Sunday(0)');
});

test('nextFireTimes: a dow=7 (Sunday) schedule fires on Sundays', () => {
  // 2026-03-01 is a Sunday. "0 0 * * 7" (Sunday midnight UTC) → the 1st, 8th, 15th.
  const from = new Date('2026-02-28T00:00:00.000Z');
  const fires = nextFireTimes({ cron: '0 0 * * 7', timezone: 'UTC', enabled: true }, 2, from);
  assert.deepEqual(fires, ['2026-03-01T00:00:00.000Z', '2026-03-08T00:00:00.000Z']);
});

test('nextFireTimes: dom-only cron fires by day-of-month regardless of weekday (AND-side, dow "*")', () => {
  // "0 0 15 * *" — midnight on the 15th. dom restricted, dow '*' → domMatch && dowMatch (dowMatch true).
  const from = new Date('2026-03-01T00:00:00.000Z');
  const fires = nextFireTimes({ cron: '0 0 15 * *', timezone: 'UTC', enabled: true }, 2, from);
  assert.deepEqual(fires, ['2026-03-15T00:00:00.000Z', '2026-04-15T00:00:00.000Z']);
});

test('nextFireTimes: dom AND dow both restricted → fires on EITHER (standard-cron OR semantics)', () => {
  // "0 0 13 * 5" — the 13th OR any Friday, at midnight UTC. March 2026: Fri 6th, then the 13th
  // (both the 13th AND a Friday), then Fri 20th. Proves the OR branch (domAndDowRestricted).
  const from = new Date('2026-03-01T00:00:00.000Z');
  const fires = nextFireTimes({ cron: '0 0 13 * 5', timezone: 'UTC', enabled: true }, 3, from);
  assert.deepEqual(fires, [
    '2026-03-06T00:00:00.000Z',
    '2026-03-13T00:00:00.000Z',
    '2026-03-20T00:00:00.000Z',
  ]);
});

test('nextFireTimes: a never-matching spec (Feb 30th) returns [] within the bounded horizon', () => {
  // Feb 30th never exists → the minute-walker exhausts its ~400-day bound and returns nothing.
  const from = new Date('2026-01-01T00:00:00.000Z');
  const fires = nextFireTimes({ cron: '0 0 30 2 *', timezone: 'UTC', enabled: true }, 1, from);
  assert.deepEqual(fires, []);
});

test('nextFireTimes: midnight fires correctly (the Intl hour "24"→0 normalization)', () => {
  // "@daily" is 0 0 * * * — a midnight fire exercises the `hour === 24 ? 0` guard for zones/locales
  // where Intl emits "24" for 00:00.
  const from = new Date('2026-03-01T05:00:00.000Z');
  const fires = nextFireTimes({ cron: '@daily', timezone: 'UTC', enabled: true }, 1, from);
  assert.equal(fires[0], '2026-03-02T00:00:00.000Z');
});
