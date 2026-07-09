// ─── App SHARING STORE + enforcement seam — thin I/O over the grant + hierarchy layer ────────────────
//
// The impure adapter behind the PURE app-sharing-policy.ts. It:
//   • persists a consumer's explicit per-user GRANTS as a `grants` jsonb column ADDED idempotently to
//     the existing `app_access_policies` row (no schema.ts edit — deploy is rsync-only, so the column
//     is self-migrated on first use, mirroring app-access.ts's ensureAppAccessSchema);
//   • reads the org's team memberships (teams.ts) so the pure resolver can climb the upward-management
//     chain from the live org-chart;
//   • exposes enforceAppAccessWithSharing — the SINGLE seam entry points call: it runs the RBAC/ABAC
//     decision (evaluateAppAccess) and UNIONS it with the share decision (grants ∪ hierarchy), so a
//     caller is admitted if EITHER path allows. This composes WITH — does not replace — app-access.ts.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { ensureAppAccessSchema, resolveAppAccessPolicy } from '@/lib/app-access';
import {
  type AppAccessCaller,
  type AppAction,
  type AccessDecision,
  evaluateAppAccess,
} from '@/lib/app-access-policy';
import {
  type AppGrant,
  type AppShareRole,
  type OrgChartMembership,
  evaluateShareAccess,
  sanitizeGrants,
  upsertGrant,
  removeGrant,
} from '@/lib/app-sharing-policy';
import { listAllMemberships } from '@/lib/teams';

// ─── self-migrate: the additive `grants` column on app_access_policies ──────────────────────────────
// The table itself is owned by app-access.ts (ensureAppAccessSchema). We ADD our column idempotently
// after ensuring the base table exists, so a fresh deploy converges without a migration step.
let ensurePromise: Promise<void> | null = null;
export async function ensureAppSharingSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await ensureAppAccessSchema();
    await db.execute(
      sql`ALTER TABLE app_access_policies ADD COLUMN IF NOT EXISTS grants jsonb NOT NULL DEFAULT '[]'::jsonb;`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface GrantsRow {
  grants: unknown;
}

// Read a consumer's explicit grants (empty when none / no row bound yet).
export async function listAppGrants(
  appId: string,
  orgId: string = DEFAULT_ORG,
): Promise<AppGrant[]> {
  await ensureAppSharingSchema();
  const res = await db.execute(sql`
    SELECT grants FROM app_access_policies WHERE app_id = ${appId} AND org_id = ${orgId} LIMIT 1;
  `);
  const row = (res.rows as unknown as GrantsRow[])[0];
  return row ? sanitizeGrants(row.grants) : [];
}

// Overwrite a consumer's grants. Upserts the policy row (grants can exist before any RBAC/ABAC policy
// is bound). `ownerId` keeps the row's owner authoritative from the live app. Returns the saved grants.
export async function setAppGrants(
  appId: string,
  orgId: string,
  ownerId: string,
  grants: readonly AppGrant[],
): Promise<AppGrant[]> {
  await ensureAppSharingSchema();
  const clean = sanitizeGrants(grants);
  const json = JSON.stringify(clean);
  await db.execute(sql`
    INSERT INTO app_access_policies (app_id, org_id, owner_id, grants)
    VALUES (${appId}, ${orgId}, ${ownerId}, ${json}::jsonb)
    ON CONFLICT (app_id, org_id) DO UPDATE
      SET grants = EXCLUDED.grants,
          owner_id = EXCLUDED.owner_id,
          updated_at = now();
  `);
  return clean;
}

// Add or change ONE user's grant (Google-Doc-style "share with"). Idempotent by user.
export async function grantAppAccess(
  appId: string,
  orgId: string,
  ownerId: string,
  userId: string,
  role: AppShareRole,
): Promise<AppGrant[]> {
  const current = await listAppGrants(appId, orgId);
  return setAppGrants(appId, orgId, ownerId, upsertGrant(current, userId, role));
}

// Revoke ONE user's grant. Returns the remaining grants.
export async function revokeAppAccess(
  appId: string,
  orgId: string,
  ownerId: string,
  userId: string,
): Promise<AppGrant[]> {
  const current = await listAppGrants(appId, orgId);
  return setAppGrants(appId, orgId, ownerId, removeGrant(current, userId));
}

// The org membership list mapped into the pure OrgChartMembership shape for the hierarchy resolver.
async function orgChartMemberships(orgId: string): Promise<OrgChartMembership[]> {
  const rows = await listAllMemberships(orgId);
  return rows.map((r) => ({ teamId: r.teamId, userId: r.userId, role: r.role }));
}

// ─── the enforcement seam entry points call ──────────────────────────────────────────────────────────
// enforceAppAccessWithSharing loads the effective RBAC/ABAC policy + the explicit grants + the org
// chart, runs the PURE RBAC/ABAC decision, and UNIONS it with the PURE share decision. A caller is
// admitted if EITHER allows. This is the ONE call the run/trigger/approve/view routes make; it
// supersedes a bare enforceAppAccess by additionally honoring grants + the creator's upward chain.
export async function enforceAppAccessWithSharing(args: {
  appId: string;
  orgId: string;
  ownerId: string;
  caller: AppAccessCaller;
  action: AppAction;
  requestAttrs?: Record<string, unknown>;
}): Promise<AccessDecision> {
  const [policy, grants, memberships] = await Promise.all([
    resolveAppAccessPolicy(args.appId, args.orgId, args.ownerId),
    listAppGrants(args.appId, args.orgId),
    orgChartMemberships(args.orgId),
  ]);

  // 1. RBAC/ABAC (owner/admin/role/dept/attributes + approval authority) — the existing decision.
  const rbac = evaluateAppAccess(policy, args.caller, args.action, args.requestAttrs ?? {});
  if (rbac.allow) return rbac;

  // 2. Cross-org callers are already denied by evaluateAppAccess; never widen across the org boundary.
  if (args.caller.orgId !== args.orgId) return rbac;

  // 3. Share layer (explicit grants ∪ upward management chain) — additive.
  const share = evaluateShareAccess({
    callerId: args.caller.userId,
    creatorId: policy.ownerId,
    action: args.action,
    grants,
    memberships,
  });
  if (share.allow) return { allow: true, reason: `${args.action} permitted (${share.via}: ${share.reason})` };

  // Neither path admits — return the RBAC reason (the primary gate) so the message stays meaningful.
  return rbac;
}
