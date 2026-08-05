import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeWindow,
  readPosture,
  summarisePosture,
  type StoreReading,
} from '../src/lib/store-retention-posture.ts';

const reading = (over: Partial<StoreReading> = {}): StoreReading => ({
  storeId: 'victoriametrics',
  holds: 'metrics',
  flagValue: '3',
  ...over,
});

test('THE THREE ANSWERS THAT LOOK THE SAME ON A DASHBOARD ARE KEPT APART', () => {
  // Confirmed, assumed and unknown are indistinguishable if a surface just prints a number — and they
  // are completely different to someone signing a data-processing agreement.
  assert.equal(readPosture(reading({ flagValue: '3' })).confidence, 'confirmed');
  assert.equal(
    readPosture(reading({ flagValue: null, documentedDefault: '7d' })).confidence,
    'assumed-default',
  );
  assert.equal(readPosture(reading({ flagValue: null })).confidence, 'unknown');
  assert.equal(readPosture(reading({ readFailed: true })).confidence, 'unknown');
});

test('A FAILED READ IS NOT "no limit" AND NOT "fine"', () => {
  const p = readPosture(reading({ readFailed: true }));
  assert.match(p.sentence, /UNKNOWN, not confirmed and not unlimited/);
  assert.equal(p.window, null);
});

test('an absent flag is reported as a default NOBODY CHOSE, not as configuration', () => {
  // Measured live 2026-08-05: the log store's flag list contains no retention flag at all, so it runs
  // on its built-in default. Calling that "retention configured" would be false.
  const p = readPosture(reading({ storeId: 'victorialogs', holds: 'logs', flagValue: null, documentedDefault: '7d' }));
  assert.equal(p.window, '7 days');
  assert.match(p.sentence, /Nobody chose it/);
  assert.match(p.sentence, /ASSUMED rather than confirmed/);
});

test('keep-forever is called out explicitly, with the consequence', () => {
  for (const forever of ['0', '0d', '-1']) {
    const p = readPosture(reading({ flagValue: forever }));
    assert.equal(p.confidence, 'unbounded', `${forever} must read as unbounded`);
    assert.match(p.sentence, /FOREVER/);
    assert.match(p.sentence, /until its disk is full/);
  }
});

test('a bare number means MONTHS in this family, so "3" is never shown as "3"', () => {
  // Printing the raw flag on a compliance page is not an answer — 3 what?
  assert.equal(describeWindow('3'), '3 months');
  assert.equal(describeWindow('1'), '1 month');
  assert.equal(describeWindow('12M'), '12 months');
  assert.equal(describeWindow('7d'), '7 days');
  assert.equal(describeWindow('1d'), '1 day');
  assert.equal(describeWindow('4w'), '4 weeks');
  assert.equal(describeWindow('2y'), '2 years');
  // An unfamiliar format is shown verbatim rather than guessed at.
  assert.equal(describeWindow('30something'), '30something');
  assert.equal(describeWindow('  '), null);
});

test('ONE UNCONFIRMED STORE IS ENOUGH TO BLOCK THE CLAIM', () => {
  // A retention statement is about ALL the data. "Most stores are bounded" is not a weaker version of
  // the claim — it is not the claim.
  const stores = [
    readPosture(reading({ storeId: 'a', flagValue: '3' })),
    readPosture(reading({ storeId: 'b', flagValue: '1' })),
    readPosture(reading({ storeId: 'c', holds: 'logs', flagValue: null, documentedDefault: '7d' })),
  ];
  const s = summarisePosture(stores);
  assert.equal(s.claimable, false);
  assert.equal(s.confirmed, 2);
  assert.equal(s.unproven, 1);
  assert.match(s.sentence, /cannot be made yet/);
  assert.match(s.sentence, /relies on a built-in default nobody set/);
});

test('every store confirmed → the claim is stated plainly', () => {
  const s = summarisePosture([
    readPosture(reading({ storeId: 'a', flagValue: '3' })),
    readPosture(reading({ storeId: 'b', flagValue: '30d' })),
  ]);
  assert.equal(s.claimable, true);
  assert.match(s.sentence, /Every store confirms a limit/);
});

test('checking nothing is not a pass', () => {
  // An empty list must never read as compliance — it is the absence of evidence.
  const s = summarisePosture([]);
  assert.equal(s.claimable, false);
  assert.match(s.sentence, /nothing can be said/);
});

test('the reasons are counted separately, because they need different actions', () => {
  const s = summarisePosture([
    readPosture(reading({ storeId: 'a', flagValue: '0' })),
    readPosture(reading({ storeId: 'b', readFailed: true })),
    readPosture(reading({ storeId: 'c', flagValue: null, documentedDefault: '7d' })),
  ]);
  assert.match(s.sentence, /1 keeps data forever/);
  assert.match(s.sentence, /1 could not be read/);
  assert.match(s.sentence, /1 relies on a built-in default/);
});

test('A READ THAT FINDS NOTHING BOUNDING THE STORE IS STRONGER THAN A MISSING SETTING', () => {
  // A search index with zero lifecycle policies is not "we could not find the setting" — it is "we
  // looked, and nothing expires". Worse, and more certain. Measured live 2026-08-05: the audit log
  // index reported total_policies: 0, so security-auditlog-* accumulates forever.
  const p = readPosture({
    storeId: 'opensearch',
    holds: 'audit and security logs',
    flagValue: null,
    explicitUnbounded: true,
  });
  assert.equal(p.confidence, 'unbounded');
  assert.match(p.sentence, /Nothing removes audit and security logs on a schedule/);
  assert.match(p.sentence, /confirmed by reading the store, not inferred from a missing setting/);
});

test('explicitly unbounded beats every other signal, including a stale flag', () => {
  // If the store says nothing expires, a flag value lying around must not override that.
  const p = readPosture({
    storeId: 'x',
    holds: 'logs',
    flagValue: '30d',
    documentedDefault: '7d',
    explicitUnbounded: true,
  });
  assert.equal(p.confidence, 'unbounded');
});

test('an unbounded audit store blocks the claim and is counted as keeping data forever', () => {
  const s = summarisePosture([
    readPosture({ storeId: 'a', holds: 'metrics', flagValue: '3' }),
    readPosture({ storeId: 'b', holds: 'audit logs', flagValue: null, explicitUnbounded: true }),
  ]);
  assert.equal(s.claimable, false);
  assert.match(s.sentence, /1 keeps data forever/);
});
