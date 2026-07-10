import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// SECURITY #236 / G-ADV-CHAT-1 — adversarial, red-first cross-org RAG leak (CRITICAL). Two orgs each
// own a project with a knowledge chunk. A chat in org A retrieving org B's project MUST come back
// EMPTY — org B's chunk must NEVER surface. Asserts the TERMINAL outcome (the chunks/context the
// caller gets back from retrieve()), not a spy. Before the fix retrieve() scoped chunks by projectId
// ALONE (no org filter), so passing org B's projectId while in org A leaked B's chunk. Uses real
// Postgres; skips (green) when no DB is up. Seeds embedded chunks directly so no gateway is needed —
// the cross-org path returns EMPTY before any embedding call, so it is deterministic and offline.

const A = `test-236-a-${randomUUID().slice(0, 8)}`;
const B = `test-236-b-${randomUUID().slice(0, 8)}`;
const USER = `s236-${randomUUID().slice(0, 8)}@iso.test`;
const projA = `proj-${randomUUID().slice(0, 8)}`;
const projB = `proj-${randomUUID().slice(0, 8)}`;

const dbUp = await dbReachable();
const skip = dbUp ? false : SKIP_MESSAGE;

test('G-ADV-CHAT-1: a chat in org A can never retrieve org B project chunks', { skip }, async (t) => {
  const { retrieve, ragOrgAllows } = await import('@/lib/rag');
  const { db } = await import('@/db');
  const { chatProjects, chatDocuments, chatChunks } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const docB = `doc-${randomUUID().slice(0, 8)}`;
  const chunkB = `chunk-${randomUUID().slice(0, 8)}`;

  t.after(async () => {
    await db.delete(chatChunks).where(eq(chatChunks.docId, docB)).catch(() => {});
    await db.delete(chatDocuments).where(eq(chatDocuments.id, docB)).catch(() => {});
    for (const p of [projA, projB])
      await db.delete(chatProjects).where(eq(chatProjects.id, p)).catch(() => {});
  });

  // Two org-isolated projects; only org B's project has a document + an embedded chunk.
  await db.insert(chatProjects).values([
    { id: projA, userId: USER, orgId: A, name: 'A project' },
    { id: projB, userId: USER, orgId: B, name: 'B project' },
  ]);
  await db.insert(chatDocuments).values({
    id: docB,
    projectId: projB,
    userId: USER,
    name: 'B-secret.txt',
    kind: 'text',
    size: 42,
  });
  await db.insert(chatChunks).values({
    id: chunkB,
    docId: docB,
    projectId: projB,
    content: 'ORG-B-CONFIDENTIAL: the merger price is 1200 crore',
    position: 0,
    embedding: [0.1, 0.2, 0.3],
  });

  // THE attack: chat in org A asks to retrieve org B's project. Must be EMPTY — no context, no
  // citations, B's confidential chunk never surfaces. (Reaches the org gate and returns before any
  // embedding call, so this is deterministic offline.)
  const leak = await retrieve(projB, 'what is the merger price', 6, { orgId: A });
  assert.equal(leak.context, '', 'cross-org retrieve leaks NO context');
  assert.deepEqual(leak.citations, [], 'cross-org retrieve leaks NO citations');
  assert.ok(!leak.context.includes('ORG-B-CONFIDENTIAL'), "org B's chunk must never reach org A");

  // A missing/unknown project (no owning org row) also fails closed — not a wildcard read.
  const unknown = await retrieve(`ghost-${randomUUID()}`, 'anything', 6, { orgId: A });
  assert.equal(unknown.context, '', 'unknown project fails closed (empty)');

  // The pure tenant authority the gate consults, both ways.
  assert.equal(ragOrgAllows(B, A), false, 'org B project + org A caller ⇒ deny');
  assert.equal(ragOrgAllows(A, A), true, 'same-org ⇒ allow');
  assert.equal(ragOrgAllows(null, A), false, 'unknown project ⇒ deny (fail-closed)');
});
