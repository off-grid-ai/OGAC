// A REAL database, because the bug this covers was invisible to anything else.
//
// existingRunIds was written with a raw `sql` template: `id = ANY(${wanted})`. Drizzle expanded the
// JS array into a row constructor — `ANY(($2, $3))` — which throws. The throw was swallowed by the
// function's own fail-closed catch and returned an empty set, which is indistinguishable from "none
// of these runs exist". Every citation quietly lost its link while the unit tests, the typechecker
// and the UI all looked fine.
//
// A mock of the database would have reproduced none of it: the defect lived entirely in how the
// query was built. So this suite runs the real query against real tables, and its central assertion
// is that a run which EXISTS comes back — the direction a silent failure cannot fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbUpOnce, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG = 'test_runex_org';
const OTHER_ORG = 'test_runex_other';

async function seed() {
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    INSERT INTO agent_runs (id, org_id, agent_id, query, answer, status)
    VALUES ('run_runex_a', ${ORG}, 'ag_x', 'q', 'a', 'done'),
           ('run_runex_b', ${OTHER_ORG}, 'ag_x', 'q', 'a', 'done')
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanup() {
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`DELETE FROM agent_runs WHERE id IN ('run_runex_a', 'run_runex_b')`);
}

test('a run that exists is returned — the assertion a silent failure cannot fake', async (t) => {
  if (!(await dbUpOnce())) return t.skip(SKIP_MESSAGE);
  const { existingRunIds } = await import('@/lib/run-existence');
  await seed();
  try {
    const got = await existingRunIds(ORG, ['run_runex_a']);
    assert.ok(got.has('run_runex_a'), 'the query must actually run, not throw into the catch');
  } finally {
    await cleanup();
  }
});

test('an id with no run behind it is not returned', async (t) => {
  if (!(await dbUpOnce())) return t.skip(SKIP_MESSAGE);
  const { existingRunIds } = await import('@/lib/run-existence');
  // The live case: apprun_eee51b30 sits in the audit ledger with no row in app_runs, because the
  // audit trail outlives the runs it describes.
  const got = await existingRunIds(ORG, ['apprun_definitely_not_here']);
  assert.equal(got.size, 0);
});

test('another tenant\'s run is never returned, existing or not', async (t) => {
  if (!(await dbUpOnce())) return t.skip(SKIP_MESSAGE);
  const { existingRunIds } = await import('@/lib/run-existence');
  await seed();
  try {
    const got = await existingRunIds(ORG, ['run_runex_b']);
    assert.equal(got.size, 0, 'run_runex_b belongs to another org');
  } finally {
    await cleanup();
  }
});

test('a mixed batch separates the real from the dangling in one call', async (t) => {
  if (!(await dbUpOnce())) return t.skip(SKIP_MESSAGE);
  const { existingRunIds } = await import('@/lib/run-existence');
  await seed();
  try {
    const got = await existingRunIds(ORG, ['run_runex_a', 'apprun_gone', 'run_runex_b']);
    assert.deepEqual([...got], ['run_runex_a']);
  } finally {
    await cleanup();
  }
});

test('an empty request does no work and returns nothing', async (t) => {
  if (!(await dbUpOnce())) return t.skip(SKIP_MESSAGE);
  const { existingRunIds } = await import('@/lib/run-existence');
  assert.equal((await existingRunIds(ORG, [])).size, 0);
});
