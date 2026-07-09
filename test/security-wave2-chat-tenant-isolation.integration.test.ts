import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// SECURITY EPIC — Wave 2 tenant-isolation integration tests (real Postgres). Closes the REMAINING
// chat sub-resources that were still global after Wave 1 (which scoped chatConversations/chatProjects).
// Proves, per surface, that tenant A cannot read/delete tenant B's chat MEMORY, chat SKILLS, or chat
// ARTIFACTS (list/history/publish/revert/delete), and that "delete all conversations" for org A leaves
// org B's chats intact. Skips (green) when no DB is up. Rows use dedicated `test-w2-*` org ids and a
// unique user so real data is untouched. Artifacts are inserted with the legacy `code` column (no
// codeKey) so the body hydrates from Postgres — no SeaweedFS dependency for the isolation assertions.

const A = `test-w2-a-${randomUUID().slice(0, 8)}`;
const B = `test-w2-b-${randomUUID().slice(0, 8)}`;
const USER = `w2-${randomUUID().slice(0, 8)}@iso.test`;

const dbUp = await dbReachable();
const skip = dbUp ? false : SKIP_MESSAGE;

test('chat memory is tenant-isolated: list/add/delete/factsByIds scope by (user, org)', { skip }, async (t) => {
  const chat = await import('@/lib/chat');
  const { db } = await import('@/db');
  const { chatMemory } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  t.after(async () => {
    await db.delete(chatMemory).where(eq(chatMemory.userId, USER)).catch(() => {});
  });

  await chat.addMemory(USER, A, 'A-only fact', 'manual');
  await chat.addMemory(USER, B, 'B-only fact', 'manual');

  const memA = (await chat.listMemory(USER, A)).map((m) => m.fact);
  const memB = (await chat.listMemory(USER, B)).map((m) => m.fact);
  assert.ok(memA.includes('A-only fact') && !memA.includes('B-only fact'), 'A sees only A fact');
  assert.ok(memB.includes('B-only fact') && !memB.includes('A-only fact'), 'B sees only B fact');

  // memoryBlock (injected into chats) never leaks the other tenant's facts.
  assert.ok((await chat.memoryBlock(USER, A)).includes('A-only fact'), 'A block has A fact');
  assert.ok(!(await chat.memoryBlock(USER, A)).includes('B-only fact'), 'A block never has B fact');

  // @-mention resolution can't reach the other tenant's fact by id.
  const [aRow] = await db.select().from(chatMemory).where(eq(chatMemory.orgId, A));
  assert.deepEqual(await chat.memoryFactsByIds(USER, A, [aRow.id]), ['A-only fact'], 'A resolves A id');
  assert.deepEqual(await chat.memoryFactsByIds(USER, B, [aRow.id]), [], 'cross-org id resolves to nothing');

  // Cross-org delete misses; same-org delete hits.
  await chat.deleteMemory(USER, B, aRow.id); // wrong org id
  assert.equal((await chat.listMemory(USER, A)).length, 1, 'cross-org delete left A fact intact');
  await chat.deleteMemory(USER, A, aRow.id);
  assert.equal((await chat.listMemory(USER, A)).length, 0, 'same-org delete removed A fact');
});

test('chat skills are tenant-isolated: list/get/update/delete scope by org', { skip }, async (t) => {
  const chat = await import('@/lib/chat');
  const { db } = await import('@/db');
  const { chatSkills } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  t.after(async () => {
    for (const org of [A, B]) await db.delete(chatSkills).where(eq(chatSkills.orgId, org)).catch(() => {});
  });

  const sA = await chat.createSkill(USER, A, { name: 'A skill', visibility: 'org' });
  const sB = await chat.createSkill(USER, B, { name: 'B skill', visibility: 'org' });

  // list (admin role sees all WITHIN its org, never the other org's).
  const idsA = new Set((await chat.listSkills(A, 'admin')).map((s) => s.id));
  const idsB = new Set((await chat.listSkills(B, 'admin')).map((s) => s.id));
  assert.ok(idsA.has(sA) && !idsA.has(sB), 'A lists only A skill (cross-tenant picker leak closed)');
  assert.ok(idsB.has(sB) && !idsB.has(sA), 'B lists only B skill');

  // get — cross-org get misses.
  assert.ok(await chat.getSkill(A, sA), 'same-org get hits');
  assert.equal(await chat.getSkill(B, sA), null, 'cross-org get misses');

  // update — cross-org update is a no-op on A's skill.
  await chat.updateSkill(B, sA, { name: 'HIJACKED' }); // wrong org
  assert.equal((await chat.getSkill(A, sA))?.name, 'A skill', 'cross-org update left A skill untouched');
  await chat.updateSkill(A, sA, { name: 'A renamed' });
  assert.equal((await chat.getSkill(A, sA))?.name, 'A renamed', 'same-org update hits');

  // delete — cross-org delete misses; same-org hits.
  await chat.deleteSkill(B, sA); // wrong org
  assert.ok(await chat.getSkill(A, sA), 'cross-org delete did not remove A skill');
  await chat.deleteSkill(A, sA);
  assert.equal(await chat.getSkill(A, sA), null, 'same-org delete removed A skill');
});

test('chat artifacts are tenant-isolated: list/history/publish/revert/delete scope by (user, org)', { skip }, async (t) => {
  const chat = await import('@/lib/chat');
  const { db } = await import('@/db');
  const { chatArtifacts, chatArtifactVersions } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  // Seed one artifact per org directly (legacy `code` column, no codeKey → body hydrates from PG,
  // no SeaweedFS needed). Two versions on A so revert/history has something to walk.
  const idA = randomUUID();
  const idB = randomUUID();
  await chat.ensureChatSchema();
  await db.insert(chatArtifacts).values([
    { id: idA, userId: USER, orgId: A, kind: 'html', code: '<b>A v2</b>', title: 'shared-title', currentVersion: 2 },
    { id: idB, userId: USER, orgId: B, kind: 'html', code: '<b>B</b>', title: 'shared-title', currentVersion: 1 },
  ]);
  await db.insert(chatArtifactVersions).values([
    { id: randomUUID(), artifactId: idA, version: 1, kind: 'html', code: '<b>A v1</b>' },
    { id: randomUUID(), artifactId: idA, version: 2, kind: 'html', code: '<b>A v2</b>' },
    { id: randomUUID(), artifactId: idB, version: 1, kind: 'html', code: '<b>B</b>' },
  ]);

  t.after(async () => {
    for (const id of [idA, idB]) {
      await db.delete(chatArtifactVersions).where(eq(chatArtifactVersions.artifactId, id)).catch(() => {});
      await db.delete(chatArtifacts).where(eq(chatArtifacts.id, id)).catch(() => {});
    }
  });

  // LIST — each org sees only its own artifact even though titles collide.
  const listA = (await chat.listArtifacts(USER, A)).map((a) => a.id);
  const listB = (await chat.listArtifacts(USER, B)).map((a) => a.id);
  assert.ok(listA.includes(idA) && !listA.includes(idB), 'A lists only A artifact');
  assert.ok(listB.includes(idB) && !listB.includes(idA), 'B lists only B artifact');

  // HISTORY — cross-org version read is denied (null); same-org resolves.
  assert.equal(await chat.listArtifactVersions(USER, B, idA), null, 'cross-org history denied');
  assert.equal((await chat.listArtifactVersions(USER, A, idA))?.length, 2, 'same-org history resolves');

  // PUBLISH — cross-org publish misses (false); same-org hits.
  assert.equal(await chat.setArtifactPublished(USER, B, idA, true), false, 'cross-org publish misses');
  assert.equal((await db.select().from(chatArtifacts).where(eq(chatArtifacts.id, idA)))[0].published, false, 'A not published cross-org');
  assert.equal(await chat.setArtifactPublished(USER, A, idA, true), true, 'same-org publish hits');

  // REVERT — cross-org revert misses (null); same-org advances the head.
  assert.equal(await chat.revertArtifact(USER, B, idA, 1), null, 'cross-org revert misses');

  // DELETE — cross-org delete misses; same-org removes A + its versions.
  await chat.deleteArtifact(USER, B, idA); // wrong org
  assert.ok((await chat.listArtifacts(USER, A)).some((a) => a.id === idA), 'cross-org delete left A artifact');
  await chat.deleteArtifact(USER, A, idA);
  assert.ok(!(await chat.listArtifacts(USER, A)).some((a) => a.id === idA), 'same-org delete removed A artifact');
  assert.equal((await db.select().from(chatArtifactVersions).where(eq(chatArtifactVersions.artifactId, idA))).length, 0, 'A versions cascaded');
});

test('deleteAllConversations is tenant-scoped: wiping org A leaves org B chats intact', { skip }, async (t) => {
  const chat = await import('@/lib/chat');
  const { db } = await import('@/db');
  const { chatConversations } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const madeB: string[] = [];
  t.after(async () => {
    for (const org of [A, B]) await db.delete(chatConversations).where(eq(chatConversations.orgId, org)).catch(() => {});
    void madeB;
  });

  const a1 = await chat.createConversation(USER, A);
  const a2 = await chat.createConversation(USER, A);
  const b1 = await chat.createConversation(USER, B);
  madeB.push(b1);

  // Sanity: both orgs populated.
  assert.equal((await chat.listConversations(USER, A)).length, 2, 'A has 2 chats before wipe');
  assert.equal((await chat.listConversations(USER, B)).length, 1, 'B has 1 chat before wipe');

  // Wipe A only.
  await chat.deleteAllConversations(USER, A);

  assert.equal((await chat.listConversations(USER, A)).length, 0, 'A wiped');
  const listB = (await chat.listConversations(USER, B)).map((c) => c.id);
  assert.deepEqual(listB, [b1], 'B chats survive A wipe (cross-tenant delete-all leak closed)');
  void [a1, a2];
});
