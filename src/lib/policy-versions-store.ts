import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  diffRuleSets,
  digestRules,
  summariseChanges,
  versionInForceAt,
  type RuleChange,
  type VersionedRule,
} from '@/lib/policy-version';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Immutable history of the org's policy ruleset (I/O adapter; pure rules in policy-version.ts).
// Self-migrating on first use, like the other console-owned stores, so it deploys with no migration.

export interface PolicyVersionRecord {
  version: number;
  digest: string;
  rules: VersionedRule[];
  changes: RuleChange[];
  summary: string;
  changedBy: string;
  createdAt: Date;
}

let ensurePromise: Promise<void> | null = null;
export async function ensurePolicyVersionsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS policy_versions (
        id bigserial PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        version integer NOT NULL,
        digest text NOT NULL,
        rules jsonb NOT NULL DEFAULT '[]'::jsonb,
        changes jsonb NOT NULL DEFAULT '[]'::jsonb,
        summary text NOT NULL DEFAULT '',
        changed_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (org_id, version));
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS policy_versions_org_idx ON policy_versions (org_id, version DESC);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  version: number;
  digest: string;
  rules: VersionedRule[];
  changes: RuleChange[];
  summary: string;
  changed_by: string;
  created_at: string | Date;
}

function toRecord(r: Row): PolicyVersionRecord {
  return {
    version: r.version,
    digest: r.digest,
    rules: r.rules ?? [],
    changes: r.changes ?? [],
    summary: r.summary,
    changedBy: r.changed_by,
    createdAt: new Date(r.created_at),
  };
}

export async function listPolicyVersions(
  orgId: string = DEFAULT_ORG,
  limit = 50,
): Promise<PolicyVersionRecord[]> {
  await ensurePolicyVersionsSchema();
  const res = await db.execute(sql`
    SELECT version, digest, rules, changes, summary, changed_by, created_at
    FROM policy_versions WHERE org_id = ${orgId} ORDER BY version DESC LIMIT ${limit};
  `);
  return (res.rows as unknown as Row[]).map(toRecord);
}

export async function getPolicyVersion(
  version: number,
  orgId: string = DEFAULT_ORG,
): Promise<PolicyVersionRecord | null> {
  await ensurePolicyVersionsSchema();
  const res = await db.execute(sql`
    SELECT version, digest, rules, changes, summary, changed_by, created_at
    FROM policy_versions WHERE org_id = ${orgId} AND version = ${version} LIMIT 1;
  `);
  const row = (res.rows as unknown as Row[])[0];
  return row ? toRecord(row) : null;
}

/** The version number currently in force, or 0 when the org has never recorded one. */
export async function currentPolicyVersion(orgId: string = DEFAULT_ORG): Promise<number> {
  await ensurePolicyVersionsSchema();
  const res = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0)::int AS v FROM policy_versions WHERE org_id = ${orgId};
  `);
  return (res.rows as unknown as { v: number }[])[0]?.v ?? 0;
}

/**
 * Mint a version for the ruleset AS IT NOW STANDS. Called after every create/update/delete, so the
 * history cannot be bypassed by editing through a different route.
 *
 * Returns null when the ruleset is unchanged — re-saving a rule with the same content must not mint
 * a version, or the history fills with no-ops and stops being read.
 */
export async function recordPolicyVersion(
  rules: readonly VersionedRule[],
  changedBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<PolicyVersionRecord | null> {
  await ensurePolicyVersionsSchema();
  const digest = digestRules(rules);
  const [latest] = await listPolicyVersions(orgId, 1);
  if (latest?.digest === digest) return null;

  const changes = diffRuleSets(latest?.rules ?? [], rules);
  const version = (latest?.version ?? 0) + 1;
  const res = await db.execute(sql`
    INSERT INTO policy_versions (org_id, version, digest, rules, changes, summary, changed_by)
    VALUES (${orgId}, ${version}, ${digest}, ${JSON.stringify(rules)}::jsonb,
            ${JSON.stringify(changes)}::jsonb,
            ${latest ? summariseChanges(changes) : 'First recorded version of this policy'},
            ${changedBy})
    ON CONFLICT (org_id, version) DO NOTHING
    RETURNING version, digest, rules, changes, summary, changed_by, created_at;
  `);
  const row = (res.rows as unknown as Row[])[0];
  return row ? toRecord(row) : null;
}

/**
 * What the policy said at a past instant. Returns null when the moment predates any recorded
 * version — reported as "not recorded", never silently attributed to the earliest one we happen
 * to hold.
 */
export async function policyInForceAt(
  at: Date,
  orgId: string = DEFAULT_ORG,
): Promise<PolicyVersionRecord | null> {
  return versionInForceAt(await listPolicyVersions(orgId, 500), at);
}
