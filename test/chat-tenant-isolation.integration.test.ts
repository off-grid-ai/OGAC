import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test (real Postgres) for the Workspace Chat tenant-isolation fix. The bug: conversation
// + project reads/writes were scoped ONLY by userId, so the SAME user saw the identical chat/project
// list on EVERY tenant subdomain (a fresh tenant showed the default org's chats). The fix threads the
// host-bound orgId (currentOrgId) into listConversations/getConversation/createConversation and
// listProjects/createProject. This proves a user's chats/projects in org A are invisible in org B, and
// a cross-org read of a specific id returns null. Skips (green) when no DB is up.

const USER = 'iso-test@x.io';
const ORG_A = 'test-iso-org-a';
const ORG_B = 'test-iso-org-b';

const dbUp = await dbReachable();

test('chat conversations are tenant-isolated by org', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createConversation, listConversations, getConversation, deleteConversation } = await import(
    '@/lib/chat'
  );
  const made: string[] = [];
  t.after(async () => {
    for (const id of made) await deleteConversation(USER, id).catch(() => {});
  });

  const a1 = await createConversation(USER, ORG_A);
  const a2 = await createConversation(USER, ORG_A);
  const b1 = await createConversation(USER, ORG_B);
  made.push(a1, a2, b1);

  // Org A sees only its two; org B sees only its one — never each other's.
  const listA = await listConversations(USER, ORG_A);
  const listB = await listConversations(USER, ORG_B);
  const idsA = new Set(listA.map((c) => c.id));
  const idsB = new Set(listB.map((c) => c.id));
  assert.ok(idsA.has(a1) && idsA.has(a2), 'org A must see its own conversations');
  assert.ok(!idsA.has(b1), 'org A must NOT see org B conversation (the isolation bug)');
  assert.ok(idsB.has(b1), 'org B must see its own conversation');
  assert.ok(!idsB.has(a1) && !idsB.has(a2), 'org B must NOT see org A conversations');

  // A specific conversation cannot be cross-read from the wrong org.
  assert.ok(await getConversation(USER, ORG_A, a1), 'same-org read resolves');
  assert.equal(await getConversation(USER, ORG_B, a1), null, 'cross-org read is denied (null)');
});

test('chat projects are tenant-isolated by org', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createProject, listProjects, deleteProject } = await import('@/lib/chat');
  const made: string[] = [];
  t.after(async () => {
    for (const id of made) await deleteProject(USER, id).catch(() => {});
  });

  const pa = await createProject(USER, ORG_A, 'A project');
  const pb = await createProject(USER, ORG_B, 'B project');
  made.push(pa, pb);

  const projA = await listProjects(USER, ORG_A);
  const projB = await listProjects(USER, ORG_B);
  const idsA = new Set(projA.map((p) => p.id));
  const idsB = new Set(projB.map((p) => p.id));
  assert.ok(idsA.has(pa) && !idsA.has(pb), 'org A sees only its own project');
  assert.ok(idsB.has(pb) && !idsB.has(pa), 'org B sees only its own project');
});
