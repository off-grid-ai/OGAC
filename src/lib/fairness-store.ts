// ─── Retained fairness checks (I/O) ───────────────────────────────────────────────────────────────────
//
// A control that has never run is not yet a control. Retention taught this the hard way: the settings
// existed and were evaluated for DISPLAY, and "prove you delete data when you said you would" had no
// answer because no sweep was ever recorded. Fairness would have gone the same way — a page that computes
// a ratio on demand and keeps nothing, so "show me your last fairness review" gets a live screen rather
// than a dated artefact.
//
// So a check is RUN and FILED, exactly like a retention sweep or an access review. The stored record keeps
// the whole report, including the untestable findings, because "we looked on this date and could not yet
// test gender" is the defensible position and dropping it would leave a gap someone later reads as a pass.
//
// Self-migrating: the rsync deploy has no migration step.

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import type { FairnessReport } from '@/lib/fairness';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

export interface FairnessRunRecord {
  id: string;
  appId: string;
  appTitle: string;
  ranBy: string;
  ranAt: string;
  decided: number;
  /** How many attributes the check could actually test. */
  tested: number;
  /** How many showed a gap worth explaining. */
  flagged: number;
  report: FairnessReport;
}

let ensured: Promise<void> | null = null;
export async function ensureFairnessSchema(): Promise<void> {
  ensured ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS fairness_runs (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        app_id text NOT NULL,
        app_title text NOT NULL DEFAULT '',
        ran_by text NOT NULL DEFAULT '',
        decided integer NOT NULL DEFAULT 0,
        tested integer NOT NULL DEFAULT 0,
        flagged integer NOT NULL DEFAULT 0,
        report jsonb NOT NULL,
        ran_at timestamptz NOT NULL DEFAULT now()
      );`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS fairness_runs_app_idx ON fairness_runs (org_id, app_id, ran_at DESC);`,
    );
  })();
  return ensured;
}

interface Row extends Record<string, unknown> {
  id: string;
  app_id: string;
  app_title: string;
  ran_by: string;
  decided: number;
  tested: number;
  flagged: number;
  report: FairnessReport;
  ran_at: Date | string;
}

function toRecord(r: Row): FairnessRunRecord {
  return {
    id: r.id,
    appId: r.app_id,
    appTitle: r.app_title,
    ranBy: r.ran_by,
    ranAt: r.ran_at instanceof Date ? r.ran_at.toISOString() : String(r.ran_at),
    decided: Number(r.decided),
    tested: Number(r.tested),
    flagged: Number(r.flagged),
    report: r.report,
  };
}

export async function recordFairnessRun(
  input: { appId: string; appTitle: string; ranBy: string; report: FairnessReport },
  orgId: string = DEFAULT_ORG,
): Promise<FairnessRunRecord> {
  await ensureFairnessSchema();
  const id = `fair_${randomUUID().slice(0, 12)}`;
  const tested = input.report.findings.filter((f) => f.verdict !== 'not-enough-data').length;
  const flagged = input.report.findings.filter((f) => f.verdict === 'investigate').length;
  const { rows } = await db.execute<{ ran_at: Date | string }>(sql`
    INSERT INTO fairness_runs (id, org_id, app_id, app_title, ran_by, decided, tested, flagged, report)
    VALUES (${id}, ${orgId}, ${input.appId}, ${input.appTitle}, ${input.ranBy},
            ${input.report.decided}, ${tested}, ${flagged}, ${JSON.stringify(input.report)}::jsonb)
    RETURNING ran_at;`);
  return {
    id,
    appId: input.appId,
    appTitle: input.appTitle,
    ranBy: input.ranBy,
    ranAt: rows[0]?.ran_at instanceof Date ? (rows[0].ran_at as Date).toISOString() : String(rows[0]?.ran_at ?? ''),
    decided: input.report.decided,
    tested,
    flagged,
    report: input.report,
  };
}

/** Checks filed for one app, newest first. */
export async function listFairnessRuns(
  appId: string,
  orgId: string = DEFAULT_ORG,
  limit = 10,
): Promise<FairnessRunRecord[]> {
  await ensureFairnessSchema();
  const { rows } = await db.execute<Row>(sql`
    SELECT id, app_id, app_title, ran_by, decided, tested, flagged, report, ran_at
    FROM fairness_runs WHERE org_id = ${orgId} AND app_id = ${appId}
    ORDER BY ran_at DESC LIMIT ${limit};`);
  return rows.map(toRecord);
}

/** Every check filed for the org, newest first — the DPO's "show me your fairness reviews" list. */
export async function listAllFairnessRuns(
  orgId: string = DEFAULT_ORG,
  limit = 50,
): Promise<FairnessRunRecord[]> {
  await ensureFairnessSchema();
  const { rows } = await db.execute<Row>(sql`
    SELECT id, app_id, app_title, ran_by, decided, tested, flagged, report, ran_at
    FROM fairness_runs WHERE org_id = ${orgId}
    ORDER BY ran_at DESC LIMIT ${limit};`);
  return rows.map(toRecord);
}
