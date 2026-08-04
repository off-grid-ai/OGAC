import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRILL_STALE_DAYS, drillStatus, parseDrillRecord } from '../src/lib/dr-drill.ts';

// The fixture is the record the live drill actually wrote on 2026-08-04, not an invented shape.
const REAL = {
  ranAt: '2026-08-04T09:08:03Z',
  backup: 'baorestore',
  ranBy: 'vault-recovery-drill.sh',
  passed: true,
  stages: [
    { name: 'Snapshot restored into a throwaway vault', ok: true },
    { name: 'Unsealed with the original key', ok: true },
    { name: 'Canary secret read back — decryptable, keyring intact', ok: true },
    { name: "Audit device recorded the request with the value HMAC'd", ok: true },
  ],
};

const at = (iso: string) => new Date(iso);

test('the record the live drill wrote parses, with every stage', () => {
  const r = parseDrillRecord(REAL);
  assert.ok(r);
  assert.equal(r?.passed, true);
  assert.equal(r?.stages.length, 4);
  assert.ok(r?.stages.every((s) => s.ok));
});

test('NO record reads as never rehearsed — never as health', () => {
  const s = drillStatus(null, at('2026-08-04T10:00:00Z'));
  assert.equal(s.state, 'never');
  assert.equal(s.ageDays, null);
  assert.match(s.sentence, /No restore has ever been rehearsed/);
  // The distinction that matters: having backups is not having proven a restore.
  assert.match(s.sentence, /Backups exist/);
});

test('a fresh passing drill says the backup is known restorable, not merely present', () => {
  const s = drillStatus(parseDrillRecord(REAL), at('2026-08-04T20:00:00Z'));
  assert.equal(s.state, 'fresh');
  assert.equal(s.ageDays, 0);
  assert.match(s.sentence, /rehearsed today and passed every stage/);
  assert.match(s.sentence, /baorestore/);
});

test('a passing drill goes stale past the window rather than staying green forever', () => {
  const s = drillStatus(parseDrillRecord(REAL), at('2027-01-01T00:00:00Z'));
  assert.equal(s.state, 'stale');
  assert.ok((s.ageDays ?? 0) > DRILL_STALE_DAYS);
  assert.match(s.sentence, /rehearse again/i);
});

test('a failed stage names it and refuses to imply the backup is usable', () => {
  const failed = {
    ...REAL,
    passed: false,
    stages: [
      { name: 'Snapshot restored into a throwaway vault', ok: true },
      { name: 'Unsealed with the original key', ok: false },
    ],
  };
  const s = drillStatus(parseDrillRecord(failed), at('2026-08-05T09:08:03Z'));
  assert.equal(s.state, 'failed');
  assert.deepEqual(s.failedStages, ['Unsealed with the original key']);
  assert.match(s.sentence, /assume this backup cannot be restored/);
});

test('passed:true with a failing stage is still a FAILURE — the stages win', () => {
  // A script that sets passed=true while a stage failed must not produce a green card.
  const inconsistent = { ...REAL, passed: true, stages: [{ name: 'Unsealed', ok: false }] };
  assert.equal(drillStatus(parseDrillRecord(inconsistent), at('2026-08-04T10:00:00Z')).state, 'failed');
});

test('a missing `passed` field is not a pass', () => {
  const noPassed = parseDrillRecord({ ranAt: REAL.ranAt, stages: [{ name: 'x', ok: true }] });
  assert.equal(noPassed?.passed, false);
  assert.equal(drillStatus(noPassed, at('2026-08-04T10:00:00Z')).state, 'failed');
});

test('a malformed record is NO record — an artefact we cannot read is not one we can rely on', () => {
  for (const bad of [null, undefined, 'nope', 42, [], {}, { ranAt: '' }, { ranAt: 'not-a-date' }]) {
    assert.equal(parseDrillRecord(bad), null, `${JSON.stringify(bad)} must not parse`);
  }
  // And that null flows through to "never", not to a pass.
  assert.equal(drillStatus(parseDrillRecord({ ranAt: 'garbage' }), at('2026-08-04T10:00:00Z')).state, 'never');
});

test('junk inside stages degrades safely instead of throwing', () => {
  const r = parseDrillRecord({ ranAt: REAL.ranAt, passed: true, stages: [null, 'x', { ok: true }] });
  assert.ok(r);
  // The two non-objects are dropped; the nameless one is named rather than rendered as undefined.
  assert.equal(r?.stages.length, 1);
  assert.equal(r?.stages[0].name, 'unnamed stage');
});

test('a future timestamp does not produce a negative age', () => {
  const s = drillStatus(parseDrillRecord(REAL), at('2026-08-01T00:00:00Z'));
  assert.equal(s.ageDays, 0);
});
