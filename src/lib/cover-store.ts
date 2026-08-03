import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { isActive, type CoverWindow } from '@/lib/cover';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Cover windows (I/O adapter; pure rules in cover.ts). Self-migrating on first use, like the other
// console-owned stores, so it deploys with no migration step.

export interface CoverRecord extends CoverWindow {
  id: string;
  createdBy: string;
  createdAt: Date;
}

let ensurePromise: Promise<void> | null = null;
export async function ensureCoverSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cover_windows (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        away text NOT NULL,
        covered_by text NOT NULL DEFAULT '',
        from_day date NOT NULL,
        until_day date NOT NULL,
        note text NOT NULL DEFAULT '',
        created_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS cover_windows_org_idx ON cover_windows (org_id, until_day DESC);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  id: string;
  away: string;
  covered_by: string;
  from_day: string | Date;
  until_day: string | Date;
  note: string;
  created_by: string;
  created_at: string | Date;
}

const day = (v: string | Date): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

function toRecord(r: Row): CoverRecord {
  return {
    id: r.id,
    away: r.away,
    coveredBy: r.covered_by,
    from: day(r.from_day),
    until: day(r.until_day),
    note: r.note || undefined,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at),
  };
}

export async function listCover(orgId: string = DEFAULT_ORG): Promise<CoverRecord[]> {
  await ensureCoverSchema();
  const res = await db.execute(sql`
    SELECT id, away, covered_by, from_day, until_day, note, created_by, created_at
    FROM cover_windows WHERE org_id = ${orgId} ORDER BY until_day DESC LIMIT 200;
  `);
  return (res.rows as unknown as Row[]).map(toRecord);
}

/** Only the windows in force today — what the queue surfaces and the digest actually act on. */
export async function activeCover(
  today: string,
  orgId: string = DEFAULT_ORG,
): Promise<CoverRecord[]> {
  return (await listCover(orgId)).filter((w) => isActive(w, today));
}

export async function addCover(
  w: CoverWindow,
  createdBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<CoverRecord> {
  await ensureCoverSchema();
  const id = `cov_${randomUUID().slice(0, 10)}`;
  const res = await db.execute(sql`
    INSERT INTO cover_windows (id, org_id, away, covered_by, from_day, until_day, note, created_by)
    VALUES (${id}, ${orgId}, ${w.away.trim()}, ${w.coveredBy.trim()}, ${w.from}, ${w.until},
            ${w.note ?? ''}, ${createdBy})
    RETURNING id, away, covered_by, from_day, until_day, note, created_by, created_at;
  `);
  return toRecord((res.rows as unknown as Row[])[0]);
}

/** Ending cover early is the common case — someone comes back sooner than planned. */
export async function endCover(
  id: string,
  today: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  await ensureCoverSchema();
  const res = await db.execute(sql`
    UPDATE cover_windows SET until_day = ${today}
    WHERE id = ${id} AND org_id = ${orgId} AND until_day > ${today}
    RETURNING id;
  `);
  return (res.rows as unknown[]).length > 0;
}

export async function deleteCover(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureCoverSchema();
  const res = await db.execute(sql`
    DELETE FROM cover_windows WHERE id = ${id} AND org_id = ${orgId} RETURNING id;
  `);
  return (res.rows as unknown[]).length > 0;
}
