// I/O seam for the async publish-gate jobs (M1-a). Thin CRUD over the `publish_jobs` table
// (drizzle; org-scoped). The PURE state model + legal transitions live in publish-job.ts — this
// module only reads/writes rows and maps them to the pure view. Includes an idempotent self-migrate
// (CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS) so it works on a DB that hasn't run
// the migration yet (deploy is rsync-only, no migration step over SSH) — same pattern as pipelines.ts.

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { publishJobs } from '@/db/schema';
import type { PublishJob } from '@/db/schema';
import {
  isTerminal,
  nextStatus,
  type PublishJobDecision,
  type PublishJobStatus,
  type PublishJobView,
} from '@/lib/publish-job';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

let ensurePromise: Promise<void> | null = null;
export async function ensurePublishJobsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS publish_jobs (
        id text PRIMARY KEY,
        pipeline_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        status text NOT NULL DEFAULT 'gating',
        override boolean NOT NULL DEFAULT false,
        created_by text NOT NULL DEFAULT '',
        decision jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    for (const col of [
      'ADD COLUMN IF NOT EXISTS override boolean NOT NULL DEFAULT false',
      "ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT ''",
      'ADD COLUMN IF NOT EXISTS decision jsonb',
      'ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()',
    ]) {
      await db.execute(sql.raw(`ALTER TABLE publish_jobs ${col};`));
    }
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS publish_jobs_pipeline_idx ON publish_jobs (pipeline_id);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

function iso(v: string | Date | null | undefined): string | null {
  return v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;
}

function toView(r: PublishJob): PublishJobView {
  return {
    jobId: r.id,
    pipelineId: r.pipelineId,
    status: r.status as PublishJobStatus,
    decision: (r.decision as unknown as PublishJobDecision) ?? null,
    createdAt: iso(r.createdAt),
  };
}

/** Create a gating job for a pipeline. Returns the new job view (status='gating'). */
export async function createPublishJob(input: {
  pipelineId: string;
  orgId?: string;
  override?: boolean;
  by?: string;
}): Promise<PublishJobView> {
  await ensurePublishJobsSchema();
  const id = `pj_${randomUUID().slice(0, 12)}`;
  const orgId = input.orgId ?? DEFAULT_ORG;
  const [row] = await db
    .insert(publishJobs)
    .values({
      id,
      pipelineId: input.pipelineId,
      orgId,
      status: 'gating',
      override: input.override === true,
      createdBy: input.by ?? '',
    })
    .returning();
  return toView(row);
}

/** Read a job by id (org-scoped). Null when it doesn't exist for this org. */
export async function getPublishJob(
  jobId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PublishJobView | null> {
  await ensurePublishJobsSchema();
  const rows = await db
    .select()
    .from(publishJobs)
    .where(and(eq(publishJobs.id, jobId), eq(publishJobs.orgId, orgId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** The pipeline's publish jobs, newest first (for the Quality tab history / latest-gating lookup). */
export async function listPublishJobs(
  pipelineId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PublishJobView[]> {
  await ensurePublishJobsSchema();
  const rows = await db
    .select()
    .from(publishJobs)
    .where(and(eq(publishJobs.pipelineId, pipelineId), eq(publishJobs.orgId, orgId)))
    .orderBy(desc(publishJobs.createdAt));
  return rows.map(toView);
}

/**
 * Resolve a gating job to a terminal state (published | blocked) with its decision payload.
 * Guards the transition through the PURE nextStatus rule: a job that is already terminal is NOT
 * re-resolved (returns the current view unchanged) — no double-publish on a duplicate completion.
 */
export async function resolvePublishJob(
  jobId: string,
  to: 'published' | 'blocked',
  decision: PublishJobDecision,
  orgId: string = DEFAULT_ORG,
): Promise<PublishJobView | null> {
  await ensurePublishJobsSchema();
  const current = await getPublishJob(jobId, orgId);
  if (!current) return null;
  if (isTerminal(current.status)) return current; // already resolved — frozen
  const target = nextStatus(current.status, to);
  if (!target) return current;
  const [row] = await db
    .update(publishJobs)
    .set({ status: target, decision: decision as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(and(eq(publishJobs.id, jobId), eq(publishJobs.orgId, orgId)))
    .returning();
  return row ? toView(row) : null;
}

/** Delete a job (test cleanup / operator dismissal). */
export async function deletePublishJob(jobId: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensurePublishJobsSchema();
  await db.delete(publishJobs).where(and(eq(publishJobs.id, jobId), eq(publishJobs.orgId, orgId)));
}
