import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// SECURITY EPIC — Wave 2 tenant-isolation integration tests (real Postgres) for the RUNS surfaces:
//   • G-ISO-2 — an app-run submitted under org X PERSISTS + reads back under X, never under 'default'.
//     Proven by running the REAL runApp with the REAL persist (upsertAppRunState) — only the two
//     external boundaries (agent/connector) are faked — then reading the row back org-scoped.
//   • agent-run by-id IDOR — tenant A cannot getAgentRun / cancel / re-run(delete) tenant B's run by
//     guessing its id (a cross-tenant lookup returns null / no-op).
// Skips (green) when no DB is up. Every row is written under dedicated `test-w2-*` orgs so real data
// is untouched.

const A = `test-w2-a-${randomUUID().slice(0, 8)}`;
const B = `test-w2-b-${randomUUID().slice(0, 8)}`;

const dbUp = await dbReachable();
const skip = dbUp ? false : SKIP_MESSAGE;

// ─── G-ISO-2 — an app-run persists under the RUN's real org, not DEFAULT_ORG ──────────────────────
test('G-ISO-2: an app-run submitted under org A persists + reads back under A (never default)', { skip }, async (t) => {
  const { runApp, defaultDeps, newAppRunId } = await import('@/lib/app-run');
  const { getAppRunView } = await import('@/lib/app-runs-view-reader');
  const { db } = await import('@/db');
  const { appRuns } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const APP = `app_w2_${randomUUID().slice(0, 6)}`;
  const runId = newAppRunId();

  t.after(async () => {
    await db.delete(appRuns).where(eq(appRuns.id, runId)).catch(() => {});
  });

  // A trivial 1-step spec (a console output). No agent/connector boundary is even touched, so we use
  // the REAL defaultDeps — its REAL persist writes to app_runs — and only the org threading matters.
  const spec = {
    id: APP,
    orgId: A,
    ownerId: 'u1',
    title: 'W2 iso',
    summary: '',
    visibility: 'private' as const,
    published: false,
    trigger: { kind: 'on-demand' as const },
    steps: [{ id: 's1', label: 'Output', kind: 'output' as const, sink: 'console' as const }],
    edges: [],
  };

  const outcome = await runApp(spec, { note: 'hello A' }, { orgId: A, runId });
  assert.equal(outcome.status, 'done', 'the run completes');

  // Reads back under the RUN's real org A …
  const viewA = await getAppRunView(runId, A);
  assert.ok(viewA, 'the app-run row is readable under org A');
  assert.equal(viewA!.id, runId);

  // … and NOT under 'default' (the pre-fix bug: the row landed under DEFAULT_ORG).
  const viewDefault = await getAppRunView(runId, 'default');
  assert.equal(viewDefault, null, 'the row does NOT land under default (G-ISO-2 regression closed)');

  // … and NOT under a different tenant B.
  const viewB = await getAppRunView(runId, B);
  assert.equal(viewB, null, 'a different tenant cannot read A run');

  // Belt-and-braces: the stored org_id column is A, verified directly.
  const [row] = await db.select().from(appRuns).where(eq(appRuns.id, runId)).limit(1);
  assert.equal(row?.orgId, A, 'the app_runs.org_id column stores the run’s real org, not default');
});

// ─── agent-run by-id lookups are org-scoped (cross-tenant IDOR blocked) ───────────────────────────
test('agent-run by-id reads/cancel/delete are org-scoped: A cannot touch B’s run', { skip }, async (t) => {
  const agentrun = await import('@/lib/agentrun');
  const { db } = await import('@/db');
  const { agentRuns } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const idB = `run_w2_${randomUUID().slice(0, 8)}`;

  // Seed a pending_review run OWNED BY tenant B directly (bypass the pipeline — we only test lookups).
  await db.insert(agentRuns).values({
    id: idB,
    orgId: B,
    agentId: 'ag_b',
    query: 'B private query',
    answer: 'B secret answer',
    status: 'pending_review',
    steps: [],
    citations: [],
    checks: [],
    provenance: null,
  });

  t.after(async () => {
    await db.delete(agentRuns).where(eq(agentRuns.id, idB)).catch(() => {});
  });

  // GET — same-org read hits, cross-org read misses (IDOR blocked).
  const readB = await agentrun.getAgentRun(idB, B);
  assert.ok(readB, 'B reads its own run');
  assert.equal(readB!.answer, 'B secret answer');
  const readA = await agentrun.getAgentRun(idB, A);
  assert.equal(readA, null, 'A cannot read B’s run by id (cross-tenant read blocked)');

  // CANCEL — cross-org cancel is a no-op (returns null, row untouched); same-org cancel hits.
  const cancelA = await agentrun.cancelAgentRun(idB, A);
  assert.equal(cancelA, null, 'A cannot cancel B’s run (cross-tenant cancel blocked)');
  const stillPending = await agentrun.getAgentRun(idB, B);
  assert.equal(stillPending!.status, 'pending_review', 'B’s run is untouched by A’s cancel attempt');
  const cancelB = await agentrun.cancelAgentRun(idB, B);
  assert.ok(cancelB, 'B cancels its own run');
  assert.equal(cancelB!.status, 'cancelled');

  // DELETE — cross-org delete is a no-op (row survives); same-org delete removes it.
  const delA = await agentrun.deleteAgentRun(idB, A);
  assert.equal(delA, false, 'A cannot delete B’s run (cross-tenant delete blocked)');
  assert.ok(await agentrun.getAgentRun(idB, B), 'B’s run survives A’s delete attempt');
  const delB = await agentrun.deleteAgentRun(idB, B);
  assert.equal(delB, true, 'B deletes its own run');
  assert.equal(await agentrun.getAgentRun(idB, B), null, 'B’s run is gone after its own delete');
});

// ─── listAgentRunsByAgent is org-scoped ───────────────────────────────────────────────────────────
test('listAgentRunsByAgent is org-scoped: A’s listing never includes B’s runs', { skip }, async (t) => {
  const agentrun = await import('@/lib/agentrun');
  const { db } = await import('@/db');
  const { agentRuns } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const AGENT = `ag_shared_${randomUUID().slice(0, 6)}`;
  const idA = `run_w2a_${randomUUID().slice(0, 8)}`;
  const idB = `run_w2b_${randomUUID().slice(0, 8)}`;

  // Same agentId, two tenants — the ONLY thing separating them is org_id.
  for (const [id, org] of [[idA, A], [idB, B]] as const) {
    await db.insert(agentRuns).values({
      id, orgId: org, agentId: AGENT, query: `${org} q`, answer: `${org} a`,
      status: 'done', steps: [], citations: [], checks: [], provenance: null,
    });
  }

  t.after(async () => {
    for (const id of [idA, idB]) await db.delete(agentRuns).where(eq(agentRuns.id, id)).catch(() => {});
  });

  const listA = (await agentrun.listAgentRunsByAgent(AGENT, 50, A)).map((r) => r.id);
  const listB = (await agentrun.listAgentRunsByAgent(AGENT, 50, B)).map((r) => r.id);
  assert.ok(listA.includes(idA) && !listA.includes(idB), 'A lists only A’s run for the shared agent');
  assert.ok(listB.includes(idB) && !listB.includes(idA), 'B lists only B’s run for the shared agent');
});
