// PURE predicates for hiding QA/autotest artifacts from CUSTOMER-FACING demo tenants. Zero I/O.
//
// The insurer use-case autotest harness (scripts/insurer-usecase-autotest.mts) runs against the LIVE demo
// tenants: it creates apps titled `[autotest] …` owned by `autotest`, and drives runs whose actor
// is `autotest@offgrid`. Those rows are useful QA evidence but they must NOT pollute what a
// customer sees on a demo tenant (Studio grid, Reports/Review filter chips, the audit log).
//
// This module is the ONE place that decides "is this a test artifact?" and "is this a customer demo
// tenant?", so every listing surface filters the same way (DRY). Filtering is scoped to demo
// tenants only — a non-demo tenant's data is never touched (behaviour-preserving).

/** Org ids of the customer-facing demo tenants (bank + insurer). Kept in lockstep with the tour
 *  profiles — these are the only orgs where autotest artifacts are hidden. */
export const DEMO_TENANT_ORG_IDS: readonly string[] = ['org_bharat', 'org_suraksha'];

/** True iff the org is a customer-facing demo tenant (where QA artifacts must be hidden). */
export function isDemoTenantOrg(orgId: string | null | undefined): boolean {
  return orgId != null && DEMO_TENANT_ORG_IDS.includes(orgId);
}

/** The literal actor/owner id the autotest harness writes. */
export const AUTOTEST_ACTOR = 'autotest@offgrid';

/** True iff an actor/owner id is the autotest harness identity (case-insensitive; matches the bare
 *  `autotest` owner and the `autotest@offgrid` run actor). */
export function isAutotestActor(actor: string | null | undefined): boolean {
  if (!actor) return false;
  const a = actor.trim().toLowerCase();
  return a === 'autotest' || a === AUTOTEST_ACTOR;
}

/** True iff a title is an autotest-created entity (prefixed `[autotest]`, any casing/leading space). */
export function isAutotestTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /^\s*\[autotest\]/i.test(title);
}

/**
 * Should this entity be HIDDEN from a customer on the given tenant? True only when the tenant is a
 * demo tenant AND the entity is an autotest artifact (by title or actor/owner). Non-demo tenants
 * always return false — their data is shown unchanged.
 */
export function hideDemoTestArtifact(
  orgId: string | null | undefined,
  entity: { title?: string | null; actor?: string | null; ownerId?: string | null },
): boolean {
  if (!isDemoTenantOrg(orgId)) return false;
  return (
    isAutotestTitle(entity.title) ||
    isAutotestActor(entity.actor) ||
    isAutotestActor(entity.ownerId)
  );
}
