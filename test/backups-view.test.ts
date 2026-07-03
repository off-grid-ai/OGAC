import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type BackupsConfig,
  buildBackupsView,
  formatAge,
  formatBytes,
} from '../src/lib/backups-view.ts';

// Unit tests for the pure backup/DR display-model builder — NO mocks, no fs, deterministic `now`.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 6, 4, 6, 0, 0); // 2026-07-04T06:00:00Z

const CONFIG: BackupsConfig = {
  retentionDays: 14,
  backupRoot: '/Users/admin/offgrid/backups',
  offBoxTarget: 'admin@192.168.1.66:/Users/admin/offgrid/backups-from-s1',
  staleAfterHours: 24,
};

test('sample entries → latest/age/size/count, newest-first', () => {
  const view = buildBackupsView(
    [
      { name: 'old', timestampMs: NOW - 3 * DAY, sizeBytes: 1000 },
      { name: 'newest', timestampMs: NOW - 2 * HOUR, sizeBytes: 2000 },
      { name: 'mid', timestampMs: NOW - 1 * DAY, sizeBytes: 500 },
    ],
    CONFIG,
    NOW,
  );

  assert.equal(view.count, 3);
  assert.equal(view.totalSizeBytes, 3500);
  assert.equal(view.latest?.name, 'newest');
  assert.equal(view.latestAgeMs, 2 * HOUR);
  assert.equal(view.stale, false); // 2h < 24h threshold
  // newest-first ordering
  assert.deepEqual(
    view.rows.map((r) => r.name),
    ['newest', 'mid', 'old'],
  );
  assert.equal(view.countWithinRetention, 3);
  assert.equal(view.offBoxEnabled, true);
});

test('empty → stale, no latest, zeroed counts', () => {
  const view = buildBackupsView([], CONFIG, NOW);
  assert.equal(view.count, 0);
  assert.equal(view.latest, null);
  assert.equal(view.latestAgeMs, null);
  assert.equal(view.stale, true);
  assert.equal(view.totalSizeBytes, 0);
  assert.equal(view.countWithinRetention, 0);
});

test('null/undefined entries handled defensively', () => {
  assert.equal(buildBackupsView(null, CONFIG, NOW).count, 0);
  assert.equal(buildBackupsView(undefined, CONFIG, NOW).stale, true);
});

test('stale when latest backup older than staleAfterHours', () => {
  const view = buildBackupsView(
    [{ name: 'stale-one', timestampMs: NOW - 30 * HOUR, sizeBytes: 100 }],
    CONFIG,
    NOW,
  );
  assert.equal(view.stale, true);
  assert.equal(view.latest?.name, 'stale-one');
});

test('retention filtering: entries older than retentionDays are aged out', () => {
  const view = buildBackupsView(
    [
      { name: 'fresh', timestampMs: NOW - 1 * DAY, sizeBytes: 10 },
      { name: 'edge', timestampMs: NOW - 13 * DAY, sizeBytes: 10 },
      { name: 'aged-out', timestampMs: NOW - 20 * DAY, sizeBytes: 10 },
    ],
    CONFIG,
    NOW,
  );
  assert.equal(view.countWithinRetention, 2); // fresh + edge (13d < 14d)
  const agedOut = view.rows.find((r) => r.name === 'aged-out');
  assert.equal(agedOut?.withinRetention, false);
  // The latest is still the freshest even though older ones exist.
  assert.equal(view.latest?.name, 'fresh');
});

test('off-box: disabled when no target; per-entry replicated count', () => {
  const noOffBox: BackupsConfig = { ...CONFIG, offBoxTarget: null };
  const view = buildBackupsView(
    [
      { name: 'a', timestampMs: NOW - 1 * HOUR, sizeBytes: 10, offBox: true },
      { name: 'b', timestampMs: NOW - 2 * HOUR, sizeBytes: 10, offBox: false },
    ],
    noOffBox,
    NOW,
  );
  assert.equal(view.offBoxEnabled, false);
  assert.equal(view.offBoxReplicatedCount, 1);
});

test('entries with unknown timestamp sort last and are outside retention', () => {
  const view = buildBackupsView(
    [
      { name: 'unknown', timestampMs: null, sizeBytes: 5 },
      { name: 'known', timestampMs: NOW - 1 * HOUR, sizeBytes: 5 },
    ],
    CONFIG,
    NOW,
  );
  assert.equal(view.rows[0].name, 'known');
  assert.equal(view.rows[1].name, 'unknown');
  assert.equal(view.rows[1].withinRetention, false);
  assert.equal(view.rows[1].ageMs, null);
  assert.equal(view.latest?.name, 'known'); // unknown-timestamp entry never counts as latest
});

test('formatBytes / formatAge', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatAge(null), '—');
  assert.equal(formatAge(2 * HOUR), '2h ago');
  assert.equal(formatAge(3 * DAY), '3d ago');
});
