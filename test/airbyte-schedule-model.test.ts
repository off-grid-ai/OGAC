import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCron,
  validateScheduleInput,
  buildScheduleData,
  applyScheduleToUpdate,
  pickConnectionUpdateFields,
  mapSyncModeChoice,
  classifySyncMode,
  applySyncModeToStream,
  normalizeConnectionDetail,
  buildScheduleUpdate,
  buildSyncModeUpdate,
  isTimeUnit,
  TIME_UNITS,
  SYNC_MODE_CHOICES,
  CRON_PRESETS,
} from '../src/lib/airbyte-schedule-model.ts';

const RAW_CONN = {
  connectionId: 'conn-1',
  name: 'CoreBank → Lake',
  sourceId: 'src-1',
  status: 'active',
  scheduleType: 'manual',
  syncCatalog: {
    streams: [
      {
        stream: { name: 'loan_accounts' },
        config: {
          syncMode: 'incremental',
          destinationSyncMode: 'append',
          cursorField: ['updated_at'],
          primaryKey: [['loan_id']],
        },
      },
      { stream: { name: 'branches' }, config: { syncMode: 'full_refresh', destinationSyncMode: 'overwrite' } },
    ],
  },
};

// ─── validateCron ─────────────────────────────────────────────────────────────
test('validateCron accepts 6- and 7-field Quartz expressions', () => {
  assert.equal(validateCron('0 0 * * * ?'), true);
  assert.equal(validateCron('0 0 6 ? * MON-FRI'), true);
  assert.equal(validateCron('0 15 10 ? * 6L 2025'), true); // 7 fields
});

test('validateCron rejects bad field counts, empty, and non-strings', () => {
  assert.equal(validateCron('* * * *'), false); // 4 fields
  assert.equal(validateCron('0 0 * * * ? 2025 extra'), false); // 8 fields
  assert.equal(validateCron(''), false);
  assert.equal(validateCron('   '), false);
  assert.equal(validateCron(42), false);
  assert.equal(validateCron(null), false);
  assert.equal(validateCron('0 0 * * * ;'), false); // illegal char
});

// ─── validateScheduleInput ──────────────────────────────────────────────────
test('validateScheduleInput: manual is always ok', () => {
  assert.deepEqual(validateScheduleInput({ type: 'manual' }), { ok: true, errors: [] });
});

test('validateScheduleInput: basic requires positive int units + valid time unit', () => {
  assert.equal(validateScheduleInput({ type: 'basic', units: 6, timeUnit: 'hours' }).ok, true);
  const bad = validateScheduleInput({ type: 'basic', units: 0, timeUnit: 'fortnights' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
  assert.equal(validateScheduleInput({ type: 'basic', units: 1.5, timeUnit: 'hours' }).ok, false);
  assert.equal(validateScheduleInput({ type: 'basic', units: -3, timeUnit: 'days' }).ok, false);
});

test('validateScheduleInput: cron requires a valid expression', () => {
  assert.equal(validateScheduleInput({ type: 'cron', cronExpression: '0 0 2 * * ?' }).ok, true);
  assert.equal(validateScheduleInput({ type: 'cron', cronExpression: 'nope' }).ok, false);
});

test('validateScheduleInput: unknown type is an error', () => {
  const r = validateScheduleInput({ type: 'weird' as unknown as 'manual' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /unknown schedule type/);
});

test('isTimeUnit and TIME_UNITS', () => {
  assert.equal(isTimeUnit('hours'), true);
  assert.equal(isTimeUnit('years'), false);
  assert.equal(isTimeUnit(7), false);
  assert.ok(TIME_UNITS.includes('months'));
});

// ─── buildScheduleData ────────────────────────────────────────────────────────
test('buildScheduleData: manual carries no scheduleData', () => {
  assert.deepEqual(buildScheduleData({ type: 'manual' }), { scheduleType: 'manual' });
});

test('buildScheduleData: basic + cron shapes', () => {
  assert.deepEqual(buildScheduleData({ type: 'basic', units: 6, timeUnit: 'hours' }), {
    scheduleType: 'basic',
    scheduleData: { basicSchedule: { timeUnit: 'hours', units: 6 } },
  });
  assert.deepEqual(buildScheduleData({ type: 'cron', cronExpression: ' 0 0 2 * * ? ' }), {
    scheduleType: 'cron',
    scheduleData: { cron: { cronExpression: '0 0 2 * * ?', cronTimeZone: 'UTC' } },
  });
  assert.deepEqual(
    buildScheduleData({ type: 'cron', cronExpression: '0 0 2 * * ?', cronTimeZone: 'Asia/Kolkata' }),
    { scheduleType: 'cron', scheduleData: { cron: { cronExpression: '0 0 2 * * ?', cronTimeZone: 'Asia/Kolkata' } } },
  );
});

// ─── pickConnectionUpdateFields ────────────────────────────────────────────────
test('pickConnectionUpdateFields drops read-only fields and requires connectionId', () => {
  const read = {
    connectionId: 'conn-1',
    name: 'CoreBank → Lake',
    sourceId: 'src-1', // read-only — must be dropped
    destinationId: 'dst-1', // read-only — must be dropped
    isSyncing: true, // read-only
    breakingChange: false, // read-only
    scheduleType: 'manual',
    status: 'active',
    syncCatalog: { streams: [] },
  };
  const upd = pickConnectionUpdateFields(read);
  assert.ok(upd);
  assert.equal(upd!.connectionId, 'conn-1');
  assert.equal(upd!.name, 'CoreBank → Lake');
  assert.equal(upd!.status, 'active');
  assert.ok(!('sourceId' in upd!));
  assert.ok(!('destinationId' in upd!));
  assert.ok(!('isSyncing' in upd!));
  assert.ok(!('breakingChange' in upd!));
});

test('pickConnectionUpdateFields returns null on missing id / non-object', () => {
  assert.equal(pickConnectionUpdateFields({ name: 'x' }), null);
  assert.equal(pickConnectionUpdateFields({ connectionId: '' }), null);
  assert.equal(pickConnectionUpdateFields(null), null);
  assert.equal(pickConnectionUpdateFields('nope'), null);
  assert.equal(pickConnectionUpdateFields([1, 2]), null);
});

// ─── applyScheduleToUpdate ──────────────────────────────────────────────────
test('applyScheduleToUpdate sets fields immutably and strips legacy schedule', () => {
  const base = {
    connectionId: 'c1',
    schedule: { units: 24, timeUnit: 'hours' }, // legacy — must be removed
    scheduleType: 'basic',
    scheduleData: { basicSchedule: { timeUnit: 'hours', units: 24 } },
  };
  const out = applyScheduleToUpdate(base, { type: 'manual' });
  assert.equal(out.scheduleType, 'manual');
  assert.ok(!('scheduleData' in out));
  assert.ok(!('schedule' in out));
  // input untouched (immutability)
  assert.equal(base.scheduleType, 'basic');
  assert.ok('schedule' in base);

  const cron = applyScheduleToUpdate(base, { type: 'cron', cronExpression: '0 0 2 * * ?' });
  assert.equal(cron.scheduleType, 'cron');
  assert.deepEqual(cron.scheduleData, {
    cron: { cronExpression: '0 0 2 * * ?', cronTimeZone: 'UTC' },
  });
  assert.ok(!('schedule' in cron));
});

// ─── sync mode mapping ────────────────────────────────────────────────────────
test('mapSyncModeChoice ↔ classifySyncMode round-trips every choice', () => {
  for (const choice of SYNC_MODE_CHOICES) {
    const { syncMode, destinationSyncMode } = mapSyncModeChoice(choice);
    assert.equal(classifySyncMode(syncMode, destinationSyncMode), choice);
  }
});

test('classifySyncMode folds unknown pairs to a safe default', () => {
  assert.equal(classifySyncMode('full_refresh', 'overwrite'), 'full_refresh_overwrite');
  assert.equal(classifySyncMode(undefined, undefined), 'full_refresh_overwrite');
  assert.equal(classifySyncMode('incremental', 'weird'), 'incremental_append');
  assert.equal(classifySyncMode('INCREMENTAL', 'APPEND_DEDUP'), 'incremental_dedup');
});

// ─── applySyncModeToStream ──────────────────────────────────────────────────
test('applySyncModeToStream mutates only the matched stream, immutably', () => {
  const update = {
    connectionId: 'c1',
    syncCatalog: {
      streams: [
        { stream: { name: 'loan_accounts' }, config: { syncMode: 'full_refresh', destinationSyncMode: 'overwrite' } },
        { stream: { name: 'txns' }, config: { syncMode: 'full_refresh', destinationSyncMode: 'overwrite' } },
      ],
    },
  };
  const out = applySyncModeToStream(update, 'txns', 'incremental_dedup');
  const streams = (out.syncCatalog as { streams: Array<{ stream: { name: string }; config: Record<string, unknown> }> }).streams;
  assert.equal(streams[0].config.syncMode, 'full_refresh'); // untouched
  assert.equal(streams[1].config.syncMode, 'incremental');
  assert.equal(streams[1].config.destinationSyncMode, 'append_dedup');
  assert.equal(streams[1].config.selected, true);
  // original untouched
  assert.equal(
    (update.syncCatalog.streams[1].config as Record<string, unknown>).syncMode,
    'full_refresh',
  );
});

test('applySyncModeToStream is a no-op when catalog/stream missing', () => {
  assert.deepEqual(applySyncModeToStream({ connectionId: 'c' }, 'x', 'incremental_append'), {
    connectionId: 'c',
  });
  const noMatch = applySyncModeToStream(
    { connectionId: 'c', syncCatalog: { streams: [{ stream: { name: 'a' }, config: {} }] } },
    'missing',
    'incremental_append',
  );
  const streams = (noMatch.syncCatalog as { streams: Array<{ config: Record<string, unknown> }> }).streams;
  assert.equal(streams[0].config.syncMode, undefined); // unchanged
});

// ─── normalizeConnectionDetail ──────────────────────────────────────────────
test('normalizeConnectionDetail: cron connection with streams', () => {
  const d = normalizeConnectionDetail({
    connectionId: 'conn-1',
    name: 'CoreBank → Lake',
    status: 'active',
    scheduleType: 'cron',
    scheduleData: { cron: { cronExpression: '0 0 2 * * ?', cronTimeZone: 'Asia/Kolkata' } },
    syncCatalog: {
      streams: [
        {
          stream: { name: 'loan_accounts', namespace: 'core' },
          config: {
            syncMode: 'incremental',
            destinationSyncMode: 'append_dedup',
            cursorField: ['updated_at'],
            primaryKey: [['loan_id']],
          },
        },
        {
          stream: { name: 'cdc_txns' },
          config: { syncMode: 'incremental', destinationSyncMode: 'append', cursorField: ['_ab_cdc_lsn'] },
        },
      ],
    },
  });
  assert.equal(d.scheduleType, 'cron');
  assert.equal(d.cronExpression, '0 0 2 * * ?');
  assert.equal(d.cronTimeZone, 'Asia/Kolkata');
  assert.equal(d.scheduleLabel, 'cron: 0 0 2 * * ?');
  assert.equal(d.streams.length, 2);
  assert.equal(d.streams[0].syncMode, 'incremental_dedup');
  assert.deepEqual(d.streams[0].cursorField, ['updated_at']);
  assert.deepEqual(d.streams[0].primaryKey, [['loan_id']]);
  assert.equal(d.streams[0].cdc, false);
  assert.equal(d.streams[1].cdc, true); // _ab_cdc_ cursor
});

test('normalizeConnectionDetail: basic + legacy schedule shapes', () => {
  const basic = normalizeConnectionDetail({
    connectionId: 'c2',
    scheduleType: 'basic',
    scheduleData: { basicSchedule: { units: 6, timeUnit: 'hours' } },
  });
  assert.equal(basic.scheduleType, 'basic');
  assert.equal(basic.intervalUnits, 6);
  assert.equal(basic.intervalTimeUnit, 'hours');
  assert.equal(basic.scheduleLabel, 'every 6 hours');

  const legacy = normalizeConnectionDetail({
    connectionId: 'c3',
    schedule: { units: 24, timeUnit: 'hours' }, // no scheduleType → inferred basic
  });
  assert.equal(legacy.scheduleType, 'basic');
  assert.equal(legacy.scheduleLabel, 'every 24 hours');
});

test('normalizeConnectionDetail: defensive defaults on junk', () => {
  const d = normalizeConnectionDetail(null);
  assert.equal(d.connectionId, '');
  assert.equal(d.name, 'connection');
  assert.equal(d.scheduleType, 'manual');
  assert.equal(d.scheduleLabel, 'manual');
  assert.deepEqual(d.streams, []);

  const partial = normalizeConnectionDetail({
    connectionId: 'c4',
    scheduleType: 'cron', // but no scheduleData
    syncCatalog: { streams: [{ notAStream: true }, { stream: {} }] }, // both unnamed → dropped
  });
  assert.equal(partial.scheduleLabel, 'cron');
  assert.deepEqual(partial.streams, []);
});

test('CRON_PRESETS are all valid cron', () => {
  for (const p of CRON_PRESETS) assert.equal(validateCron(p.expression), true, p.label);
});

// ─── buildScheduleUpdate ────────────────────────────────────────────────────
test('buildScheduleUpdate: valid change → ready ConnectionUpdate without read-only fields', () => {
  const r = buildScheduleUpdate(RAW_CONN, { type: 'cron', cronExpression: '0 0 2 * * ?' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.update.scheduleType, 'cron');
    assert.equal(r.update.connectionId, 'conn-1');
    assert.ok(!('sourceId' in r.update));
  }
});

test('buildScheduleUpdate: invalid input / missing connection → error', () => {
  const bad = buildScheduleUpdate(RAW_CONN, { type: 'cron', cronExpression: 'nope' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /Quartz/);
  const missing = buildScheduleUpdate({ name: 'x' }, { type: 'manual' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /not found/);
});

// ─── buildSyncModeUpdate ────────────────────────────────────────────────────
test('buildSyncModeUpdate: full-refresh needs no cursor', () => {
  const r = buildSyncModeUpdate(RAW_CONN, 'branches', 'full_refresh_append');
  assert.equal(r.ok, true);
  if (r.ok) {
    const s = (r.update.syncCatalog as { streams: Array<{ stream: { name: string }; config: Record<string, unknown> }> }).streams.find(
      (x) => x.stream.name === 'branches',
    );
    assert.equal(s!.config.destinationSyncMode, 'append');
  }
});

test('buildSyncModeUpdate: incremental requires a cursor; dedup requires a primary key', () => {
  // branches has no cursor → incremental rejected
  const noCursor = buildSyncModeUpdate(RAW_CONN, 'branches', 'incremental_append');
  assert.equal(noCursor.ok, false);
  if (!noCursor.ok) assert.match(noCursor.error, /cursor/);

  // loan_accounts has cursor + pk → both allowed
  assert.equal(buildSyncModeUpdate(RAW_CONN, 'loan_accounts', 'incremental_append').ok, true);
  assert.equal(buildSyncModeUpdate(RAW_CONN, 'loan_accounts', 'incremental_dedup').ok, true);

  // a stream with cursor but no PK → dedup rejected
  const conn = {
    connectionId: 'c',
    syncCatalog: {
      streams: [{ stream: { name: 's' }, config: { syncMode: 'incremental', destinationSyncMode: 'append', cursorField: ['u'] } }],
    },
  };
  const noPk = buildSyncModeUpdate(conn, 's', 'incremental_dedup');
  assert.equal(noPk.ok, false);
  if (!noPk.ok) assert.match(noPk.error, /primary key/);
});

test('buildSyncModeUpdate: guards bad stream name and mode', () => {
  assert.equal(buildSyncModeUpdate(RAW_CONN, '', 'full_refresh_overwrite').ok, false);
  assert.equal(
    buildSyncModeUpdate(RAW_CONN, 'branches', 'bogus' as unknown as 'full_refresh_append').ok,
    false,
  );
  assert.equal(buildSyncModeUpdate(RAW_CONN, 'ghost', 'full_refresh_overwrite').ok, false);
  assert.equal(buildSyncModeUpdate({ name: 'x' }, 's', 'full_refresh_overwrite').ok, false);
});
