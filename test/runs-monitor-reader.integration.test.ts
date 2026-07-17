import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// Exercises the real Postgres readers that feed Operations → Runs. The audit ledger is append-only,
// so this writes two legitimate observations for one chat execution, plus app/agent executions with
// the same raw provider id. The read model must return exactly three executions with stable,
// kind-scoped keys and owner-specific detail routes. No Off Grid code is mocked.

const ORG = 'test-int-runs-dedup';
const SHARED_ID = 'provider-collision-42';
const dbUp = await dbReachable();

test(
  'listAllRuns deduplicates repeated chat observations and preserves cross-kind id collisions',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { db } = await import('@/db');
    const { agentRuns, appRuns } = await import('@/db/schema');
    const { listAllRuns, getRunByKey } = await import('@/lib/runs-monitor-reader');
    const { persistAuditEvent } = await import('@/lib/store');
    const { eq, sql } = await import('drizzle-orm');

    t.after(async () => {
      await db.execute(sql`DELETE FROM audit_events_v2 WHERE org = ${ORG}`);
      await db.delete(appRuns).where(eq(appRuns.orgId, ORG));
      await db.delete(agentRuns).where(eq(agentRuns.orgId, ORG));
    });

    await db.delete(appRuns).where(eq(appRuns.orgId, ORG));
    await db.delete(agentRuns).where(eq(agentRuns.orgId, ORG));
    await persistAuditEvent({
      ts: '2026-07-17T06:00:00.000Z',
      actor: { type: 'user', id: 'operator@offgrid.test', label: 'Operator' },
      org: ORG,
      action: 'chat.run',
      resource: 'conversation:claims-1',
      model: 'old-model',
      outcome: 'error',
      runId: SHARED_ID,
    });
    await persistAuditEvent({
      ts: '2026-07-17T06:00:02.000Z',
      actor: { type: 'user', id: 'operator@offgrid.test', label: 'Operator' },
      org: ORG,
      action: 'chat.run',
      resource: 'conversation:claims-1',
      model: 'current-model',
      outcome: 'ok',
      runId: SHARED_ID,
    });
    await db.insert(appRuns).values({
      id: SHARED_ID,
      orgId: ORG,
      appId: 'claims-app',
      status: 'done',
      startedAt: new Date('2026-07-17T06:00:01.000Z'),
    });
    await db.insert(agentRuns).values({
      id: SHARED_ID,
      orgId: ORG,
      agentId: 'claims-agent',
      query: 'Assess this claim',
      answer: 'Approved',
      status: 'done',
      steps: [],
      citations: [],
      checks: [],
      provenance: null,
      startedAt: new Date('2026-07-17T06:00:03.000Z'),
    });

    const rows = await listAllRuns(ORG);
    assert.equal(rows.length, 3, 'two audit observations represent one chat execution');
    assert.deepEqual(rows.map((row) => row.key).sort(), [
      `agent:${SHARED_ID}`,
      `app:${SHARED_ID}`,
      `chat:${SHARED_ID}`,
    ]);
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length, 'React keys are stable');

    const chat = rows.find((row) => row.kind === 'chat');
    assert.equal(chat?.status, 'succeeded', 'the latest chat observation owns current status');
    assert.equal(chat?.pipeline, 'current-model');
    assert.equal(chat?.href, `/operations/runs/chat%3A${SHARED_ID}`);
    assert.equal(
      rows.find((row) => row.kind === 'agent')?.href,
      `/operations/runs/agent%3A${SHARED_ID}`,
      'agent execution stays owned by the Operations detail route',
    );
    assert.equal(
      rows.find((row) => row.kind === 'app')?.href,
      `/build/apps/claims-app/runs/${SHARED_ID}`,
      'app execution stays owned by its app lifecycle detail and actions',
    );

    assert.equal((await getRunByKey(`chat:${SHARED_ID}`, ORG))?.key, `chat:${SHARED_ID}`);
    assert.equal((await getRunByKey(`agent:${SHARED_ID}`, ORG))?.key, `agent:${SHARED_ID}`);
  },
);
