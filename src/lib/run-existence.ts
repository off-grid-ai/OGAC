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
    const { agentRuns, appRuns } = await import('@/db/schema');
    const { and, eq, inArray } = await import('drizzle-orm');
    // The TYPED query, not a raw `sql` template. Written as
    // `sql\`id = ANY(${wanted})\`` drizzle expanded the JS array into a row constructor —
    // `ANY(($2, $3))` — which throws, was swallowed by the catch below, and returned an empty set.
    // Indistinguishable from "none of these runs exist", so every citation quietly lost its link
    // while the tests and the UI both looked fine.
    const [apps, agents] = await Promise.all([
      db
        .select({ id: appRuns.id })
        .from(appRuns)
        .where(and(eq(appRuns.orgId, orgId), inArray(appRuns.id, wanted))),
      db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(and(eq(agentRuns.orgId, orgId), inArray(agentRuns.id, wanted))),
    ]);
    return new Set([...apps, ...agents].map((r) => r.id));
  } catch {
    return new Set();
  }
}
