import { costOf, type TrafficRecord } from '@offgrid/finops';
import { desc, eq, sql } from 'drizzle-orm';
import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { db } from '@/db';

// FinOps TOKEN BUDGETS — issue + monitor per-user / per-org token allocations, metered against the
// gateway's durable call history in OpenSearch. A budget is keyed by `subject`: either a user id
// (their email, matching the `x-offgrid-user` → gateway `caller` attribution) or `org:<name>` for a
// whole-org cap. Usage is summed live from OpenSearch; cost via @offgrid/finops. The table is
// created idempotently on first use (same memoized ensure pattern as chat.ts) so the module deploys
// over SSH with no migration step. `allocated_tokens` is a bigint stored/read as a JS number
// (mode: 'number') — token counts stay well within Number.MAX_SAFE_INTEGER.

const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

export const tokenBudgets = pgTable('token_budgets', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull(),
  period: text('period').notNull().default('monthly'),
  allocatedTokens: bigint('allocated_tokens', { mode: 'number' }).notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TokenBudget = typeof tokenBudgets.$inferSelect;

let ensurePromise: Promise<void> | null = null;
export async function ensureTokenBudgetSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS token_budgets (
        id text PRIMARY KEY, subject text NOT NULL, period text NOT NULL DEFAULT 'monthly',
        allocated_tokens bigint NOT NULL DEFAULT 0,
        window_start timestamptz NOT NULL DEFAULT now(),
        created_by text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS token_budgets_subject_idx ON token_budgets (subject);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

const rid = () => crypto.randomUUID();

// ─── CRUD ─────────────────────────────────────────────────────────────────────
export async function listBudgets(): Promise<TokenBudget[]> {
  await ensureTokenBudgetSchema();
  return db.select().from(tokenBudgets).orderBy(desc(tokenBudgets.createdAt));
}

export async function getBudget(subject: string): Promise<TokenBudget | null> {
  await ensureTokenBudgetSchema();
  const [b] = await db.select().from(tokenBudgets).where(eq(tokenBudgets.subject, subject));
  return b ?? null;
}

// Upsert a budget for a subject (one budget per subject). Resets window_start to now on set.
export async function setBudget(
  subject: string,
  allocatedTokens: number,
  period: string,
  createdBy: string,
): Promise<void> {
  await ensureTokenBudgetSchema();
  const s = subject.trim();
  if (!s) return;
  const p = period === 'weekly' || period === 'daily' ? period : 'monthly';
  await db
    .insert(tokenBudgets)
    .values({ id: rid(), subject: s, period: p, allocatedTokens, createdBy })
    .onConflictDoUpdate({
      target: tokenBudgets.subject,
      set: { allocatedTokens, period: p, windowStart: new Date(), createdBy },
    });
}

export async function deleteBudget(id: string): Promise<void> {
  await ensureTokenBudgetSchema();
  await db.delete(tokenBudgets).where(eq(tokenBudgets.id, id));
}

// ─── Usage (live from the gateway's OpenSearch call history) ──────────────────
export interface SubjectUsage {
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  usd: number;
  requests: number;
}

const ZERO_USAGE: SubjectUsage = {
  tokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  usd: 0,
  requests: 0,
};

// Sum tokens + cost for every gateway call attributed to `subject` (caller) since `sinceMs` ms ago.
// Degrades to zero usage when OpenSearch is unreachable (mirrors the finops/logs routes).
// eslint-disable-next-line complexity
export async function usageFor(subject: string, sinceMs: number): Promise<SubjectUsage> {
  const since = Math.max(1000, Math.round(sinceMs / 1000));
  const body = {
    size: 5000,
    query: {
      bool: {
        filter: [
          { term: { 'caller.keyword': subject } },
          { range: { '@timestamp': { gte: `now-${since}s` } } },
        ],
      },
    },
  };
  try {
    const r = await fetch(`${OS_URL}/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return { ...ZERO_USAGE };
    const data = await r.json();
    const hits = (data?.hits?.hits ?? []).map(
      (h: { _source: Record<string, unknown> }) => h._source as unknown as TrafficRecord,
    );
    const out: SubjectUsage = { ...ZERO_USAGE };
    for (const rec of hits) {
      const total = Number(rec.tokens ?? 0);
      const prompt = Number(rec.promptTokens ?? total / 2);
      const completion = Number(rec.completionTokens ?? total / 2);
      out.tokens += total;
      out.promptTokens += prompt;
      out.completionTokens += completion;
      out.usd += costOf(rec).total;
      out.requests += 1;
    }
    return out;
  } catch {
    return { ...ZERO_USAGE };
  }
}

// ─── Budgets joined with live usage ───────────────────────────────────────────
export interface BudgetWithUsage extends SubjectUsage {
  id: string;
  subject: string;
  period: string;
  allocatedTokens: number;
  windowStart: string;
  remaining: number;
  pctUsed: number;
  projectedMonthly: number;
}

const PERIOD_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

// Each budget joined with its usage since the current window opened, plus remaining tokens,
// percent used, and a projected monthly USD spend extrapolated from the elapsed window.
export async function budgetsWithUsage(): Promise<BudgetWithUsage[]> {
  const budgets = await listBudgets();
  const now = Date.now();
  return Promise.all(
    budgets.map(async (b) => {
      const windowMs = PERIOD_MS[b.period] ?? PERIOD_MS.monthly;
      const started = new Date(b.windowStart).getTime();
      const elapsed = Math.max(1, now - started);
      const lookback = Math.min(windowMs, elapsed);
      const u = await usageFor(b.subject, lookback);
      const allocated = b.allocatedTokens || 0;
      const remaining = allocated ? allocated - u.tokens : 0;
      const pctUsed = allocated ? Math.round((u.tokens / allocated) * 1000) / 10 : 0;
      const perMs = u.usd / lookback;
      const projectedMonthly = Math.round(perMs * PERIOD_MS.monthly * 100) / 100;
      return {
        id: b.id,
        subject: b.subject,
        period: b.period,
        allocatedTokens: allocated,
        windowStart: new Date(b.windowStart).toISOString(),
        remaining,
        pctUsed,
        projectedMonthly,
        ...u,
      };
    }),
  );
}
