import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the pipeline REVERSE-EDGE read helpers (T2 join-key): listPipelinesByDomain /
// listPipelinesByDomains / listPipelinesReferencing in src/lib/pipelines.ts, against a REAL Postgres.
// Verifies the correct scoping ("which pipelines allowlist this domain") AND — critically — that a
// pipeline in ANOTHER org never leaks into the reverse edge. Skips (green) when no DB is up. All rows
// live under dedicated org ids so real data is untouched.

const ORG = 'test-int-revedge';
const OTHER = 'test-int-revedge-other';

const dbUp = await dbReachable();

test('pipeline reverse-edge read helpers: scoping + no cross-org leak', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensurePipelinesSchema,
    createPipeline,
    listPipelines,
    deletePipeline,
    listPipelinesByDomain,
    listPipelinesByDomains,
    listPipelinesReferencing,
  } = await import('@/lib/pipelines');

  await ensurePipelinesSchema();

  t.after(async () => {
    for (const org of [ORG, OTHER]) {
      for (const p of await listPipelines(org)) await deletePipeline(p.id, org);
    }
  });

  // Two pipelines in ORG. One allowlists the domain by its LABEL, one by an ALIAS, one references nothing.
  const byLabel = await createPipeline(
    { name: 'Reimbursement Governance', dataAllowlist: ['Employee Records', 'expense-policy'] },
    'owner@x.io',
    ORG,
  );
  const byAlias = await createPipeline(
    { name: 'HR Assistant', dataAllowlist: ['staff-data'] },
    'owner@x.io',
    ORG,
  );
  const unrelated = await createPipeline(
    { name: 'Loan Underwriting', dataAllowlist: ['loan-applications', 'credit-bureau'] },
    'owner@x.io',
    ORG,
  );

  // A pipeline in ANOTHER org that ALSO allowlists the same domain label — must NOT leak into ORG's edge.
  await createPipeline(
    { name: 'Other-Org HR', dataAllowlist: ['Employee Records'] },
    'owner@y.io',
    OTHER,
  );

  const domain = { id: 'dom_emp', label: 'Employee Records', aliases: ['staff-data'] };

  // ── listPipelinesByDomain — matches by label OR alias, org-scoped ────────────────────────────────
  const refs = await listPipelinesByDomain(domain, ORG);
  const refIds = refs.map((p) => p.id).sort();
  assert.deepEqual(refIds, [byAlias.id, byLabel.id].sort(), 'both label + alias matches, no unrelated');
  assert.ok(!refIds.includes(unrelated.id), 'a pipeline that does not allowlist the domain is excluded');

  // Cross-org isolation: the OTHER-org pipeline never appears in ORG's reverse edge.
  const otherLeak = refs.filter((p) => p.orgId !== ORG);
  assert.equal(otherLeak.length, 0, 'no cross-org leak');

  // ── listPipelinesByDomains — union across several domains, de-duped ───────────────────────────────
  const union = await listPipelinesByDomains(
    [domain, { id: 'dom_loan', label: 'loan-applications', aliases: [] }],
    ORG,
  );
  assert.deepEqual(
    union.map((p) => p.id).sort(),
    [byAlias.id, byLabel.id, unrelated.id].sort(),
    'union spans HR (domain) + loan (second domain), each once',
  );

  // ── listPipelinesReferencing — generic token match (e.g. a tool id/name) ─────────────────────────
  const byToken = await listPipelinesReferencing(['expense-policy'], ORG);
  assert.deepEqual(byToken.map((p) => p.id), [byLabel.id], 'only the pipeline whose ceiling names it');
  const none = await listPipelinesReferencing(['nonexistent-tool'], ORG);
  assert.equal(none.length, 0, 'no false positives');
});
