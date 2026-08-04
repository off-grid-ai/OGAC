import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { ZERO_COUNTERS, type CacheCounters, type ProcessTally } from '@/lib/cache-evidence';

// Durable per-process cache tallies (I/O adapter; all judgement is pure, in cache-evidence.ts).
// Self-migrating on first use like the other console-owned stores, so it deploys with no migration step.
//
// WHY THIS IS IN THE DATABASE AND NOT THE CACHE: the failure these counters exist to catch is the shared
// cache being unreachable. Keeping the evidence in that same store would lose it at exactly the moment it
// matters. The database is a different dependency, so a cache outage is recordable.
//
// One row PER ROLE, not per process instance: a row per pid would grow without bound and every restart
// would orphan its numbers. Roles are upserted, so a restarted worker replaces its own reading.

/** Stable role for this process. Pure so the argv sniffing is testable. */
export function processRole(argv: readonly string[], envRole?: string): string {
  const explicit = envRole?.trim();
  if (explicit) return explicit;
  // The workers are launched as `tsx scripts/*-worker.mts`; the web process never is.
  return argv.some((a) => /worker/i.test(a)) ? 'worker' : 'web';
}

let ensurePromise: Promise<void> | null = null;
export async function ensureCacheTalliesSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cache_process_tallies (
        label text PRIMARY KEY,
        counters jsonb NOT NULL DEFAULT '{}'::jsonb,
        reported_at timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

/** Write this process's snapshot. Replaces the role's previous reading rather than accumulating rows. */
export async function recordCacheTally(label: string, counters: CacheCounters): Promise<void> {
  await ensureCacheTalliesSchema();
  await db.execute(sql`
    INSERT INTO cache_process_tallies (label, counters, reported_at)
    VALUES (${label}, ${JSON.stringify(counters)}::jsonb, now())
    ON CONFLICT (label) DO UPDATE SET counters = EXCLUDED.counters, reported_at = EXCLUDED.reported_at;
  `);
}

interface Row {
  label: string;
  counters: Partial<CacheCounters> | null;
  reported_at: string | Date;
}

/**
 * Every role's latest snapshot.
 *
 * THROWS on a read failure rather than returning an empty list: an empty list means "no process has
 * reported", which the surface renders as an unexercised cache. A failed read that presents as emptiness
 * would report a working cache as idle.
 */
export async function readCacheTallies(): Promise<ProcessTally[]> {
  await ensureCacheTalliesSchema();
  const res = await db.execute(sql`
    SELECT label, counters, reported_at FROM cache_process_tallies ORDER BY reported_at DESC;
  `);
  const rows = (res as unknown as { rows: Row[] }).rows ?? [];
  return rows.map((r) => ({
    label: r.label,
    // Merged over zeroes so a snapshot written by an older build cannot produce NaN totals.
    counters: { ...ZERO_COUNTERS, ...(r.counters ?? {}) } as CacheCounters,
    reportedAt: new Date(r.reported_at).getTime(),
  }));
}
