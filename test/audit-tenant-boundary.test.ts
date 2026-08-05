// The tenant boundary on audit search.
//
// On 2026-08-05 the audit view served every org's rows to every tenant: 1015 documents spanning four
// orgs, reachable from public demo links on a read-only account. The insurer's console and the bank's
// rendered byte-identical screens. The cause was not a wrong filter — it was NO filter: `org` was an
// optional field on AuditSearchParams and all five call sites omitted it.
//
// So these tests assert the property that was missing, at the seam that decides it. `buildQuery`
// produces the query DSL sent to the search store; whether rows leak is settled entirely by that
// object, which makes it the real artefact and not a stand-in for one. No mocks, no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQuery, type AuditSearchParams } from '@/lib/siem';

// Pull the filter clauses out of the DSL so each test reads as a claim about the query, not about
// object nesting.
function filtersOf(p: AuditSearchParams): Record<string, unknown>[] {
  const dsl = buildQuery(p) as { query?: { bool?: { filter?: Record<string, unknown>[] } } };
  return dsl.query?.bool?.filter ?? [];
}
function hasOrgTerm(p: AuditSearchParams, org: string): boolean {
  return filtersOf(p).some(
    (f) => JSON.stringify(f) === JSON.stringify({ term: { 'org.keyword': org } }),
  );
}

test('the org filter is present on the barest possible search', () => {
  // The exact call the leak was made of: no filters at all. This previously produced `match_all`.
  assert.ok(hasOrgTerm({ org: 'org_suraksha' }, 'org_suraksha'));
});

test('no query shape can drop the org filter', () => {
  // Every combination of the optional filters still carries the boundary. The point is that the org
  // term is not one branch among several — it is unconditional — so adding a filter cannot displace it.
  const shapes: AuditSearchParams[] = [
    { org: 'org_bharat' },
    { org: 'org_bharat', q: 'transfer' },
    { org: 'org_bharat', q: '   ' }, // whitespace-only q: the multi_match is skipped, the org isn't
    { org: 'org_bharat', outcome: 'blocked' },
    { org: 'org_bharat', actor: 'someone@example.test' },
    { org: 'org_bharat', action: 'policy.change' },
    { org: 'org_bharat', project: 'claims' },
    { org: 'org_bharat', deviceId: 'agent:underwriter' },
    { org: 'org_bharat', from: '2026-01-01T00:00:00Z' },
    { org: 'org_bharat', to: '2026-12-31T00:00:00Z' },
    { org: 'org_bharat', from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' },
    { org: 'org_bharat', size: 200, offset: 400 },
    {
      org: 'org_bharat',
      q: 'transfer',
      outcome: 'ok',
      actor: 'a@b.test',
      action: 'chat.send',
      project: 'p',
      deviceId: 'd',
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T00:00:00Z',
      size: 10,
      offset: 0,
    },
  ];
  for (const shape of shapes) {
    assert.ok(
      hasOrgTerm(shape, 'org_bharat'),
      `org filter missing for ${JSON.stringify(shape)}`,
    );
  }
});

test('there is no match_all path left', () => {
  // match_all was the leak. Its absence is the fix, so it is asserted directly rather than inferred
  // from the filter list.
  const dsl = buildQuery({ org: 'org_suraksha' }) as Record<string, unknown>;
  assert.ok(!JSON.stringify(dsl).includes('match_all'));
});

test('one tenant’s query cannot match another tenant’s rows', () => {
  // The two demo tenants whose screens were identical. Their queries must now differ in exactly the
  // clause that separates them.
  assert.ok(hasOrgTerm({ org: 'org_suraksha' }, 'org_suraksha'));
  assert.ok(!hasOrgTerm({ org: 'org_suraksha' }, 'org_bharat'));
  assert.ok(hasOrgTerm({ org: 'org_bharat' }, 'org_bharat'));
  assert.ok(!hasOrgTerm({ org: 'org_bharat' }, 'org_suraksha'));
});

test('documents with no org are matched by no tenant', () => {
  // 122 legacy device/gateway docs predate attribution and carry no `org` field. A term filter on
  // org.keyword matches none of them, and that is intended: a record we cannot attribute to an org
  // must not be shown to an org. This test exists to make that a decision rather than an accident —
  // if someone later adds an `exists`/`missing` fallback to "recover" those rows, it breaks here,
  // because such a fallback is exactly how one tenant would see another's data again.
  const dsl = JSON.stringify(buildQuery({ org: 'org_suraksha' }));
  assert.ok(!dsl.includes('must_not'), 'no negation that could readmit unattributed docs');
  assert.ok(!dsl.includes('exists'), 'no exists-clause fallback for docs without an org');
  assert.ok(!dsl.includes('missing'), 'no missing-value fallback for docs without an org');
});

test('the org is taken verbatim and is the only tenant clause', () => {
  // Guards against a future "helpful" normalisation (lowercasing, slug-mapping, prefixing) silently
  // widening the match, and against a second tenant-ish clause being added alongside this one.
  const orgTerms = filtersOf({ org: 'Org_Suraksha' }).filter((f) =>
    Object.keys((f as { term?: Record<string, unknown> }).term ?? {}).some((k) =>
      k.startsWith('org'),
    ),
  );
  assert.equal(orgTerms.length, 1);
  assert.deepEqual(orgTerms[0], { term: { 'org.keyword': 'Org_Suraksha' } });
});
