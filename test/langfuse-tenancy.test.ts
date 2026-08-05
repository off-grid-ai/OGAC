// Tenant ownership in the AI-observability store.
//
// The second cross-tenant leak found on 2026-08-05. The observability read layer had no tenant
// awareness at all — every function took a `limit` and nothing else — so /insights/ai/traces,
// /insights/ai/langfuse-prompts, /insights/ai/langfuse-datasets and /insights/ai/overview returned
// byte-identical data on both demo tenants, and opening the prompt from the Suraksha Life console
// displayed Bharat Union Bank's own system prompt. Public demo links, handed to outsiders.
//
// These tests pin the ownership decision itself. They are deliberately shaped like
// test/audit-tenant-boundary.test.ts (the first leak) because the property is the same one: a record
// belongs to exactly one tenant, and a record whose owner cannot be established belongs to nobody.
// No mocks — the filters are pure, so these assert real returned values.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  datasetOrg,
  filterByResolvedOrg,
  filterDatasetsForOrg,
  filterPromptsForOrg,
  filterSessionsForOrg,
  filterTracesForOrg,
  ORG_TAG_PREFIX,
  orgTag,
  promptOrg,
  traceOrg,
} from '@/lib/langfuse-tenancy';

const INSURER = 'org_suraksha';
const BANK = 'org_bharat';

// Shapes taken from the real records on the live deployment, not invented: a trace's org lives at
// metadata.attributes.org, its tags are [] and its userId is null — which is why tags/userId are not
// usable as the boundary.
const trace = (org: string | null) => ({
  id: `tr_${org ?? 'none'}`,
  name: 'audit.event.v2',
  tags: [] as string[],
  userId: null,
  metadata: org === null ? {} : { attributes: { action: 'app.run.report', org } },
});
const prompt = (org: string | null) => ({
  name: `prompt-${org ?? 'none'}`,
  tags: org === null ? [] : [orgTag(org)],
});
const dataset = (org: string | null) => ({
  name: `ds-${org ?? 'none'}`,
  metadata: org === null ? null : { org },
});

test('a trace is visible only to the org that owns it', () => {
  const traces = [trace(INSURER), trace(BANK)];
  assert.deepEqual(
    filterTracesForOrg(traces, INSURER).map((t) => t.id),
    [`tr_${INSURER}`],
  );
  assert.deepEqual(
    filterTracesForOrg(traces, BANK).map((t) => t.id),
    [`tr_${BANK}`],
  );
});

test('a prompt is visible only to the org that owns it', () => {
  // The concrete leak: the insurer's console rendering the bank's prompt.
  const prompts = [prompt(INSURER), prompt(BANK)];
  assert.deepEqual(
    filterPromptsForOrg(prompts, INSURER).map((p) => p.name),
    [`prompt-${INSURER}`],
  );
  assert.deepEqual(
    filterPromptsForOrg(prompts, BANK).map((p) => p.name),
    [`prompt-${BANK}`],
  );
});

test('a dataset is visible only to the org that owns it', () => {
  const datasets = [dataset(INSURER), dataset(BANK)];
  assert.deepEqual(
    filterDatasetsForOrg(datasets, INSURER).map((d) => d.name),
    [`ds-${INSURER}`],
  );
  assert.deepEqual(
    filterDatasetsForOrg(datasets, BANK).map((d) => d.name),
    [`ds-${BANK}`],
  );
});

test('the two demo tenants’ result sets are disjoint on every entity', () => {
  // The property that actually failed in production: both tenants saw the same rows. Asserted as
  // disjointness rather than per-tenant contents, so it holds however the fixtures grow.
  const traces = [trace(INSURER), trace(BANK), trace(null)];
  const prompts = [prompt(INSURER), prompt(BANK), prompt(null)];
  const datasets = [dataset(INSURER), dataset(BANK), dataset(null)];
  const overlap = <T>(a: readonly T[], b: readonly T[]) => a.filter((x) => b.includes(x));

  assert.equal(overlap(filterTracesForOrg(traces, INSURER), filterTracesForOrg(traces, BANK)).length, 0);
  assert.equal(overlap(filterPromptsForOrg(prompts, INSURER), filterPromptsForOrg(prompts, BANK)).length, 0);
  assert.equal(
    overlap(filterDatasetsForOrg(datasets, INSURER), filterDatasetsForOrg(datasets, BANK)).length,
    0,
  );
});

test('an unmarked record belongs to NOBODY', () => {
  // The rule that makes the boundary safe as data grows. The tempting alternative — "no marker means
  // shared" — is the leak itself: every unmarked record would appear on every tenant's screen. The
  // same decision excluded 122 unattributable documents in the audit fix.
  for (const org of [INSURER, BANK]) {
    assert.equal(filterTracesForOrg([trace(null)], org).length, 0);
    assert.equal(filterPromptsForOrg([prompt(null)], org).length, 0);
    assert.equal(filterDatasetsForOrg([dataset(null)], org).length, 0);
  }
});

test('a blank or missing org matches nothing at all', () => {
  // Otherwise an unresolved tenant (a bug upstream, a missing session) would behave like a wildcard and
  // hand over every record — failing OPEN, in the one place that must fail closed.
  const traces = [trace(INSURER), trace(BANK), trace(null)];
  for (const org of ['', '   ', null, undefined]) {
    assert.equal(filterTracesForOrg(traces, org).length, 0, `org ${JSON.stringify(org)} must match nothing`);
    assert.equal(filterPromptsForOrg([prompt(INSURER)], org).length, 0);
    assert.equal(filterDatasetsForOrg([dataset(INSURER)], org).length, 0);
  }
});

test('ownership is an exact match, never a prefix', () => {
  // Guards against a lookalike org id inheriting another's records — `org_bharat` must not match
  // `org_bharat_test`, in either direction.
  assert.equal(filterPromptsForOrg([prompt('org_bharat_test')], BANK).length, 0);
  assert.equal(filterPromptsForOrg([prompt(BANK)], 'org_bharat_test').length, 0);
  assert.equal(filterTracesForOrg([trace('org_bharat_test')], BANK).length, 0);
  assert.equal(filterDatasetsForOrg([dataset('org_bharat_test')], BANK).length, 0);
});

test('malformed markers resolve to no owner rather than throwing', () => {
  // `metadata` is free-form upstream: it can legitimately be null, a string, or an arbitrary object. A
  // crash here would take out the whole page; silently matching would leak.
  assert.equal(traceOrg({ metadata: null }), null);
  assert.equal(traceOrg({ metadata: 'not-an-object' }), null);
  assert.equal(traceOrg({ metadata: { attributes: 'not-an-object' } }), null);
  assert.equal(traceOrg({ metadata: { attributes: { org: '' } } }), null);
  assert.equal(traceOrg({}), null);
  assert.equal(datasetOrg({ metadata: undefined }), null);
  assert.equal(datasetOrg({ metadata: { org: 42 } }), null);
  assert.equal(promptOrg({ tags: null }), null);
  assert.equal(promptOrg({ tags: [ORG_TAG_PREFIX] }), null, 'a bare "org:" prefix names no org');
  assert.equal(promptOrg({ tags: ['unrelated', orgTag(BANK)] }), BANK, 'found among other tags');
});

test('a record whose owner is already resolved applies the same rule', () => {
  // The shaped DatasetRow carries `org` rather than the raw metadata it came from, so it needs its own
  // filter — and that filter must not become the lenient one. Same three properties as the raw path.
  const rows = [
    { name: 'a', org: INSURER },
    { name: 'b', org: BANK },
    { name: 'c', org: null },
  ];
  assert.deepEqual(
    filterByResolvedOrg(rows, INSURER).map((r) => r.name),
    ['a'],
  );
  assert.deepEqual(
    filterByResolvedOrg(rows, BANK).map((r) => r.name),
    ['b'],
  );
  assert.equal(
    filterByResolvedOrg(rows, INSURER).some((r) => r.org === null),
    false,
    'an unowned row is returned to nobody',
  );
  for (const org of ['', '  ', null, undefined]) {
    assert.equal(filterByResolvedOrg(rows, org).length, 0);
  }
  assert.equal(filterByResolvedOrg(rows, 'org_bharat_test').length, 0, 'exact match, never a prefix');
});

test('sessions are scoped by the run ids we can prove the org owns', () => {
  // A session carries no marker at all — its id is one of our own run ids, so ownership comes from our
  // database. An empty owned-set therefore yields nothing, which is the honest answer: we could not
  // establish ownership of any of them.
  const sessions = [{ id: 'run_a' }, { id: 'run_b' }, { id: null }];
  assert.deepEqual(
    filterSessionsForOrg(sessions, new Set(['run_a'])).map((s) => s.id),
    ['run_a'],
  );
  assert.equal(filterSessionsForOrg(sessions, new Set<string>()).length, 0);
  assert.equal(
    filterSessionsForOrg(sessions, new Set(['run_a'])).some((s) => s.id === null),
    false,
    'a session with no id can never be proven owned',
  );
});
