// ─── Which of these run ids can we actually show? (I/O) ──────────────────────────────────────────
//
// The copilot cites audit records that name a run — "[run apprun_eee51b30]" — and linking to that run
// is the most useful thing the citation can do. But the audit ledger outlives the runs it describes:
// that particular id is in the audit log and NOT in app_runs, so the link 404'd. A dead link from a
// citation is worse than no link, because the citation is the part the reader is being asked to trust.
//
// So: ask which ids exist, and only link the ones that do. One query per copilot answer, over three
// small tables, keyed by ids we already have in hand.
//
// Fails CLOSED to an empty set. If the lookup errors we link nothing rather than linking everything —
// an unverified link is exactly what this exists to prevent.

/** The subset of `ids` that name a run this org can actually open. */
export async function existingRunIds(
  orgId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  const wanted = [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
  if (wanted.length === 0) return new Set();
  try {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    // One round trip across the three run planes. Org-scoped like every other tenant read — a run
    // belonging to another tenant must not become a link, whether or not it exists.
    const res = await db.execute(sql`
      SELECT id FROM app_runs   WHERE org_id = ${orgId} AND id = ANY(${wanted})
      UNION ALL
      SELECT id FROM agent_runs WHERE org_id = ${orgId} AND id = ANY(${wanted})
    `);
    const rows = (res as unknown as { rows?: { id?: unknown }[] }).rows ?? [];
    return new Set(rows.map((r) => String(r.id ?? '')).filter(Boolean));
  } catch {
    return new Set();
  }
}
