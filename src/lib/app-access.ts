// ─── Per-app access policy STORE — thin I/O over `app_access_policies` ─────────────────────────────
//
// The impure seam behind the PURE decision in app-access-policy.ts. This file only persists + reads
// a consumer's access policy and enforces it at an entry point; the rule for "may this caller act?"
// lives entirely in the pure module. Deploy is rsync-only (no migration step over SSH), so the table
// is created idempotently on first use (mirrors policy-rules.ts / apps-store.ts). Column names are
// this table's own — no schema.ts edit required.
//
// The DB import is `@/db` (the same export apps-store.ts / policy-rules.ts use) — NOT `@/db/client`.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import {
  type AppAccessCaller,
  type AppAccessPolicy,
  type AppAccessPolicyInput,
  type AppAction,
  type AccessDecision,
  defaultAppAccessPolicy,
  evaluateAppAccess,
} from '@/lib/app-access-policy';

// ─── self-migrate (memoized; mirrors ensurePolicyRulesSchema) ───────────────────────────────────────
let ensurePromise: Promise<void> | null = null;
export async function ensureAppAccessSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_access_policies (
        app_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        owner_id text NOT NULL DEFAULT '',
        actions jsonb NOT NULL DEFAULT '{}'::jsonb,
        approval jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (app_id, org_id));
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS app_access_policies_org_idx ON app_access_policies (org_id);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  app_id: string;
  org_id: string;
  owner_id: string;
  actions: unknown;
  approval: unknown;
}

function toPolicy(r: Row): AppAccessPolicy {
  return {
    appId: r.app_id,
    orgId: r.org_id,
    ownerId: r.owner_id,
    actions: (r.actions as AppAccessPolicy['actions']) ?? {},
    approval: (r.approval as AppAccessPolicy['approval']) ?? undefined,
  };
}

// Read a consumer's stored access policy, or null when none is bound.
export async function getAppAccessPolicyRow(
  appId: string,
  orgId: string = DEFAULT_ORG,
): Promise<AppAccessPolicy | null> {
  await ensureAppAccessSchema();
  const res = await db.execute(sql`
    SELECT app_id, org_id, owner_id, actions, approval
    FROM app_access_policies WHERE app_id = ${appId} AND org_id = ${orgId} LIMIT 1;
  `);
  const row = (res.rows as unknown as Row[])[0];
  return row ? toPolicy(row) : null;
}

// Resolve the EFFECTIVE policy for a consumer: the stored policy if present, else the DEFAULT
// least-privilege policy (owner + admins only). `ownerId` is supplied by the caller (loaded from the
// app/agent row) so the default is bound to the real owner.
export async function resolveAppAccessPolicy(
  appId: string,
  orgId: string,
  ownerId: string,
): Promise<AppAccessPolicy> {
  const stored = await getAppAccessPolicyRow(appId, orgId);
  if (stored) {
    // Keep the owner authoritative from the live app row (owner can't be spoofed via a stale policy).
    return { ...stored, ownerId: ownerId || stored.ownerId };
  }
  return defaultAppAccessPolicy(appId, orgId, ownerId);
}

// Upsert a consumer's access policy (create or replace). Owner is stamped from the live app row.
export async function setAppAccessPolicy(
  appId: string,
  orgId: string,
  ownerId: string,
  input: AppAccessPolicyInput,
): Promise<AppAccessPolicy> {
  await ensureAppAccessSchema();
  const actionsJson = JSON.stringify(input.actions ?? {});
  const approvalJson = input.approval ? JSON.stringify(input.approval) : null;
  await db.execute(sql`
    INSERT INTO app_access_policies (app_id, org_id, owner_id, actions, approval)
    VALUES (${appId}, ${orgId}, ${ownerId}, ${actionsJson}::jsonb, ${approvalJson}::jsonb)
    ON CONFLICT (app_id, org_id) DO UPDATE
      SET owner_id = EXCLUDED.owner_id,
          actions = EXCLUDED.actions,
          approval = EXCLUDED.approval,
          updated_at = now();
  `);
  const saved = await getAppAccessPolicyRow(appId, orgId);
  if (!saved) throw new Error('app access policy vanished after upsert');
  return saved;
}

// Delete a consumer's bound policy (reverts to least-privilege default). Returns whether one existed.
export async function deleteAppAccessPolicy(
  appId: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  await ensureAppAccessSchema();
  const res = await db.execute(sql`
    DELETE FROM app_access_policies WHERE app_id = ${appId} AND org_id = ${orgId} RETURNING app_id;
  `);
  return (res.rows as unknown[]).length > 0;
}

// ─── the enforcement seam the routes call ───────────────────────────────────────────────────────────
// enforceAppAccess loads the effective policy and runs the PURE decision. A thin, single call per
// entry point. Composes WITH (does not replace) the pipeline-contract + org-scope enforcement already
// in place — this is the WHO/UNDER-WHAT-CONDITIONS gate, layered before those.
export async function enforceAppAccess(args: {
  appId: string;
  orgId: string;
  ownerId: string;
  caller: AppAccessCaller;
  action: AppAction;
  requestAttrs?: Record<string, unknown>;
}): Promise<AccessDecision> {
  const policy = await resolveAppAccessPolicy(args.appId, args.orgId, args.ownerId);
  return evaluateAppAccess(policy, args.caller, args.action, args.requestAttrs ?? {});
}
