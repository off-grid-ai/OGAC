import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  type OpaPolicyDocument,
  type PolicyRule,
  type PolicyRuleInput,
  toOpaDocument,
} from '@/lib/policy-rules-policy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Console-owned policy-rule store (I/O adapter). The pure rules live in policy-rules-policy.ts; this
// file is the thin DB/network seam. The `policy_rules` table is created idempotently on first use
// (files.ts / chat.ts pattern) so the module deploys over SSH with no migration step and WITHOUT
// touching src/db/schema.ts.

let ensurePromise: Promise<void> | null = null;
export async function ensurePolicyRulesSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS policy_rules (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        attribute text NOT NULL,
        operator text NOT NULL DEFAULT 'eq',
        value text NOT NULL,
        effect text NOT NULL DEFAULT 'deny',
        priority integer NOT NULL DEFAULT 100,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS policy_rules_org_idx ON policy_rules (org_id, priority);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  id: string;
  name: string;
  description: string;
  attribute: string;
  operator: string;
  value: string;
  effect: string;
  priority: number;
  enabled: boolean;
}

function toRule(r: Row): PolicyRule {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    attribute: r.attribute,
    operator: r.operator as PolicyRule['operator'],
    value: r.value,
    effect: r.effect as PolicyRule['effect'],
    priority: r.priority,
    enabled: r.enabled,
  };
}

export async function listPolicyRules(orgId: string = DEFAULT_ORG): Promise<PolicyRule[]> {
  await ensurePolicyRulesSchema();
  const res = await db.execute(sql`
    SELECT id, name, description, attribute, operator, value, effect, priority, enabled
    FROM policy_rules WHERE org_id = ${orgId} ORDER BY priority ASC, name ASC;
  `);
  return (res.rows as unknown as Row[]).map(toRule);
}

export async function getPolicyRule(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<PolicyRule | null> {
  await ensurePolicyRulesSchema();
  const res = await db.execute(sql`
    SELECT id, name, description, attribute, operator, value, effect, priority, enabled
    FROM policy_rules WHERE id = ${id} AND org_id = ${orgId} LIMIT 1;
  `);
  const row = (res.rows as unknown as Row[])[0];
  return row ? toRule(row) : null;
}

export async function createPolicyRule(
  input: PolicyRuleInput,
  orgId: string = DEFAULT_ORG,
): Promise<PolicyRule> {
  await ensurePolicyRulesSchema();
  const id = `pol_${randomUUID().slice(0, 8)}`;
  await db.execute(sql`
    INSERT INTO policy_rules (id, org_id, name, description, attribute, operator, value, effect, priority)
    VALUES (${id}, ${orgId}, ${input.name}, ${input.description}, ${input.attribute},
            ${input.operator}, ${input.value}, ${input.effect}, ${input.priority});
  `);
  const created = await getPolicyRule(id, orgId);
  if (!created) throw new Error('policy rule vanished after insert');
  return created;
}

// Apply a validated partial. Only sanitized keys reach the SQL SET clause (via drizzle's
// parameterized fragments), so a caller can never inject a column. Returns the updated row or null
// when the id is unknown for this org.
export async function updatePolicyRule(
  id: string,
  patch: Partial<PolicyRuleInput> & { enabled?: boolean },
  orgId: string = DEFAULT_ORG,
): Promise<PolicyRule | null> {
  await ensurePolicyRulesSchema();
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
  if (patch.attribute !== undefined) sets.push(sql`attribute = ${patch.attribute}`);
  if (patch.operator !== undefined) sets.push(sql`operator = ${patch.operator}`);
  if (patch.value !== undefined) sets.push(sql`value = ${patch.value}`);
  if (patch.effect !== undefined) sets.push(sql`effect = ${patch.effect}`);
  if (patch.priority !== undefined) sets.push(sql`priority = ${patch.priority}`);
  if (patch.enabled !== undefined) sets.push(sql`enabled = ${patch.enabled}`);
  if (sets.length === 0) return getPolicyRule(id, orgId);
  sets.push(sql`updated_at = now()`);
  await db.execute(sql`
    UPDATE policy_rules SET ${sql.join(sets, sql`, `)} WHERE id = ${id} AND org_id = ${orgId};
  `);
  return getPolicyRule(id, orgId);
}

export async function deletePolicyRule(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensurePolicyRulesSchema();
  const res = await db.execute(sql`
    DELETE FROM policy_rules WHERE id = ${id} AND org_id = ${orgId} RETURNING id;
  `);
  return (res.rows as unknown[]).length > 0;
}

export interface PushResult {
  pushed: boolean; // true = OPA accepted; false = OPA not configured (dry compile only)
  target: string | null; // the OPA data path we pushed to (or would push to)
  document: OpaPolicyDocument; // the compiled document
  reason: string;
}

// Compile the org's enabled policy rules into an OPA data document and push it to OPA, then trigger
// a reload/reevaluate by re-reading the active policy status (which health-probes the engine). When
// OFFGRID_OPA_URL is unset the document is still compiled and returned (dry run) so operators can
// preview the bundle. This is the "Push / Reload to OPA" action surfaced as a button.
export async function pushRulesToOpa(orgId: string = DEFAULT_ORG): Promise<PushResult> {
  const rules = await listPolicyRules(orgId);
  const version = Math.floor(Date.now() / 1000);
  const document = toOpaDocument(rules, version);
  const base = process.env.OFFGRID_OPA_URL;
  const path = 'offgrid/console_policy';
  if (!base) {
    return {
      pushed: false,
      target: null,
      document,
      reason: 'OFFGRID_OPA_URL not set — compiled bundle only (dry run)',
    };
  }
  const target = `${base.replace(/\/$/, '')}/v1/data/${path}`;
  try {
    const res = await fetch(target, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`opa ${res.status}`);
    // Reload/reevaluate: re-probe engine health so the console reflects the freshly-pushed set.
    const { readPolicyStatus } = await import('@/lib/policy-view');
    const status = await readPolicyStatus();
    return {
      pushed: true,
      target,
      document,
      reason: `Pushed ${document.entries.length} entr${
        document.entries.length === 1 ? 'y' : 'ies'
      } to ${path}; engine ${status.engine} ${status.reachable ? 'reachable' : 'unreachable'}`,
    };
  } catch (e) {
    return {
      pushed: false,
      target,
      document,
      reason: `OPA push failed: ${(e as Error).message}`,
    };
  }
}
