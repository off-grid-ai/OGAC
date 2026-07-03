import { desc, eq, sql } from 'drizzle-orm';
import { pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import {
  type Alert,
  type AlertEvaluationInput,
  evaluateAlerts,
  type ThresholdRule,
  type ThresholdRuleInput,
  validateThresholdRule,
} from './observability-thresholds';

// OBSERVABILITY SETTINGS — console-owned alert threshold rules + the drift baseline reset marker.
// The tables are created idempotently on first use (same memoized-ensure pattern as token-budgets.ts /
// chat.ts) so the module deploys over SSH with no migration step. Pure validation/evaluation lives in
// observability-thresholds.ts; this file is the DB adapter.

export const observabilityThresholds = pgTable('observability_thresholds', {
  id: text('id').primaryKey(),
  metric: text('metric').notNull(),
  op: text('op').notNull(),
  value: real('value').notNull(),
  severity: text('severity').notNull().default('warning'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const observabilityBaseline = pgTable('observability_baseline', {
  id: text('id').primaryKey(), // singleton row 'current'
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull().defaultNow(),
  resetBy: text('reset_by').notNull().default(''),
  note: text('note').notNull().default(''),
});

export type ThresholdRow = typeof observabilityThresholds.$inferSelect;

let ensurePromise: Promise<void> | null = null;
export async function ensureObservabilitySchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS observability_thresholds (
        id text PRIMARY KEY, metric text NOT NULL, op text NOT NULL, value real NOT NULL,
        severity text NOT NULL DEFAULT 'warning', created_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS observability_baseline (
        id text PRIMARY KEY, reset_at timestamptz NOT NULL DEFAULT now(),
        reset_by text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '');
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

const rid = () => crypto.randomUUID();

function toRule(row: ThresholdRow): ThresholdRule {
  return {
    metric: row.metric as ThresholdRule['metric'],
    op: row.op as ThresholdRule['op'],
    value: row.value,
    severity: row.severity === 'critical' ? 'critical' : 'warning',
  };
}

// ─── Threshold CRUD ───────────────────────────────────────────────────────────
export async function listThresholds(): Promise<ThresholdRow[]> {
  await ensureObservabilitySchema();
  return db
    .select()
    .from(observabilityThresholds)
    .orderBy(desc(observabilityThresholds.createdAt));
}

// Create — validates via the pure layer; returns null + reason when invalid.
export async function createThreshold(
  input: ThresholdRuleInput,
  createdBy: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const v = validateThresholdRule(input);
  if (!v.ok || !v.rule) return { ok: false, error: v.error };
  await ensureObservabilitySchema();
  const id = rid();
  await db.insert(observabilityThresholds).values({ id, ...v.rule, createdBy });
  return { ok: true, id };
}

// Update an existing rule (full replacement of its fields, re-validated).
export async function updateThreshold(
  id: string,
  input: ThresholdRuleInput,
): Promise<{ ok: boolean; error?: string }> {
  const v = validateThresholdRule(input);
  if (!v.ok || !v.rule) return { ok: false, error: v.error };
  await ensureObservabilitySchema();
  await db
    .update(observabilityThresholds)
    .set({ metric: v.rule.metric, op: v.rule.op, value: v.rule.value, severity: v.rule.severity })
    .where(eq(observabilityThresholds.id, id));
  return { ok: true };
}

export async function deleteThreshold(id: string): Promise<void> {
  await ensureObservabilitySchema();
  await db.delete(observabilityThresholds).where(eq(observabilityThresholds.id, id));
}

// ─── Baseline reset ───────────────────────────────────────────────────────────
export interface BaselineMarker {
  resetAt: string;
  resetBy: string;
  note: string;
}

export async function getBaseline(): Promise<BaselineMarker | null> {
  await ensureObservabilitySchema();
  const [row] = await db
    .select()
    .from(observabilityBaseline)
    .where(eq(observabilityBaseline.id, 'current'));
  if (!row) return null;
  return { resetAt: new Date(row.resetAt).toISOString(), resetBy: row.resetBy, note: row.note };
}

// Reset (or set) the singleton baseline marker to now.
export async function resetBaseline(resetBy: string, note: string): Promise<void> {
  await ensureObservabilitySchema();
  await db
    .insert(observabilityBaseline)
    .values({ id: 'current', resetAt: new Date(), resetBy, note })
    .onConflictDoUpdate({
      target: observabilityBaseline.id,
      set: { resetAt: new Date(), resetBy, note },
    });
}

// ─── Evaluation (rules joined with live observed values) ──────────────────────
export async function evaluateThresholdAlerts(obs: AlertEvaluationInput): Promise<Alert[]> {
  const rows = await listThresholds();
  return evaluateAlerts(rows.map(toRule), obs);
}
