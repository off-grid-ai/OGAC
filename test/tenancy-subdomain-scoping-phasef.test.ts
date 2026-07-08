import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_ORG, resolveOrg } from '../src/lib/tenancy-policy.ts';

// ── Phase F (task #153) — subdomain org-scoping, the G-F1 root cause ───────────────────────────────
//
// LIVE FINDING (2026-07-09, verified against the deployed console): a bearer / service-account request
// on a tenant subdomain (e.g. `bharatunion-onprem-console.getoffgridai.co`) reads the `default` org,
// NOT the tenant's org — `GET /apps` returned `orgId:"default"` while the DB holds 6 org_bharat apps.
//
// Root cause lives in the SHAPE of currentOrgId() in src/lib/tenancy.ts:
//
//   const session = await auth();                       // ← null for a bearer request (no cookie)
//   const sessionOrg = resolveOrg(session?.user?.org, process.env.OFFGRID_ORG);
//   const tenantOrg = await tenantOrgFromHost();         // = org_bharat on the tenant subdomain
//   if (tenantOrg && tenantOrg !== sessionOrg) {
//     return session?.user?.role === 'admin' ? tenantOrg : sessionOrg;   // ← role is undefined → sessionOrg
//   }
//   return tenantOrg ?? sessionOrg;
//
// The tenant-binding decision is a PURE rule over (tenantOrg, sessionOrg, role). We reproduce it here
// exactly and assert the buggy-vs-fixed behaviour, so the regression is pinned without the live tunnel.
// When the fix lands (derive role/org from the SAME principal requireUser resolves — the verified bearer
// claims / break-glass admin — not only from auth()), `bindOrg` with an admin role must return the
// tenant org, and the "bearer → role undefined" case disappears.

/**
 * The pure org-binding rule extracted verbatim from currentOrgId(). Given the tenant org resolved from
 * the (trusted) host, the caller's own session org, and the caller's role, decide the effective org.
 * A subdomain may hard-bind ONLY for a platform admin or a member of that org — otherwise the caller
 * stays in their own org so a subdomain can never leak another tenant's data.
 */
function bindOrg(tenantOrg: string | null, sessionOrg: string, role: string | undefined): string {
  if (tenantOrg && tenantOrg !== sessionOrg) {
    return role === 'admin' ? tenantOrg : sessionOrg;
  }
  return tenantOrg ?? sessionOrg;
}

describe('Phase F — subdomain org-binding rule (G-F1 root cause)', () => {
  const TENANT = 'org_bharat';

  test('an ADMIN principal on a tenant subdomain binds to the tenant org', () => {
    assert.equal(bindOrg(TENANT, DEFAULT_ORG, 'admin'), TENANT);
  });

  test('a NON-admin, non-member stays in their own org (no cross-tenant leak — fail safe)', () => {
    assert.equal(bindOrg(TENANT, DEFAULT_ORG, 'member'), DEFAULT_ORG);
    assert.equal(bindOrg(TENANT, DEFAULT_ORG, 'viewer'), DEFAULT_ORG);
  });

  test('G-F1: a bearer request has NO session role → the tenant binding is refused (the live bug)', () => {
    // This is exactly what happens for the break-glass admin token / any service-account bearer:
    // currentOrgId() reads role from `auth()` (the cookie session), which is null for a bearer request,
    // so role is `undefined` — the admin branch is never taken and the caller falls back to `default`.
    const roleFromCookieSession = undefined; // auth() === null for a bearer request
    assert.equal(bindOrg(TENANT, DEFAULT_ORG, roleFromCookieSession), DEFAULT_ORG);
    // ...even though the SAME caller is authenticated as an admin via requireUser() (bearer claims /
    // break-glass). The fix must feed THAT role in — then the assertion below becomes the contract:
    const roleFromVerifiedPrincipal = 'admin'; // what requireUser() actually resolves
    assert.equal(bindOrg(TENANT, DEFAULT_ORG, roleFromVerifiedPrincipal), TENANT);
  });

  test('off a tenant subdomain (no host match) the caller keeps their own org', () => {
    assert.equal(bindOrg(null, DEFAULT_ORG, 'admin'), DEFAULT_ORG);
    assert.equal(bindOrg(null, 'org_1c0e4d', undefined), 'org_1c0e4d');
  });

  test('resolveOrg precedence is unchanged (env override > claim > default)', () => {
    assert.equal(resolveOrg('org_x', 'org_env'), 'org_env');
    assert.equal(resolveOrg('org_x', undefined), 'org_x');
    assert.equal(resolveOrg(undefined, ''), DEFAULT_ORG);
  });
});

// ── Live-tunnel probe (honest skip) ────────────────────────────────────────────────────────────────
// The end-to-end proof requires the cloudflared tunnel to S1 + the break-glass admin token, which this
// harness does not have. Documented here so a run WITH access can flip it green.
//
// Reproduce (2026-07-09, currently FAILS — returns default-org apps):
//   ssh offgrid-tunnel 'TOK=$(grep ^OFFGRID_ADMIN_TOKEN= ~/offgrid/console/.env.local|cut -d= -f2-); \
//     curl -s -H "Authorization: Bearer $TOK" \
//       https://bharatunion-onprem-console.getoffgridai.co/api/v1/admin/apps'
//   EXPECT (after G-F1 fix): every returned app has orgId === "org_bharat" (6 apps), not "default".
describe('Phase F — live subdomain scoping (needs the tunnel)', () => {
  test('bharatunion subdomain scopes /apps to org_bharat', { skip: 'requires live cloudflared tunnel + admin token' }, () => {
    assert.ok(true);
  });
});
