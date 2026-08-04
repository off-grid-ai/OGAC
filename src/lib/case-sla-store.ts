import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { SlaRule } from '@/lib/case-sla';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Per-app decision targets (I/O adapter; pure rules in case-sla.ts). Self-migrating on first use, like
// the other console-owned stores, so it deploys with no migration step.

let ensurePromise: Promise<void> | null = null;
export async function ensureSlaSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_decision_targets (
        org_id text NOT NULL DEFAULT 'default',
        app_id text NOT NULL,
        hours integer NOT NULL DEFAULT 0,
        escalate_to text NOT NULL DEFAULT '',
        updated_by text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (org_id, app_id));
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export async function listSlaRules(orgId: string = DEFAULT_ORG): Promise<SlaRule[]> {
  await ensureSlaSchema();
  const res = await db.execute<{ app_id: string; hours: number; escalate_to: string }>(sql`
    SELECT app_id, hours, escalate_to FROM app_decision_targets WHERE org_id = ${orgId};
  `);
  return res.rows.map((r) => ({
    appId: r.app_id,
    hours: r.hours,
    escalateTo: r.escalate_to || undefined,
  }));
}

/** Keyed for the common lookup — one map, not a find() per row. */
export async function slaRuleMap(orgId: string = DEFAULT_ORG): Promise<Record<string, SlaRule>> {
  const rules = await listSlaRules(orgId);
  return Object.fromEntries(rules.map((r) => [r.appId, r]));
}

export async function setSlaRule(
  rule: SlaRule,
  updatedBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureSlaSchema();
  await db.execute(sql`
    INSERT INTO app_decision_targets (org_id, app_id, hours, escalate_to, updated_by, updated_at)
    VALUES (${orgId}, ${rule.appId}, ${Math.max(0, Math.floor(rule.hours))},
            ${rule.escalateTo ?? ''}, ${updatedBy}, now())
    ON CONFLICT (org_id, app_id) DO UPDATE SET
      hours = EXCLUDED.hours, escalate_to = EXCLUDED.escalate_to,
      updated_by = EXCLUDED.updated_by, updated_at = now();
  `);
}
