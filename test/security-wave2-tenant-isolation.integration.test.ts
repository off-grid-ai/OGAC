import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// SECURITY EPIC — Wave 2 tenant-isolation integration tests (real Postgres). Proves, for EACH
// surface hardened in this wave (PROMPT LIBRARY, GOLDEN CASES, EVAL DEFINITIONS, ANALYTICS ALERT
// RULES + SAVED VIEWS), that tenant A cannot list/get/update/delete tenant B's rows, that writes
// stamp the caller's org, and that the same key/name coexists per-org. Skips (green) when no DB is
// up. Every row is written under dedicated `test-w2-*` org ids so real data is untouched.

const A = `test-w2-a-${randomUUID().slice(0, 8)}`;
const B = `test-w2-b-${randomUUID().slice(0, 8)}`;

const dbUp = await dbReachable();
const skip = dbUp ? false : SKIP_MESSAGE;

test('prompt library is tenant-isolated: list/get/update/delete scope by org, writes stamp org', { skip }, async (t) => {
  const prompts = await import('@/lib/prompts');
  const { db } = await import('@/db');
  const { promptLibrary } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await prompts.ensurePromptSchema();

  const ownerA = `w2-${randomUUID().slice(0, 6)}@a.test`;
  const ownerB = `w2-${randomUUID().slice(0, 6)}@b.test`;
  // ORG-visible prompts (the exact leak vector: 'org' visibility used to be visible to ALL tenants).
  const idA = await prompts.createPrompt(ownerA, { title: 'A-prompt', content: 'from A {{x}}', visibility: 'org' }, A);
  const idB = await prompts.createPrompt(ownerB, { title: 'B-prompt', content: 'from B', visibility: 'org' }, B);

  t.after(async () => {
    for (const id of [idA, idB]) await db.delete(promptLibrary).where(eq(promptLibrary.id, id)).catch(() => {});
  });

  // LIST — each org sees only its own org-visible prompts.
  const listA = (await prompts.listPrompts(ownerA, {}, A)).map((p) => p.id);
  const listB = (await prompts.listPrompts(ownerB, {}, B)).map((p) => p.id);
  assert.ok(listA.includes(idA) && !listA.includes(idB), "A lists only A's prompts (org-visibility leak closed)");
  assert.ok(listB.includes(idB) && !listB.includes(idA), "B lists only B's prompts");

  // GET — cross-org read misses even for an org-visible prompt.
  assert.ok(await prompts.getPrompt(idA, A), 'same-org get hits');
  assert.equal(await prompts.getPrompt(idA, B), null, 'cross-org get misses (no read leak)');

  // UPDATE — cross-org edit is a no-op (row untouched).
  await prompts.updatePrompt(idA, { title: 'HIJACKED' }, B);
  assert.equal((await prompts.getPrompt(idA, A))?.title, 'A-prompt', 'cross-org update left A untouched');
  await prompts.updatePrompt(idA, { title: 'A-edited' }, A);
  assert.equal((await prompts.getPrompt(idA, A))?.title, 'A-edited', 'same-org update hits');

  // DELETE — cross-org delete misses; same-org deletes.
  await prompts.deletePrompt(idA, B);
  assert.ok(await prompts.getPrompt(idA, A), 'cross-org delete did not remove A prompt');
  await prompts.deletePrompt(idA, A);
  assert.equal(await prompts.getPrompt(idA, A), null, 'same-org delete removed A prompt');
});

test('golden cases are tenant-isolated: list/get/update/delete scope by org', { skip }, async (t) => {
  const evals = await import('@/lib/evals');
  const { db } = await import('@/db');
  const { goldenCases } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await evals.ensureEvalsSchema();

  const gcA = await evals.addGoldenCase({ name: 'A-case', query: 'qA', expected: 'eA', suite: 'golden' }, { orgId: A });
  const gcB = await evals.addGoldenCase({ name: 'B-case', query: 'qB', expected: 'eB', suite: 'golden' }, { orgId: B });

  t.after(async () => {
    for (const id of [gcA.id, gcB.id]) await db.delete(goldenCases).where(eq(goldenCases.id, id)).catch(() => {});
  });

  // LIST — each org sees only its own cases.
  const listA = (await evals.listGoldenCases({ orgId: A })).map((c) => c.id);
  const listB = (await evals.listGoldenCases({ orgId: B })).map((c) => c.id);
  assert.ok(listA.includes(gcA.id) && !listA.includes(gcB.id), 'A lists only A cases (cross-tenant read leak closed)');
  assert.ok(listB.includes(gcB.id) && !listB.includes(gcA.id), 'B lists only B cases');

  // GET — cross-org read misses.
  assert.ok(await evals.getGoldenCase(gcA.id, A), 'same-org get hits');
  assert.equal(await evals.getGoldenCase(gcA.id, B), null, 'cross-org get misses');

  // UPDATE — cross-org edit is a no-op.
  const badUpdate = await evals.updateGoldenCase(gcA.id, { name: 'HIJACKED', query: 'x', expected: 'y', suite: 'golden' }, B);
  assert.equal(badUpdate, null, 'cross-org update returns null (404 at the route)');
  assert.equal((await evals.getGoldenCase(gcA.id, A))?.name, 'A-case', 'A case untouched by cross-org update');

  // DELETE — cross-org delete misses; same-org deletes.
  await evals.deleteGoldenCase(gcA.id, B);
  assert.ok(await evals.getGoldenCase(gcA.id, A), 'cross-org delete did not remove A case');
  await evals.deleteGoldenCase(gcA.id, A);
  assert.equal(await evals.getGoldenCase(gcA.id, A), null, 'same-org delete removed A case');
});

test('eval definitions are tenant-isolated: list/get/update/delete scope by org', { skip }, async (t) => {
  const evalDefs = await import('@/lib/eval-defs');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await evalDefs.ensureEvalDefsSchema();

  const draft = { name: 'faithfulness', templateId: '', metric: 'faithfulness', engine: 'ragas' as const, direction: 'higher-better' as const, threshold: 0.7, suite: 'golden', description: '' };
  const edA = await evalDefs.addEvalDef({ ...draft, name: 'A-eval' }, 'a@test', { orgId: A });
  const edB = await evalDefs.addEvalDef({ ...draft, name: 'B-eval' }, 'b@test', { orgId: B });

  t.after(async () => {
    for (const id of [edA.id, edB.id]) await db.execute(sql`DELETE FROM eval_definitions WHERE id = ${id};`).catch(() => {});
  });

  // LIST — each org sees only its own defs.
  const listA = (await evalDefs.listEvalDefs({ orgId: A })).map((d) => d.id);
  const listB = (await evalDefs.listEvalDefs({ orgId: B })).map((d) => d.id);
  assert.ok(listA.includes(edA.id) && !listA.includes(edB.id), 'A lists only A eval defs (cross-tenant leak closed)');
  assert.ok(listB.includes(edB.id) && !listB.includes(edA.id), 'B lists only B eval defs');

  // GET — cross-org read misses (blocks cross-tenant RUN, which resolves the def by id + org).
  assert.ok(await evalDefs.getEvalDef(edA.id, A), 'same-org get hits');
  assert.equal(await evalDefs.getEvalDef(edA.id, B), null, 'cross-org get misses (cross-tenant run blocked)');

  // UPDATE — cross-org edit is a no-op.
  const badUpdate = await evalDefs.updateEvalDef(edA.id, { ...draft, name: 'HIJACKED' }, B);
  assert.equal(badUpdate, null, 'cross-org update returns null (404 at the route)');
  assert.equal((await evalDefs.getEvalDef(edA.id, A))?.name, 'A-eval', 'A def untouched by cross-org update');

  // DELETE — cross-org delete misses; same-org deletes.
  await evalDefs.deleteEvalDef(edA.id, B);
  assert.ok(await evalDefs.getEvalDef(edA.id, A), 'cross-org delete did not remove A def');
  await evalDefs.deleteEvalDef(edA.id, A);
  assert.equal(await evalDefs.getEvalDef(edA.id, A), null, 'same-org delete removed A def');
});

test('analytics alert rules are tenant-isolated: list/update/delete scope, name coexists per org', { skip }, async (t) => {
  const ar = await import('@/lib/analytics-rules');
  const { db } = await import('@/db');
  const { eq } = await import('drizzle-orm');
  await ar.ensureAnalyticsRulesSchema();

  const name = `w2-rule-${randomUUID().slice(0, 6)}`;
  const input = { name, metric: 'blockedRate' as const, comparator: 'gt' as const, threshold: 5, windowMinutes: 15, enabled: true };
  const rA = await ar.createRule(input, 'a@test', A);
  const rB = await ar.createRule({ ...input, threshold: 99 }, 'b@test', B); // SAME name, different org

  t.after(async () => {
    for (const org of [A, B]) await db.delete(ar.alertRules).where(eq(ar.alertRules.orgId, org)).catch(() => {});
  });

  // LIST — same name coexists; each org sees only its own rule.
  assert.deepEqual((await ar.listRules(A)).map((r) => r.id), [rA.id], 'A sees only A rule (same name coexists per org)');
  assert.deepEqual((await ar.listRules(B)).map((r) => r.id), [rB.id], 'B sees only B rule');

  // UPDATE — cross-org edit is a no-op.
  const bad = await ar.updateRule(rA.id, { ...input, threshold: 1 }, B);
  assert.equal(bad, null, 'cross-org update returns null');
  assert.equal((await ar.listRules(A))[0].threshold, 5, 'A rule threshold untouched by cross-org update');

  // DELETE — cross-org delete misses; same-org deletes.
  await ar.deleteRule(rA.id, B);
  assert.equal((await ar.listRules(A)).length, 1, 'cross-org delete did not remove A rule');
  await ar.deleteRule(rA.id, A);
  assert.equal((await ar.listRules(A)).length, 0, 'same-org delete removed A rule');
});

test('analytics saved views are tenant-isolated: list/update/delete scope by org', { skip }, async (t) => {
  const ar = await import('@/lib/analytics-rules');
  const { db } = await import('@/db');
  const { eq } = await import('drizzle-orm');
  await ar.ensureAnalyticsRulesSchema();

  const vInput = { name: `w2-view-${randomUUID().slice(0, 6)}`, range: '7d', model: '', outcome: '' };
  const vA = await ar.createView(vInput, 'a@test', A);
  const vB = await ar.createView({ ...vInput, range: '30d' }, 'b@test', B);

  t.after(async () => {
    for (const org of [A, B]) await db.delete(ar.savedViews).where(eq(ar.savedViews.orgId, org)).catch(() => {});
  });

  assert.deepEqual((await ar.listViews(A)).map((v) => v.id), [vA.id], 'A sees only A view');
  assert.deepEqual((await ar.listViews(B)).map((v) => v.id), [vB.id], 'B sees only B view');

  // Cross-org edit/delete are no-ops.
  const bad = await ar.updateView(vA.id, { ...vInput, range: '90d' }, B);
  assert.equal(bad, null, 'cross-org view update returns null');
  await ar.deleteView(vA.id, B);
  assert.equal((await ar.listViews(A)).length, 1, 'cross-org delete did not remove A view');
  await ar.deleteView(vA.id, A);
  assert.equal((await ar.listViews(A)).length, 0, 'same-org delete removed A view');
});
