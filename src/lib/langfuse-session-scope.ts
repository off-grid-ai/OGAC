// ─── Which recorded sessions belong to a tenant (thin I/O adapter) ────────────────────────────────
//
// A session in the observability store carries NO owner marker — no tag, no metadata, no user. Its id is
// one of our own run ids (`run_…`), and our database does know who owns those. So ownership is resolved
// here, by asking our own tables, and the pure decision stays in `filterSessionsForOrg`.
//
// This exists because the sessions list was part of the same cross-tenant leak as prompts, datasets and
// traces: every tenant saw every tenant's recorded sessions. Sessions leak less than a prompt body (an
// opaque run id and a timestamp rather than another bank's system prompt), but "leaks less" is not a
// reason to leave a boundary off — and unlike the other three, this one could be closed with data we
// already had.
//
// The alternative was to hide sessions entirely, which is what the "unattributable records belong to
// nobody" rule would otherwise require. That would have emptied a panel to fix a leak; resolving real
// ownership keeps the surface honest AND populated.

import { inArray, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuns, appRuns } from '@/db/schema';

/**
 * The run ids this org owns, across both governed-run tables.
 *
 * Best-effort: a failed lookup returns an EMPTY set, which shows the tenant no sessions. That is the
 * safe direction — a database hiccup must never widen the boundary — but it does mean an empty sessions
 * panel can indicate a failed read rather than genuinely no sessions, so the caller should not present
 * emptiness here as a positive statement about the data.
 */
export async function ownedRunIdsForOrg(orgId: string): Promise<Set<string>> {
  try {
    const [agents, apps] = await Promise.all([
      db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.orgId, orgId)),
      db.select({ id: appRuns.id }).from(appRuns).where(eq(appRuns.orgId, orgId)),
    ]);
    return new Set([...agents, ...apps].map((r) => r.id));
  } catch {
    return new Set();
  }
}

/**
 * Do these session ids belong to this org? Used by the per-session detail reads, where returning the
 * wrong tenant's session is the same defect as listing it.
 */
export async function ownedSessionIds(
  orgId: string,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  try {
    const ids = [...candidateIds];
    const [agents, apps] = await Promise.all([
      db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(inArray(agentRuns.id, ids)),
      db.select({ id: appRuns.id }).from(appRuns).where(inArray(appRuns.id, ids)),
    ]);
    // Re-check the org on the rows we got back rather than trusting the id list.
    const owned = new Set<string>();
    for (const row of [...agents, ...apps]) owned.add(row.id);
    const scoped = await ownedRunIdsForOrg(orgId);
    return new Set([...owned].filter((id) => scoped.has(id)));
  } catch {
    return new Set();
  }
}
