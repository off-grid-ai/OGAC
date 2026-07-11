import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
// @ts-expect-error — .mjs helper, no types
import { dbAvailable } from './helpers/db-available.mjs';

// INTEGRATION (T2): proves the REAL stores for the four tenant-scoped tables (custom_agents,
// prompts+prompt_versions, org_knowledge_collections+docs, eval_runs) isolate by org against a REAL
// Postgres. For each: a list scoped to org A must NOT return org B's rows, and cross-org get/update/
// delete must be DENIED (a caller in org A can neither read nor mutate org B's row). Children inherit
// scope through their parent. Skips green when the DB is down.

const { ok, reason } = await dbAvailable();
const skip = ok ? undefined : reason;

const ORG_A = 'test_org_a_t2';
const ORG_B = 'test_org_b_t2';

describe('T2 org-scoping — cross-tenant isolation (integration)', { skip }, () => {
  let store: typeof import('../src/lib/store.ts');
  let ok_: typeof import('../src/lib/org-knowledge.ts');
  let evals: typeof import('../src/lib/evals.ts');
  let db: typeof import('../src/db/index.ts');
  let sql: typeof import('drizzle-orm').sql;

  const cleanup: Array<() => Promise<void>> = [];

  before(async () => {
    store = await import('../src/lib/store.ts');
    ok_ = await import('../src/lib/org-knowledge.ts');
    evals = await import('../src/lib/evals.ts');
    db = await import('../src/db/index.ts');
    ({ sql } = await import('drizzle-orm'));
    // Make sure the org_id columns exist (idempotent) so the test runs on any DB state.
    await ok_.listCollections('admin', ORG_A).catch(() => {}); // triggers ensureSchema (self-migrates)
    await evals.listEvalRuns(1, ORG_A).catch(() => {}); // triggers ensureEvalsSchema (self-migrates)
    await db.db
      .execute(sql`ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`)
      .catch(() => {});
    await db.db
      .execute(sql`ALTER TABLE prompts ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`)
      .catch(() => {});
  });

  after(async () => {
    for (const c of cleanup) await c().catch(() => {});
  });

  // ── custom_agents ─────────────────────────────────────────────────────────────────────────────
  test('custom agents: list/get/update/delete are org-isolated', async () => {
    const a = await store.createCustomAgent({ name: 'A-agent', systemPrompt: 'a' }, ORG_A);
    const b = await store.createCustomAgent({ name: 'B-agent', systemPrompt: 'b' }, ORG_B);
    cleanup.push(async () => {
      await store.deleteCustomAgent(a.id, ORG_A);
      await store.deleteCustomAgent(b.id, ORG_B);
    });

    // LIST scoped to A does not include B's agent.
    const listA = await store.listCustomAgents(ORG_A);
    assert.ok(listA.some((x) => x.id === a.id), 'A sees its own agent');
    assert.ok(!listA.some((x) => x.id === b.id), 'A must NOT see org B agent');

    // GET across org is denied.
    assert.equal(await store.getCustomAgent(b.id, ORG_A), undefined, 'A cannot get B agent');
    assert.ok(await store.getCustomAgent(b.id, ORG_B), 'B can get its own agent');

    // UPDATE across org is a no-op (returns undefined) and does not mutate B's row.
    const crossUpdate = await store.updateCustomAgent(b.id, { name: 'HACKED' }, ORG_A);
    assert.equal(crossUpdate, undefined, 'cross-org update denied');
    assert.equal((await store.getCustomAgent(b.id, ORG_B))?.name, 'B-agent', 'B row untouched');

    // DELETE across org leaves B's row intact.
    await store.deleteCustomAgent(b.id, ORG_A);
    assert.ok(await store.getCustomAgent(b.id, ORG_B), 'cross-org delete denied — B row survives');
  });

  // ── prompts + prompt_versions (child inherits parent org) ───────────────────────────────────────
  test('prompt registry: list + version history are org-isolated', async () => {
    const a = await store.createPrompt('A-prompt', 'a', ORG_A);
    const b = await store.createPrompt('B-prompt', 'b', ORG_B);
    cleanup.push(async () => {
      await store.deletePrompt(a.id, ORG_A);
      await store.deletePrompt(b.id, ORG_B);
    });

    const listA = await store.listPrompts(ORG_A);
    assert.ok(listA.some((x) => x.id === a.id));
    assert.ok(!listA.some((x) => x.id === b.id), 'A must NOT see org B prompt');

    // Publishing a version to B's prompt from org A is denied (parent-scope guard).
    const denied = await store.addPromptVersion(b.id, 'sneaky body', 'prod', ORG_A);
    assert.equal(denied, null, 'cannot version another org prompt');

    // B can version its own; A cannot read that history.
    const v = await store.addPromptVersion(b.id, 'legit body', 'prod', ORG_B);
    assert.ok(v, 'B versions its own prompt');
    assert.equal(
      (await store.listPromptVersions(b.id, ORG_A)).length,
      0,
      'A cannot read B prompt versions',
    );
    assert.equal(
      (await store.listPromptVersions(b.id, ORG_B)).length,
      1,
      'B reads its own version history',
    );

    // Cross-org delete leaves B's prompt intact.
    await store.deletePrompt(b.id, ORG_A);
    const stillThere = await store.listPrompts(ORG_B);
    assert.ok(stillThere.some((x) => x.id === b.id), 'cross-org delete denied');
  });

  // ── org_knowledge_collections + docs (child inherits parent org) ────────────────────────────────
  test('knowledge collections + docs are org-isolated', async () => {
    const aId = await ok_.createCollection('a@test', { name: 'A-col' }, ORG_A);
    const bId = await ok_.createCollection('b@test', { name: 'B-col' }, ORG_B);
    cleanup.push(async () => {
      await ok_.deleteCollection(aId, ORG_A);
      await ok_.deleteCollection(bId, ORG_B);
    });

    // LIST as admin scoped to A excludes B's collection.
    const listA = await ok_.listCollections('admin', ORG_A);
    assert.ok(listA.some((c) => c.id === aId));
    assert.ok(!listA.some((c) => c.id === bId), 'A must NOT see org B collection');

    // GET across org is denied.
    assert.equal(await ok_.getCollection(bId, ORG_A), null, 'A cannot get B collection');

    // Indexing a doc into B's collection from org A is rejected (parent-scope guard). Use raw-text
    // path but expect a throw before any embed call, since the collection isn't A's.
    await assert.rejects(
      () => ok_.addDocument(bId, 'x.txt', 'hello world', undefined, ORG_A),
      /collection not found/,
      'cannot index into another org collection',
    );

    // listDocuments across org returns empty (never leaks another org's docs).
    assert.deepEqual(await ok_.listDocuments(bId, ORG_A), [], 'A cannot list B docs');

    // Cross-org deleteCollection is a no-op — B's collection survives.
    await ok_.deleteCollection(bId, ORG_A);
    assert.ok(await ok_.getCollection(bId, ORG_B), 'cross-org collection delete denied');
  });

  // ── createCollection is idempotent when given a STABLE id (the seed path) ─────────────────────────
  // Regression guard for the duplicated "Insurance Policies & SOPs" bug: seeding the same collection
  // twice with the same deterministic id must create exactly ONE row (ON CONFLICT DO NOTHING), and
  // must NOT clobber the original's created_by.
  test('createCollection with a fixed id is idempotent (no duplicate on re-run)', async () => {
    const stableId = `kc_stable_${Date.now()}`;
    const first = await ok_.createCollection('admin@suraksha.example', { id: stableId, name: 'Insurance Policies & SOPs' }, ORG_A);
    const second = await ok_.createCollection('someone-else@x', { id: stableId, name: 'Insurance Policies & SOPs (dup attempt)' }, ORG_A);
    cleanup.push(async () => {
      await ok_.deleteCollection(stableId, ORG_A);
    });
    assert.equal(first, stableId);
    assert.equal(second, stableId, 'a re-run returns the same id, not a new one');
    const listA = await ok_.listCollections('admin', ORG_A);
    const matches = listA.filter((c) => c.id === stableId);
    assert.equal(matches.length, 1, 'exactly one collection row — no duplicate');
    assert.equal(matches[0].name, 'Insurance Policies & SOPs', 'original row untouched (ON CONFLICT DO NOTHING)');
    assert.equal(matches[0].createdBy, 'admin@suraksha.example', 'original created_by preserved');
  });

  // ── eval_runs ───────────────────────────────────────────────────────────────────────────────────
  test('eval runs list/get are org-isolated', async () => {
    const idA = `evtest_a_${Date.now()}`;
    const idB = `evtest_b_${Date.now()}`;
    await evals.recordEvalRun({ id: idA, engine: 'golden', score: 90, total: 10, passed: 9 }, ORG_A);
    await evals.recordEvalRun({ id: idB, engine: 'golden', score: 50, total: 10, passed: 5 }, ORG_B);
    cleanup.push(async () => {
      await db.db.execute(sql`DELETE FROM eval_runs WHERE id IN (${idA}, ${idB});`);
    });

    const listA = await evals.listEvalRuns(50, ORG_A);
    assert.ok(listA.some((r) => r.id === idA), 'A sees its own run');
    assert.ok(!listA.some((r) => r.id === idB), 'A must NOT see org B run');

    // GET across org resolves to null.
    assert.equal(await evals.getEvalRun(idB, ORG_A), null, 'A cannot get B run');
    assert.ok(await evals.getEvalRun(idB, ORG_B), 'B gets its own run');
  });
});
