import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { PartitionCursor } from '@/lib/topic-trigger-policy';

// ─── Durable state for the stream trigger (I/O adapter; all judgement is pure in
// topic-trigger-policy.ts) ───────────────────────────────────────────────────────────────────────
//
// TWO tables, because they answer two different questions and collapsing them would lose one:
//
//   topic_trigger_cursors    — WHERE TO READ NEXT. One row per (app, topic, partition).
//   topic_trigger_deliveries — WHAT ALREADY RAN. One row per broker record we acted on.
//
// The cursor alone is not enough. The whole point of committing after the run is durable is that a
// crash in between leaves the cursor behind — so the record IS redelivered. Without the ledger that
// redelivery starts a second governed run of work that already ran, and on a topic carrying payment
// or claim instructions a duplicate run is a real-world duplicate action. The ledger is what turns
// at-least-once delivery into effectively-once execution.
//
// Both tables live in the DATABASE, alongside the runs they account for, so "the run is recorded"
// and "the record is accounted for" are the same transaction boundary — not two systems that can
// disagree after a restart.
//
// Self-migrating on first use like the other console-owned stores: the rsync deploy has no migration
// step, so a table that only exists after someone remembers to run a migration does not exist.

let ensurePromise: Promise<void> | null = null;

export async function ensureTopicTriggerSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS topic_trigger_cursors (
        app_id text NOT NULL,
        topic text NOT NULL,
        partition integer NOT NULL,
        next_offset text NOT NULL,
        org_id text NOT NULL,
        group_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_id, topic, partition));
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS topic_trigger_deliveries (
        app_id text NOT NULL,
        delivery_key text NOT NULL,
        disposition text NOT NULL,
        run_id text,
        note text,
        org_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_id, delivery_key));
    `);
    // Reading the ledger back is per-app and time-ordered (the app's stream activity view), so the
    // index matches that access pattern rather than the primary key's.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS topic_trigger_deliveries_recent
        ON topic_trigger_deliveries (app_id, created_at DESC);
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── cursors ────────────────────────────────────────────────────────────────────────────────────

/**
 * Where this app's consumer should read from next, per partition.
 *
 * THROWS on a read failure. An empty list means "this trigger has never consumed anything", which the
 * planner answers by starting at the live edge — so a failed read presented as emptiness would skip
 * every record that arrived while the database was unreachable, silently and permanently.
 */
export async function readTopicCursors(appId: string, topic: string): Promise<PartitionCursor[]> {
  await ensureTopicTriggerSchema();
  const res = await db.execute(sql`
    SELECT partition, next_offset FROM topic_trigger_cursors
    WHERE app_id = ${appId} AND topic = ${topic}
    ORDER BY partition;
  `);
  const rows = (res as unknown as { rows: CursorRow[] }).rows ?? [];
  return rows.map((r) => ({ partition: Number(r.partition), nextOffset: String(r.next_offset) }));
}

/**
 * Move a partition's cursor forward.
 *
 * The monotonic guard is in SQL as well as in `advanceCursor`, deliberately. Two consumer processes
 * against one app is a misconfiguration rather than a design, but if it happens the slower one must
 * not be able to rewind the faster one's progress and re-run governed work. `GREATEST` over a bigint
 * cast, not a text comparison — as text, '9' sorts after '10'.
 */
export async function commitTopicCursor(input: {
  appId: string;
  orgId: string;
  topic: string;
  groupId: string;
  partition: number;
  nextOffset: string;
}): Promise<void> {
  await ensureTopicTriggerSchema();
  await db.execute(sql`
    INSERT INTO topic_trigger_cursors (app_id, topic, partition, next_offset, org_id, group_id)
    VALUES (${input.appId}, ${input.topic}, ${input.partition}, ${input.nextOffset},
            ${input.orgId}, ${input.groupId})
    ON CONFLICT (app_id, topic, partition) DO UPDATE SET
      next_offset = GREATEST(
        topic_trigger_cursors.next_offset::numeric,
        EXCLUDED.next_offset::numeric)::text,
      group_id = EXCLUDED.group_id,
      updated_at = now();
  `);
}

// ─── the delivery ledger ────────────────────────────────────────────────────────────────────────

interface CursorRow {
  partition: number | string;
  next_offset: string;
}

interface DeliveryRow {
  delivery_key: string;
  disposition: string;
  run_id: string | null;
  note: string | null;
  created_at: string | Date;
}

export type DeliveryDisposition = 'ran' | 'duplicate' | 'parked' | 'failed';

export interface DeliveryRecord {
  deliveryKey: string;
  disposition: DeliveryDisposition;
  runId: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * Which of these deliveries has this app already acted on?
 *
 * Scoped to the keys being considered rather than loading the whole ledger: the ledger grows with
 * every record forever, and a consumer that reads all of it gets slower the longer it runs.
 *
 * THROWS on failure, same reason as the cursors: "nothing has been seen" is an answer that causes
 * re-execution, so it must never be what a broken read looks like.
 */
export async function readSeenDeliveries(
  appId: string,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  await ensureTopicTriggerSchema();
  // Passed as ONE json parameter, not an array binding: the query builder expands a JS array into a
  // tuple `($1, $2, …)`, which Postgres refuses to cast to text[]. Found by the integration test —
  // a mocked store would have reported this as working.
  const res = await db.execute(sql`
    SELECT delivery_key FROM topic_trigger_deliveries
    WHERE app_id = ${appId}
      AND delivery_key IN (SELECT jsonb_array_elements_text(${JSON.stringify([...keys])}::jsonb));
  `);
  const rows = (res as unknown as { rows: Array<{ delivery_key: string }> }).rows ?? [];
  return new Set(rows.map((r) => String(r.delivery_key)));
}

/**
 * Record that a delivery was acted on. THIS IS THE DURABILITY THE CURSOR WAITS FOR — the caller may
 * only advance the cursor after this resolves, so a crash before it re-delivers rather than loses.
 *
 * Idempotent on (app, delivery key): a redelivery that races two consumers writes one row.
 */
export async function recordDelivery(input: {
  appId: string;
  orgId: string;
  deliveryKey: string;
  disposition: DeliveryDisposition;
  runId?: string | null;
  note?: string | null;
}): Promise<void> {
  await ensureTopicTriggerSchema();
  await db.execute(sql`
    INSERT INTO topic_trigger_deliveries (app_id, delivery_key, disposition, run_id, note, org_id)
    VALUES (${input.appId}, ${input.deliveryKey}, ${input.disposition},
            ${input.runId ?? null}, ${input.note ?? null}, ${input.orgId})
    ON CONFLICT (app_id, delivery_key) DO UPDATE SET
      disposition = EXCLUDED.disposition,
      run_id = COALESCE(EXCLUDED.run_id, topic_trigger_deliveries.run_id),
      note = EXCLUDED.note;
  `);
}

/** The app's recent stream activity, newest first — what the operator sees on the app's surface. */
export async function listRecentDeliveries(appId: string, limit = 25): Promise<DeliveryRecord[]> {
  await ensureTopicTriggerSchema();
  const res = await db.execute(sql`
    SELECT delivery_key, disposition, run_id, note, created_at
    FROM topic_trigger_deliveries
    WHERE app_id = ${appId}
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(200, limit))};
  `);
  const rows = (res as unknown as { rows: DeliveryRow[] }).rows ?? [];
  return rows.map((r) => ({
    deliveryKey: String(r.delivery_key),
    disposition: r.disposition as DeliveryDisposition,
    runId: r.run_id ? String(r.run_id) : null,
    note: r.note ? String(r.note) : null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
