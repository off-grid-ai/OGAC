import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPA_BASE, SKIP_MESSAGE, opaReachable } from './support/opa-available.mjs';

// INTEGRATION test proving the org-carrying fix (console/docs G-213: the decision-log ledger never
// received a real per-tenant decision) does NOT change what the REAL deployed Rego decides. Adding
// `org` to PolicyInput (src/lib/adapters/types.ts) only widens the JSON body sent to
// `POST /v1/data/offgrid/authz`; the on-prem `offgrid.authz` module reads ONLY `input.role` and
// `input.attributes.clearance` (verified live against the deployed module — see
// docs/GAPS_BACKLOG.md G-213 / the SERVER_STATE note this change adds) — an extra field it never
// reads must be a no-op for every allow/deny outcome.
//
// Runs against a REAL OPA over OFFGRID_OPA_URL; skips (green) when unreachable so `npm test` stays
// green without one — same pattern as opa-policy.integration.test.ts.

const up = await opaReachable();

test('opaPolicy.evaluate: adding `org` never changes the real Rego outcome', {
  skip: up ? false : SKIP_MESSAGE,
}, async () => {
  process.env.OFFGRID_OPA_URL = OPA_BASE;
  const { opaPolicy } = await import('@/lib/adapters/policy');

  // Three representative inputs against the deployed offgrid.authz module:
  //   - role=admin           → allow (role rule)
  //   - role=viewer, no attrs → deny (no rule matches, default false)
  //   - role=viewer, clearance=high → allow (attribute rule, role irrelevant)
  const cases: { role: string; attributes: Record<string, string> }[] = [
    { role: 'admin', attributes: {} },
    { role: 'viewer', attributes: {} },
    { role: 'viewer', attributes: { clearance: 'high' } },
  ];

  for (const c of cases) {
    const resource = `test-org-attribution:${c.role}:${Object.keys(c.attributes).length}`;
    const without = await opaPolicy.evaluate({ role: c.role, resource, attributes: c.attributes });
    const withOrgA = await opaPolicy.evaluate({
      role: c.role,
      resource,
      attributes: c.attributes,
      org: 'org_suraksha',
    });
    const withOrgB = await opaPolicy.evaluate({
      role: c.role,
      resource,
      attributes: c.attributes,
      org: 'org_bharat',
    });
    assert.equal(without.engine, 'opa', 'OPA actually answered (not the abac fallback)');
    assert.equal(
      withOrgA.allow,
      without.allow,
      `org field must not change the decision for role=${c.role}`,
    );
    assert.equal(
      withOrgB.allow,
      without.allow,
      `a DIFFERENT org must not change the decision for role=${c.role} either`,
    );
  }
});
