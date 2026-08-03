import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { summariseReview, type SubjectDecision } from '@/lib/access-review';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Durable access-review artefacts (I/O adapter; pure rules in access-review.ts). Self-migrating on
// first use, like the other console-owned stores, so it deploys with no migration step.

export interface AccessReviewRecord {
  id: string;
  reviewedBy: string;
  completedAt: Date;
  summary: string;
  decisions: SubjectDecision[];
  /** What was actually applied, per decision — recorded because a review that only SAYS it revoked is worthless. */
  applied: { email: string; action: string; ok: boolean; detail?: string }[];
}

let ensurePromise: Promise<void> | null = null;
export async function ensureAccessReviewsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS access_reviews (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        reviewed_by text NOT NULL DEFAULT '',
        summary text NOT NULL DEFAULT '',
        decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
        applied jsonb NOT NULL DEFAULT '[]'::jsonb,
        completed_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS access_reviews_org_idx ON access_reviews (org_id, completed_at DESC);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  id: string;
  reviewed_by: string;
  summary: string;
  decisions: SubjectDecision[];
  applied: AccessReviewRecord['applied'];
  completed_at: string | Date;
}

function toRecord(r: Row): AccessReviewRecord {
  return {
    id: r.id,
    reviewedBy: r.reviewed_by,
    summary: r.summary,
    decisions: r.decisions ?? [],
    applied: r.applied ?? [],
    completedAt: new Date(r.completed_at),
  };
}

export async function listAccessReviews(
  orgId: string = DEFAULT_ORG,
  limit = 25,
): Promise<AccessReviewRecord[]> {
  await ensureAccessReviewsSchema();
  const res = await db.execute(sql`
    SELECT id, reviewed_by, summary, decisions, applied, completed_at
    FROM access_reviews WHERE org_id = ${orgId} ORDER BY completed_at DESC LIMIT ${limit};
  `);
  return (res.rows as unknown as Row[]).map(toRecord);
}

/** When the org last certified its access list, or null if it never has. */
export async function lastAccessReviewAt(orgId: string = DEFAULT_ORG): Promise<Date | null> {
  const [latest] = await listAccessReviews(orgId, 1);
  return latest?.completedAt ?? null;
}

export async function recordAccessReview(
  input: {
    reviewedBy: string;
    decisions: SubjectDecision[];
    applied: AccessReviewRecord['applied'];
  },
  orgId: string = DEFAULT_ORG,
): Promise<AccessReviewRecord> {
  await ensureAccessReviewsSchema();
  const id = `arev_${randomUUID().slice(0, 10)}`;
  const summary = summariseReview(input.decisions);
  const res = await db.execute(sql`
    INSERT INTO access_reviews (id, org_id, reviewed_by, summary, decisions, applied)
    VALUES (${id}, ${orgId}, ${input.reviewedBy}, ${summary},
            ${JSON.stringify(input.decisions)}::jsonb, ${JSON.stringify(input.applied)}::jsonb)
    RETURNING id, reviewed_by, summary, decisions, applied, completed_at;
  `);
  return toRecord((res.rows as unknown as Row[])[0]);
}
