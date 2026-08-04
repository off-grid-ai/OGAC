// ─── ONLINE QUALITY SCORES — retaining the continuous judge verdict ───────────────────────────────
//
// The gap this closes: every governed run is already scored out-of-band by the LLM judge
// (scoreInteraction → quality + faithfulness), but the verdict was ONLY posted to Langfuse. If
// Langfuse is down, not deployed, or simply not the operator's tool, the continuous quality signal
// evaporated — and the console could not answer "is this app's answer quality holding up?" from its
// own data. An eval you cannot look back on is not a standing loop; it's a one-off.
//
// SOLID: this file owns the RETAINED RECORD — the pure shaping + trend rules live here with zero I/O
// (unit-testable), and the store adapter below is the thin persistence, self-creating its table the
// same way presidio-anonymizer-policy-store.ts does so it deploys with no migration step.
//
// It is ADDITIVE and never load-bearing: retention failing must never fail (or slow) a governed run,
// because a scoring side-effect is not worth breaking the work the user asked for.

/** One retained verdict. Deliberately its own shape — `eval_runs` is a SUITE run (score/total/passed)
 *  and forcing a per-interaction verdict into it would be a shape-hack that drifts both. */
export interface OnlineScore {
  runId: string;
  orgId: string;
  /** The scored entity: the agent or app the run belongs to (for per-entity trend). */
  subjectId: string;
  quality: number; // 0..1
  faithfulness: number; // 0..1
  /** false ⇒ the judge could not produce a verdict (gateway unreachable) — retained honestly, not as a zero score. */
  judged: boolean;
  reasoning: string;
  ts: string; // ISO
}

/** Clamp a judge score into 0..1; a non-finite/absent score becomes 0. PURE. */
export function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Shape a judge result into the retained record. PURE. An UNJUDGED result (the gateway was
 * unreachable) is retained with judged:false rather than dropped or stored as a 0 — a missing
 * measurement and a bad measurement mean very different things to whoever reads the trend.
 */
export function toOnlineScore(args: {
  runId: string;
  orgId: string;
  subjectId: string;
  quality: unknown;
  faithfulness: unknown;
  judged: boolean;
  reasoning?: string;
  now?: string;
}): OnlineScore {
  return {
    runId: args.runId,
    orgId: args.orgId || 'default',
    subjectId: args.subjectId || 'unknown',
    quality: args.judged ? clampScore(args.quality) : 0,
    faithfulness: args.judged ? clampScore(args.faithfulness) : 0,
    judged: args.judged,
    reasoning: (args.reasoning ?? '').slice(0, 2000),
    ts: args.now ?? new Date().toISOString(),
  };
}

export interface QualityTrend {
  subjectId: string;
  /** How many JUDGED verdicts the averages are computed from. */
  judged: number;
  /** Verdicts retained but unjudged (engine unreachable) — surfaced so an empty trend is explainable. */
  unjudged: number;
  avgQuality: number;
  avgFaithfulness: number;
  /** Judged verdicts below the threshold — what an operator actually wants to look at. */
  belowThreshold: number;
}

/**
 * Aggregate retained verdicts into a per-subject trend. PURE. UNJUDGED rows are counted separately
 * and EXCLUDED from the averages — including them would drag quality toward zero every time the judge
 * was merely unavailable, which would be a lie about the answers themselves.
 */
export function summarizeQuality(
  scores: readonly OnlineScore[],
  threshold = 0.7,
): QualityTrend[] {
  const bySubject = new Map<string, OnlineScore[]>();
  for (const s of scores) {
    const list = bySubject.get(s.subjectId) ?? [];
    list.push(s);
    bySubject.set(s.subjectId, list);
  }
  const avg = (nums: number[]): number =>
    nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;

  return [...bySubject.entries()]
    .map(([subjectId, list]) => {
      const judged = list.filter((s) => s.judged);
      return {
        subjectId,
        judged: judged.length,
        unjudged: list.length - judged.length,
        avgQuality: avg(judged.map((s) => s.quality)),
        avgFaithfulness: avg(judged.map((s) => s.faithfulness)),
        belowThreshold: judged.filter((s) => s.quality < threshold || s.faithfulness < threshold).length,
      };
    })
    .sort((a, b) => a.subjectId.localeCompare(b.subjectId));
}

// ─── thin persistence (I/O) ───────────────────────────────────────────────────────────────────────

let ensurePromise: Promise<void> | null = null;
export async function ensureOnlineScoresSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS online_scores (
        run_id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        subject_id text NOT NULL DEFAULT 'unknown',
        quality real NOT NULL DEFAULT 0,
        faithfulness real NOT NULL DEFAULT 0,
        judged boolean NOT NULL DEFAULT false,
        reasoning text,
        ts timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

/** Retain one verdict. NEVER throws — a scoring side-effect must not fail the run it scored. */
export async function retainOnlineScore(score: OnlineScore): Promise<boolean> {
  try {
    await ensureOnlineScoresSchema();
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      INSERT INTO online_scores (run_id, org_id, subject_id, quality, faithfulness, judged, reasoning, ts)
      VALUES (${score.runId}, ${score.orgId}, ${score.subjectId}, ${score.quality},
              ${score.faithfulness}, ${score.judged}, ${score.reasoning}, ${score.ts})
      ON CONFLICT (run_id) DO UPDATE SET
        quality = EXCLUDED.quality, faithfulness = EXCLUDED.faithfulness,
        judged = EXCLUDED.judged, reasoning = EXCLUDED.reasoning, ts = EXCLUDED.ts;
    `);
    return true;
  } catch {
    return false;
  }
}

/** Read retained verdicts for an org, newest first. Never throws — an empty list on failure. */
export async function listOnlineScores(orgId = 'default', limit = 200): Promise<OnlineScore[]> {
  try {
    await ensureOnlineScoresSchema();
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT run_id, org_id, subject_id, quality, faithfulness, judged, reasoning, ts
      FROM online_scores WHERE org_id = ${orgId} ORDER BY ts DESC LIMIT ${Math.min(1000, Math.max(1, limit))};
    `);
    return (res.rows as unknown as Record<string, unknown>[]).map((r) => ({
      runId: String(r.run_id),
      orgId: String(r.org_id),
      subjectId: String(r.subject_id),
      quality: Number(r.quality ?? 0),
      faithfulness: Number(r.faithfulness ?? 0),
      judged: r.judged === true,
      reasoning: r.reasoning == null ? '' : String(r.reasoning),
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    }));
  } catch {
    return [];
  }
}

/**
 * Retained verdicts for ONE app, newest first.
 *
 * The judge tags every app verdict `app:<appId>` (see app-run-score), so an app's own quality on real
 * work is directly readable — it was simply never read anywhere. Org-scoped as well as subject-scoped so
 * one tenant can never see another's verdicts through a guessed app id.
 */
export async function listOnlineScoresForApp(
  appId: string,
  orgId = 'default',
  limit = 200,
): Promise<OnlineScore[]> {
  try {
    await ensureOnlineScoresSchema();
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT run_id, org_id, subject_id, quality, faithfulness, judged, reasoning, ts
      FROM online_scores
      WHERE org_id = ${orgId} AND subject_id = ${`app:${appId}`}
      ORDER BY ts DESC LIMIT ${Math.min(1000, Math.max(1, limit))};
    `);
    return (res.rows as unknown as Record<string, unknown>[]).map((r) => ({
      runId: String(r.run_id),
      orgId: String(r.org_id),
      subjectId: String(r.subject_id),
      quality: Number(r.quality ?? 0),
      faithfulness: Number(r.faithfulness ?? 0),
      judged: r.judged === true,
      reasoning: r.reasoning == null ? '' : String(r.reasoning),
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    }));
  } catch {
    // Never throws: an unreadable verdict store must degrade to "not scored", which the pure rule
    // reports honestly, rather than breaking the app's Quality tab.
    return [];
  }
}
