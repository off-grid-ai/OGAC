import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION — RTBF cross-tenant guard (SECURITY #236 fix 3). Seeds the SAME subject's rows under
// TWO orgs, runs the org-confined erasure executor for org A ONLY, and asserts the TERMINAL row
// counts: org A's rows are gone, org B's rows are UNTOUCHED (a cross-tenant erase deletes ZERO
// foreign rows, and an admin of A cannot reach B's data). Skips green when Postgres is unreachable.

const ORG_A = 'ct-erasure-org-a';
const ORG_B = 'ct-erasure-org-b';
const SUBJECT = 'shared-subject@corp.in'; // the same person exists in BOTH orgs

test('RTBF cross-tenant: erasing a subject in org A deletes ZERO of org B rows', async () => {
  if (!(await dbReachable())) {
    console.log(SKIP_MESSAGE);
    return; // skip green
  }
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const { planErasure } = await import('../src/lib/erasure.ts');
  const { executeErasureStep } = await import('../src/lib/erasure-execute.ts');

  const convA = 'conv-ct-a';
  const convB = 'conv-ct-b';
  const msgA = 'msg-ct-a';
  const msgB = 'msg-ct-b';

  // Clean any prior run, then seed: a conversation + a message + a memory row PER ORG for the subject.
  const cleanup = async () => {
    await db.execute(sql`DELETE FROM chat_messages WHERE id IN (${msgA}, ${msgB})`);
    await db.execute(sql`DELETE FROM chat_conversations WHERE id IN (${convA}, ${convB})`);
    await db.execute(sql`DELETE FROM chat_memory WHERE user_id = ${SUBJECT} AND org_id IN (${ORG_A}, ${ORG_B})`);
  };
  await cleanup();

  try {
    // chat_conversations (has org_id) — one per org, same subject.
    await db.execute(sql`INSERT INTO chat_conversations (id, user_id, org_id, title) VALUES (${convA}, ${SUBJECT}, ${ORG_A}, 'A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`INSERT INTO chat_conversations (id, user_id, org_id, title) VALUES (${convB}, ${SUBJECT}, ${ORG_B}, 'B') ON CONFLICT (id) DO NOTHING`);
    // chat_messages (child, no org column — scoped via its conversation's org).
    await db.execute(sql`INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (${msgA}, ${convA}, 'user', 'hi from A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (${msgB}, ${convB}, 'user', 'hi from B') ON CONFLICT (id) DO NOTHING`);
    // chat_memory (has org_id) — one per org.
    await db.execute(sql`INSERT INTO chat_memory (id, user_id, org_id, fact) VALUES (${'mem-ct-a'}, ${SUBJECT}, ${ORG_A}, 'a') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`INSERT INTO chat_memory (id, user_id, org_id, fact) VALUES (${'mem-ct-b'}, ${SUBJECT}, ${ORG_B}, 'b') ON CONFLICT (id) DO NOTHING`);

    // Erase the subject UNDER ORG A ONLY.
    const plan = planErasure(SUBJECT, ORG_A);
    for (const step of plan.steps) await executeErasureStep(step);

    // TERMINAL row counts. Org A's rows are gone; org B's are untouched.
    const count = async (q: ReturnType<typeof sql>): Promise<number> => {
      const r = (await db.execute(q)) as unknown as { rows: { n: string | number }[] };
      return Number(r.rows[0]?.n ?? 0);
    };

    const aConvs = await count(sql`SELECT COUNT(*)::int AS n FROM chat_conversations WHERE user_id = ${SUBJECT} AND org_id = ${ORG_A}`);
    const bConvs = await count(sql`SELECT COUNT(*)::int AS n FROM chat_conversations WHERE user_id = ${SUBJECT} AND org_id = ${ORG_B}`);
    const aMsgs = await count(sql`SELECT COUNT(*)::int AS n FROM chat_messages WHERE id = ${msgA}`);
    const bMsgs = await count(sql`SELECT COUNT(*)::int AS n FROM chat_messages WHERE id = ${msgB}`);
    const aMem = await count(sql`SELECT COUNT(*)::int AS n FROM chat_memory WHERE user_id = ${SUBJECT} AND org_id = ${ORG_A}`);
    const bMem = await count(sql`SELECT COUNT(*)::int AS n FROM chat_memory WHERE user_id = ${SUBJECT} AND org_id = ${ORG_B}`);

    assert.equal(aConvs, 0, 'org A conversations must be erased');
    assert.equal(aMem, 0, 'org A memory must be erased');
    assert.equal(aMsgs, 0, 'org A messages must be erased (via the org-scoped parent)');

    // The load-bearing cross-tenant assertion: ZERO of org B's rows were touched.
    assert.equal(bConvs, 1, 'org B conversations must SURVIVE a cross-tenant erase');
    assert.equal(bMem, 1, 'org B memory must SURVIVE a cross-tenant erase');
    assert.equal(bMsgs, 1, 'org B messages must SURVIVE (the parent-scoped DELETE must not cross tenants)');
  } finally {
    await cleanup();
  }
});
