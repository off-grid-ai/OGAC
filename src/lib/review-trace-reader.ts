// ─── Review trace reader — SERVER-ONLY thin drizzle read of ONE agent-run's trace ─────────────────
//
// The reviewer's "why" (citations + faithfulness/grounding + guardrail/PII checks) comes from the
// agent-run that produced the draft. We only need to READ that row's citations + checks — NOT the
// agent-run RUNTIME (agentrun.ts, which drags in the gateway/siem/audit/next-auth chain). So this is a
// dedicated, minimal drizzle select over `agent_runs`, keeping review-inbox-reader.ts free of that
// heavy chain (SOLID: read the row you need, don't import the executor). Returns the structural
// ReviewAgentTrace the pure logic consumes, or null when the run is absent.

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuns } from '@/db/schema';
import { type ReviewAgentTrace } from '@/lib/review-inbox';

export async function getReviewTrace(agentRunId: string): Promise<ReviewAgentTrace | null> {
  const [row] = await db
    .select({ id: agentRuns.id, citations: agentRuns.citations, checks: agentRuns.checks })
    .from(agentRuns)
    .where(eq(agentRuns.id, agentRunId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    citations: (row.citations ?? []).map((c) => ({
      ref: c.ref,
      title: c.title,
      snippet: c.snippet,
      score: c.score,
      supported: c.supported,
    })),
    checks: (row.checks ?? []).map((c) => ({
      name: c.name,
      verdict: c.verdict,
      score: c.score,
      detail: c.detail,
    })),
  };
}
