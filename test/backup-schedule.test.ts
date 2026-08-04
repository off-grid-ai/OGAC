import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupEvidence, scheduleVerdict } from '../src/lib/backup-schedule.ts';

const NOW = Date.parse('2026-08-04T14:00:00Z');
const hoursAgo = (h: number) => NOW - h * 3_600_000;
const LABEL = 'co.getoffgridai.backup';

// The live shape on 2026-08-04: a backup every night, newest ~13h old — and the console said
// "not scheduled" because an unprivileged `launchctl list` cannot see a system-domain daemon.
const NIGHTLY = [13, 37, 61, 85, 109, 133, 157].map(hoursAgo);

test('THE LIVE DEFECT: nightly backups + an unreadable probe is not "not scheduled"', () => {
  const v = scheduleVerdict('not-visible', backupEvidence(NIGHTLY, NOW), LABEL);
  assert.equal(v.scheduled, true);
  assert.equal(v.confidence, 'evidenced');
  // It must state BOTH facts and dress neither as the other.
  assert.match(v.detail, /the nightly job is running/);
  assert.match(v.detail, /could not be read from here/);
  assert.match(v.detail, /unprivileged/);
});

test('a confirmed probe needs no corroboration', () => {
  const v = scheduleVerdict('loaded', backupEvidence([], NOW), LABEL);
  assert.equal(v.confidence, 'confirmed');
  assert.equal(v.scheduled, true);
});

test('an unreadable probe AND no backups is a real warning', () => {
  const v = scheduleVerdict('not-visible', backupEvidence([], NOW), LABEL);
  assert.equal(v.confidence, 'absent');
  assert.equal(v.scheduled, false);
  assert.match(v.detail, /No backups exist/);
});

test('an unreadable probe with a STALE backup is still a warning — cadence is what matters', () => {
  // One backup, nine days old: nothing is running now, and no amount of history changes that.
  const v = scheduleVerdict('not-visible', backupEvidence([hoursAgo(9 * 24)], NOW), LABEL);
  assert.equal(v.scheduled, false);
  assert.match(v.detail, /not running reliably/);
});

test('a gap in the cadence is not covered up by one fresh backup', () => {
  // Fresh, but only two of the last seven days — someone ran it by hand.
  const v = scheduleVerdict('not-visible', backupEvidence([hoursAgo(2), hoursAgo(30)], NOW), LABEL);
  assert.equal(v.scheduled, false);
  assert.equal(v.confidence, 'absent');
});

test('launchctl absent entirely: evidence still decides, and says why it cannot confirm', () => {
  const withBackups = scheduleVerdict('unavailable', backupEvidence(NIGHTLY, NOW), LABEL);
  assert.equal(withBackups.scheduled, true);
  assert.match(withBackups.detail, /cannot be read in this environment/);

  const without = scheduleVerdict('unavailable', backupEvidence([], NOW), LABEL);
  assert.equal(without.scheduled, false);
  assert.equal(without.confidence, 'unknown');
  // 'unknown' must never read as a warning about a missing job we did not establish is missing.
  assert.doesNotMatch(without.detail, /is not running/);
});

test('days are UTC calendar days, so two runs one night count once', () => {
  const sameNight = [Date.parse('2026-08-04T01:00:00Z'), Date.parse('2026-08-04T02:30:00Z')];
  assert.equal(backupEvidence(sameNight, NOW).daysCoveredOfSeven, 1);
});

test('a clock-skewed future backup does not read as negative age', () => {
  const e = backupEvidence([NOW + 3_600_000], NOW);
  assert.equal(e.newestAgeHours, 0);
});

test('junk timestamps are ignored rather than counted', () => {
  const e = backupEvidence([null, undefined, Number.NaN, hoursAgo(5)], NOW);
  assert.equal(e.daysCoveredOfSeven, 1);
  assert.ok((e.newestAgeHours ?? 0) >= 4.9 && (e.newestAgeHours ?? 0) <= 5.1);
});

test('no backups at all reports null age, not zero', () => {
  // Zero would read as "one just landed" — the opposite of the truth.
  assert.equal(backupEvidence([], NOW).newestAgeHours, null);
});
