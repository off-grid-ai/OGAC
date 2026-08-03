import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  isRetainableClass,
  planSweep,
  summariseSweep,
  sweepComplete,
  type RetentionRule,
  type SweepOutcome,
  type SweepTarget,
} from '@/lib/retention-sweep';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Retention rules for console-owned record classes + the durable evidence of each sweep (I/O adapter;
// pure rules in retention-sweep.ts). Self-migrating on first use, like the other stores here.

let ensurePromise: Promise<void> | null = null;
export async function ensureRetentionSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS record_retention (
        org_id text NOT NULL DEFAULT 'default',
        record_class text NOT NULL,
        retain_days integer NOT NULL DEFAULT 0,
        action text NOT NULL DEFAULT 'delete',
        legal_hold boolean NOT NULL DEFAULT false,
        updated_by text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (org_id, record_class));
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS retention_runs (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        ran_by text NOT NULL DEFAULT '',
        summary text NOT NULL DEFAULT '',
        outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
        skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
        complete boolean NOT NULL DEFAULT false,
        ran_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS retention_runs_org_idx ON retention_runs (org_id, ran_at DESC);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export async function listRetentionRules(orgId: string = DEFAULT_ORG): Promise<RetentionRule[]> {
  await ensureRetentionSchema();
  const res = await db.execute<{
    record_class: string;
    retain_days: number;
    action: string;
    legal_hold: boolean;
  }>(sql`
    SELECT record_class, retain_days, action, legal_hold FROM record_retention
    WHERE org_id = ${orgId} ORDER BY record_class;
  `);
  return res.rows
    .filter((r) => isRetainableClass(r.record_class))
    .map((r) => ({
      recordClass: r.record_class as RetentionRule['recordClass'],
      retainDays: r.retain_days,
      action: r.action === 'redact' ? 'redact' : 'delete',
      legalHold: r.legal_hold,
    }));
}

export async function upsertRetentionRule(
  rule: RetentionRule,
  updatedBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureRetentionSchema();
  await db.execute(sql`
    INSERT INTO record_retention (org_id, record_class, retain_days, action, legal_hold, updated_by, updated_at)
    VALUES (${orgId}, ${rule.recordClass}, ${rule.retainDays}, ${rule.action}, ${rule.legalHold ?? false}, ${updatedBy}, now())
    ON CONFLICT (org_id, record_class) DO UPDATE SET
      retain_days = EXCLUDED.retain_days, action = EXCLUDED.action,
      legal_hold = EXCLUDED.legal_hold, updated_by = EXCLUDED.updated_by, updated_at = now();
  `);
}

export interface RetentionRunRecord {
  id: string;
  ranBy: string;
  ranAt: Date;
  summary: string;
  outcomes: SweepOutcome[];
  skipped: { recordClass: string; reason: string }[];
  complete: boolean;
}

export async function listRetentionRuns(
  orgId: string = DEFAULT_ORG,
  limit = 20,
): Promise<RetentionRunRecord[]> {
  await ensureRetentionSchema();
  const res = await db.execute<{
    id: string;
    ran_by: string;
    summary: string;
    outcomes: SweepOutcome[];
    skipped: { recordClass: string; reason: string }[];
    complete: boolean;
    ran_at: string;
  }>(sql`
    SELECT id, ran_by, summary, outcomes, skipped, complete, ran_at
    FROM retention_runs WHERE org_id = ${orgId} ORDER BY ran_at DESC LIMIT ${limit};
  `);
  return res.rows.map((r) => ({
    id: r.id,
    ranBy: r.ran_by,
    ranAt: new Date(r.ran_at),
    summary: r.summary,
    outcomes: r.outcomes ?? [],
    skipped: r.skipped ?? [],
    complete: r.complete,
  }));
}

/** How each class is swept. Deleting a run record destroys the decision trail, so 'redact' blanks the
 *  personal content and keeps the row — that is the difference between honouring retention and
 *  destroying an audit trail, and it is the operator's choice per class. */
async function sweepOne(target: SweepTarget, orgId: string): Promise<SweepOutcome> {
  const base = { recordClass: target.recordClass, action: target.action };
  try {
    if (target.recordClass === 'app_runs') {
      if (target.action === 'delete') {
        const r = await db.execute<{ n: number }>(sql`
          WITH gone AS (
            DELETE FROM app_runs WHERE org_id = ${orgId} AND started_at < ${target.cutoff} RETURNING 1)
          SELECT count(*)::int n FROM gone;`);
        const left = await db.execute<{ n: number }>(sql`
          SELECT count(*)::int n FROM app_runs WHERE org_id = ${orgId} AND started_at < ${target.cutoff};`);
        return { ...base, affected: r.rows[0]?.n ?? 0, remaining: left.rows[0]?.n ?? 0 };
      }
      // Redact: the run, its steps and its output stop carrying content; the record of the decision
      // and who made it survives, which is what an audit trail is for.
      const r = await db.execute<{ n: number }>(sql`
        WITH done AS (
          UPDATE app_runs SET input = '{}'::jsonb, outcome = '[retention: content removed]',
            steps = '[]'::jsonb
          WHERE org_id = ${orgId} AND started_at < ${target.cutoff}
            AND outcome <> '[retention: content removed]' RETURNING 1)
        SELECT count(*)::int n FROM done;`);
      const left = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int n FROM app_runs WHERE org_id = ${orgId} AND started_at < ${target.cutoff}
          AND outcome <> '[retention: content removed]';`);
      return { ...base, affected: r.rows[0]?.n ?? 0, remaining: left.rows[0]?.n ?? 0 };
    }

    if (target.recordClass === 'agent_runs') {
      if (target.action === 'delete') {
        const r = await db.execute<{ n: number }>(sql`
          WITH gone AS (
            DELETE FROM agent_runs WHERE org_id = ${orgId} AND started_at < ${target.cutoff} RETURNING 1)
          SELECT count(*)::int n FROM gone;`);
        const left = await db.execute<{ n: number }>(sql`
          SELECT count(*)::int n FROM agent_runs WHERE org_id = ${orgId} AND started_at < ${target.cutoff};`);
        return { ...base, affected: r.rows[0]?.n ?? 0, remaining: left.rows[0]?.n ?? 0 };
      }
      // Content lives in query/answer/steps/citations — verified against the live schema rather than
      // assumed, because a wrong column name would make the sweep error and report zero affected,
      // which reads as compliance.
      const r = await db.execute<{ n: number }>(sql`
        WITH done AS (
          UPDATE agent_runs SET query = '[retention: content removed]',
            answer = '[retention: content removed]', steps = '[]'::jsonb, citations = '[]'::jsonb
          WHERE org_id = ${orgId} AND started_at < ${target.cutoff}
            AND answer <> '[retention: content removed]' RETURNING 1)
        SELECT count(*)::int n FROM done;`);
      const left = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int n FROM agent_runs WHERE org_id = ${orgId} AND started_at < ${target.cutoff}
          AND answer <> '[retention: content removed]';`);
      return { ...base, affected: r.rows[0]?.n ?? 0, remaining: left.rows[0]?.n ?? 0 };
    }

    // Indexed document text. The chunk table carries NEITHER org_id NOR a timestamp (checked against
    // the live schema — assuming either would have produced a sweep that errored and reported zero
    // affected, which reads as compliance). So the age comes from the DOC and the tenant from the
    // COLLECTION, and the chunks go with their doc.
    const r = await db.execute<{ n: number }>(sql`
      WITH stale AS (
        SELECT d.id FROM org_knowledge_docs d
        JOIN org_knowledge_collections c ON c.id = d.collection_id
        WHERE c.org_id = ${orgId} AND d.created_at < ${target.cutoff}),
      gone AS (DELETE FROM org_knowledge_chunks WHERE doc_id IN (SELECT id FROM stale) RETURNING 1)
      SELECT count(*)::int n FROM gone;`);
    // The doc rows go too — a doc with no chunks is an entry that looks indexed and returns nothing.
    await db.execute(sql`
      DELETE FROM org_knowledge_docs d
      USING org_knowledge_collections c
      WHERE c.id = d.collection_id AND c.org_id = ${orgId} AND d.created_at < ${target.cutoff};`);
    const left = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int n FROM org_knowledge_chunks ch
      JOIN org_knowledge_docs d ON d.id = ch.doc_id
      JOIN org_knowledge_collections c ON c.id = d.collection_id
      WHERE c.org_id = ${orgId} AND d.created_at < ${target.cutoff};`);
    return { ...base, affected: r.rows[0]?.n ?? 0, remaining: left.rows[0]?.n ?? 0, action: 'delete' };
  } catch (e) {
    // A failure must never present as "0 records were out of retention" — that reads as compliance.
    return {
      ...base,
      affected: 0,
      remaining: -1,
      error: e instanceof Error ? e.message : 'the sweep failed',
    };
  }
}

/**
 * Run the sweep and record the evidence. `remaining` on each outcome is re-counted AFTER the work, so
 * the record proves the deletion rather than asserting it.
 */
export async function runRetentionSweep(
  ranBy: string,
  orgId: string = DEFAULT_ORG,
  now: Date = new Date(),
): Promise<RetentionRunRecord> {
  await ensureRetentionSchema();
  const plan = planSweep(await listRetentionRules(orgId), now);
  const outcomes: SweepOutcome[] = [];
  for (const t of plan.targets) outcomes.push(await sweepOne(t, orgId));

  const id = `rsw_${randomUUID().slice(0, 10)}`;
  const summary = summariseSweep(outcomes);
  const complete = sweepComplete(outcomes);
  const res = await db.execute<{ ran_at: string }>(sql`
    INSERT INTO retention_runs (id, org_id, ran_by, summary, outcomes, skipped, complete)
    VALUES (${id}, ${orgId}, ${ranBy}, ${summary}, ${JSON.stringify(outcomes)}::jsonb,
            ${JSON.stringify(plan.skipped)}::jsonb, ${complete})
    RETURNING ran_at;
  `);
  return {
    id,
    ranBy,
    ranAt: new Date(res.rows[0]?.ran_at ?? now),
    summary,
    outcomes,
    skipped: plan.skipped,
    complete,
  };
}
