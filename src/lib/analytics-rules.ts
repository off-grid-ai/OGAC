import { desc, eq, sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { computeAnalytics } from '@/lib/analytics';
import {
  type Metric,
  type RuleInput,
  type ViewInput,
  evaluateRule,
  metricValue,
} from '@/lib/analytics-rules-policy';

// ANALYTICS MANAGEMENT LAYER — the DB/OpenSearch ADAPTER over the pure policy in
// analytics-rules-policy.ts. Owns two console-owned entities layered on top of the read-only
// OpenSearch charts: ALERT RULES (metric + comparator + threshold + window, with an enabled toggle)
// and SAVED VIEWS (named filter / time-range presets). Both tables are created idempotently on first
// use (same memoized ensure pattern as token-budgets.ts / chat.ts) so the module deploys over SSH
// with no migration step — schema.ts is intentionally NOT touched.

// Re-export the pure policy surface so callers (routes, tests) have one import site.
export {
  COMPARATORS,
  METRICS,
  compare,
  evaluateRule,
  metricValue,
  validateRule,
  validateView,
} from '@/lib/analytics-rules-policy';
export type {
  Comparator,
  Metric,
  RuleInput,
  RuleValidation,
  ViewInput,
} from '@/lib/analytics-rules-policy';

// ─── Tables (self-created idempotently) ───────────────────────────────────────────────────────────

export const alertRules = pgTable('analytics_alert_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  metric: text('metric').notNull(),
  comparator: text('comparator').notNull(),
  threshold: integer('threshold').notNull().default(0),
  windowMinutes: integer('window_minutes').notNull().default(15),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type AlertRule = typeof alertRules.$inferSelect;

export const savedViews = pgTable('analytics_saved_views', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  range: text('range').notNull().default('7d'),
  model: text('model').notNull().default(''), // model filter; '' = all
  outcome: text('outcome').notNull().default(''), // outcome filter; '' = all
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type SavedView = typeof savedViews.$inferSelect;

let ensurePromise: Promise<void> | null = null;
export async function ensureAnalyticsRulesSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS analytics_alert_rules (
        id text PRIMARY KEY, name text NOT NULL, metric text NOT NULL,
        comparator text NOT NULL, threshold integer NOT NULL DEFAULT 0,
        window_minutes integer NOT NULL DEFAULT 15, enabled boolean NOT NULL DEFAULT true,
        created_by text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS analytics_saved_views (
        id text PRIMARY KEY, name text NOT NULL, range text NOT NULL DEFAULT '7d',
        model text NOT NULL DEFAULT '', outcome text NOT NULL DEFAULT '',
        created_by text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

const rid = () => crypto.randomUUID();

// ─── Alert rule CRUD ──────────────────────────────────────────────────────────────────────────────
export async function listRules(): Promise<AlertRule[]> {
  await ensureAnalyticsRulesSchema();
  return db.select().from(alertRules).orderBy(desc(alertRules.createdAt));
}

export async function createRule(input: RuleInput, createdBy: string): Promise<AlertRule> {
  await ensureAnalyticsRulesSchema();
  const row = {
    id: rid(),
    name: input.name,
    metric: input.metric,
    comparator: input.comparator,
    threshold: Math.floor(input.threshold),
    windowMinutes: input.windowMinutes,
    enabled: input.enabled,
    createdBy,
  };
  await db.insert(alertRules).values(row);
  const [created] = await db.select().from(alertRules).where(eq(alertRules.id, row.id));
  return created;
}

export async function updateRule(id: string, input: RuleInput): Promise<AlertRule | null> {
  await ensureAnalyticsRulesSchema();
  await db
    .update(alertRules)
    .set({
      name: input.name,
      metric: input.metric,
      comparator: input.comparator,
      threshold: Math.floor(input.threshold),
      windowMinutes: input.windowMinutes,
      enabled: input.enabled,
    })
    .where(eq(alertRules.id, id));
  const [updated] = await db.select().from(alertRules).where(eq(alertRules.id, id));
  return updated ?? null;
}

export async function deleteRule(id: string): Promise<void> {
  await ensureAnalyticsRulesSchema();
  await db.delete(alertRules).where(eq(alertRules.id, id));
}

// ─── Saved view CRUD ──────────────────────────────────────────────────────────────────────────────
export async function listViews(): Promise<SavedView[]> {
  await ensureAnalyticsRulesSchema();
  return db.select().from(savedViews).orderBy(desc(savedViews.createdAt));
}

export async function createView(input: ViewInput, createdBy: string): Promise<SavedView> {
  await ensureAnalyticsRulesSchema();
  const row = { id: rid(), ...input, createdBy };
  await db.insert(savedViews).values(row);
  const [created] = await db.select().from(savedViews).where(eq(savedViews.id, row.id));
  return created;
}

export async function updateView(id: string, input: ViewInput): Promise<SavedView | null> {
  await ensureAnalyticsRulesSchema();
  await db
    .update(savedViews)
    .set({ ...input })
    .where(eq(savedViews.id, id));
  const [updated] = await db.select().from(savedViews).where(eq(savedViews.id, id));
  return updated ?? null;
}

export async function deleteView(id: string): Promise<void> {
  await ensureAnalyticsRulesSchema();
  await db.delete(savedViews).where(eq(savedViews.id, id));
}

// ─── "Evaluate now" action ──────────────────────────────────────────────────────────────────────
export interface RuleEvaluation {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
  value: number; // current metric value
  firing: boolean;
}

// Check every rule against the CURRENT analytics snapshot and report firing/ok. Uses the existing
// computeAnalytics() OpenSearch queries (unchanged) for the live values, then the PURE evaluateRule /
// metricValue functions for the decision — so the decision logic itself is unit-tested without I/O.
export async function evaluateRules(): Promise<RuleEvaluation[]> {
  const [rules, a] = await Promise.all([listRules(), computeAnalytics()]);
  return rules.map((r) => {
    const value = metricValue(a, r.metric as Metric);
    return {
      id: r.id,
      name: r.name,
      metric: r.metric,
      comparator: r.comparator,
      threshold: r.threshold,
      windowMinutes: r.windowMinutes,
      enabled: r.enabled,
      value,
      firing: evaluateRule(r, value),
    };
  });
}
