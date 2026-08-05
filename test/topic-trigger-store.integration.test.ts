import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Pool } from 'pg';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareScopedSchema } from './support/scoped-schema.mjs';

// Real Postgres, no mocks. The behaviour under test IS the SQL — a fake store would assert that my
// JavaScript does what I wrote, which is not the question. The questions are whether GREATEST on a
// numeric cast actually refuses to rewind, and whether the ledger is genuinely idempotent under a
// racing redelivery. Only the database can answer those.

const dbUp = await dbReachable();
const previousDatabaseUrl = process.env.DATABASE_URL;
const prepared = dbUp ? await prepareScopedSchema('topic_trigger') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;
after(async () => {
  await prepared?.cleanup();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

const skip = dbUp ? false : SKIP_MESSAGE;
const APP = 'app_claims';
const ORG = 'org_bharat';
const TOPIC = 'offgrid.claims.submitted';

test('the store builds its own tables on first use — an rsync deploy has no migration step', { skip }, async () => {
  const store = await import('@/lib/topic-trigger-store');
  // Nothing has created these tables; the first read has to work anyway.
  assert.deepEqual(await store.readTopicCursors(APP, TOPIC), []);
  const pool = new Pool({ connectionString: prepared!.databaseUrl });
  try {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
      [prepared!.schema],
    );
    assert.deepEqual(
      rows.map((r) => r.tablename),
      ['topic_trigger_cursors', 'topic_trigger_deliveries'],
    );
  } finally {
    await pool.end();
  }
});

test('A CURSOR NEVER GOES BACKWARDS, and the guard survives text-vs-number confusion', { skip }, async () => {
  const store = await import('@/lib/topic-trigger-store');
  const commit = (nextOffset: string) =>
    store.commitTopicCursor({ appId: APP, orgId: ORG, topic: TOPIC, groupId: 'g', partition: 0, nextOffset });

  await commit('10');
  // A slower process trying to write an older position must not win: rewinding re-runs governed work.
  await commit('4');
  assert.deepEqual(await store.readTopicCursors(APP, TOPIC), [{ partition: 0, nextOffset: '10' }]);
  // As TEXT, '9' sorts after '10'. If the comparison were textual this would rewind the cursor by one
  // and re-run the record at offset 9 on every cycle, forever.
  await commit('9');
  assert.deepEqual(await store.readTopicCursors(APP, TOPIC), [{ partition: 0, nextOffset: '10' }]);
  await commit('11');
  assert.deepEqual(await store.readTopicCursors(APP, TOPIC), [{ partition: 0, nextOffset: '11' }]);
});

test('offsets past 2^53 round-trip exactly', { skip }, async () => {
  const store = await import('@/lib/topic-trigger-store');
  // Stored as text and compared as numeric. If either end used a float these two would be equal.
  await store.commitTopicCursor({
    appId: APP, orgId: ORG, topic: TOPIC, groupId: 'g', partition: 7,
    nextOffset: '9007199254740993',
  });
  const [cursor] = (await store.readTopicCursors(APP, TOPIC)).filter((c) => c.partition === 7);
  assert.equal(cursor.nextOffset, '9007199254740993');
  await store.commitTopicCursor({
    appId: APP, orgId: ORG, topic: TOPIC, groupId: 'g', partition: 7,
    nextOffset: '9007199254740992',
  });
  const [again] = (await store.readTopicCursors(APP, TOPIC)).filter((c) => c.partition === 7);
  assert.equal(again.nextOffset, '9007199254740993', 'the older, larger-looking offset must not win');
});

test('cursors are per app and per topic — one app cannot read another app\'s progress', { skip }, async () => {
  const store = await import('@/lib/topic-trigger-store');
  await store.commitTopicCursor({
    appId: 'app_other', orgId: ORG, topic: TOPIC, groupId: 'g', partition: 0, nextOffset: '999',
  });
  const mine = await store.readTopicCursors(APP, TOPIC);
  assert.equal(mine.find((c) => c.nextOffset === '999'), undefined);
  assert.deepEqual(await store.readTopicCursors(APP, 'offgrid.other.topic'), []);
});

test('THE LEDGER IS WHAT MAKES REDELIVERY SAFE: the same record is only ever acted on once', { skip }, async () => {
  const store = await import('@/lib/topic-trigger-store');
  const key = `${TOPIC}/0/41`;
  await store.recordDelivery({ appId: APP, orgId: ORG, deliveryKey: key, disposition: 'ran', runId: 'run_a' });
  // A crash between the run and the cursor commit redelivers this exact record. The consumer asks the
  // ledger first, and the answer has to be "already done" — otherwise a claim is processed twice.
  const seen = await store.readSeenDeliveries(APP, [key, `${TOPIC}/0/42`]);
  assert.equal(seen.has(key), true);
  assert.equal(seen.has(`${TOPIC}/0/42`), false);

  // Writing it again (two consumers racing) must not throw and must not lose the original run id.
  await store.recordDelivery({ appId: APP, orgId: ORG, deliveryKey: key, disposition: 'duplicate' });
  const recent = await store.listRecentDeliveries(APP);
  const row = recent.find((r) => r.deliveryKey === key)!;
  assert.equal(row.disposition, 'duplicate');
  assert.equal(row.runId, 'run_a', 'the run this record caused must remain traceable');
});

test('an empty key list does not query at all, and a parked record is retained with its reason', { skip }, async () => {
  const store = await import('@/lib/topic-trigger-store');
  assert.equal((await store.readSeenDeliveries(APP, [])).size, 0);
  await store.recordDelivery({
    appId: APP, orgId: ORG, deliveryKey: `${TOPIC}/1/5`, disposition: 'parked',
    note: 'The record carries no value, so there is nothing to act on.',
  });
  const [newest] = await store.listRecentDeliveries(APP, 1);
  assert.equal(newest.disposition, 'parked');
  assert.match(newest.note ?? '', /nothing to act on/);
  assert.equal(newest.runId, null);
});
