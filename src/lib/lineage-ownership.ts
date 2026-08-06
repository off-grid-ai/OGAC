// ─── Which lineage entities a tenant owns (thin I/O adapter) ──────────────────────────────────────
//
// The lineage store has no tenant dimension — a Marquez dataset carries no owner tag and no facet, so
// ownership must be resolved against our own tables. This is the adapter that does the asking; the
// decision itself is pure and lives in lineage-tenancy.ts.
//
// Same shape, and the same failure posture, as langfuse-session-scope.ts: a failed lookup returns an
// EMPTY set, which shows the tenant nothing. That is the safe direction — a database hiccup must never
// widen a tenant boundary — but it does mean an empty lineage graph can indicate a failed read rather
// than genuinely no lineage, so the caller must not present emptiness as a positive statement.

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuns, appRuns, chatConversations, connectors } from '@/db/schema';
import { NO_LINEAGE_KEYS, type OwnedLineageKeys } from '@/lib/lineage-tenancy';

/**
 * Everything this org owns that a lineage node can name.
 *
 * The four queries run together because the graph read is already the slow part of the page and these
 * are all small indexed lookups on org_id.
 */
export async function ownedLineageKeysForOrg(orgId: string): Promise<OwnedLineageKeys> {
  try {
    const [agentRunRows, appRunRows, chatRows, connectorRows] = await Promise.all([
      db
        .select({ id: agentRuns.id, agentId: agentRuns.agentId })
        .from(agentRuns)
        .where(eq(agentRuns.orgId, orgId)),
      db.select({ id: appRuns.id }).from(appRuns).where(eq(appRuns.orgId, orgId)),
      db
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(eq(chatConversations.orgId, orgId)),
      db.select({ id: connectors.id }).from(connectors).where(eq(connectors.orgId, orgId)),
    ]);

    // `run_…` datasets come from BOTH governed-run tables; the graph does not distinguish them.
    const runs = new Set<string>([...agentRunRows.map((r) => r.id), ...appRunRows.map((r) => r.id)]);

    // A `chat:<conversationId>` job and a `chatrun_<id>` dataset both trace back to a conversation.
    const chats = new Set<string>(chatRows.map((r) => r.id));
    const chatRuns = new Set<string>(chatRows.map((r) => `chatrun_${r.id}`));

    return {
      runs,
      chatRuns,
      chats,
      // An `agent:<id>` job is owned if this org has ever run that agent. Agents have no standalone
      // table with an org column; agent_runs.agent_id is the authoritative link we have.
      agents: new Set<string>(agentRunRows.map((r) => r.agentId)),
      connectors: new Set<string>(connectorRows.map((r) => r.id)),
    };
  } catch {
    return NO_LINEAGE_KEYS;
  }
}
