import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BHARAT_PROFILE,
  SURAKSHA_PROFILE,
  TOUR_PROFILES,
  BANK_APPS,
  INSURER_APPS,
  BANK_AGENTS,
  INSURER_AGENTS,
  GOVERNANCE_ITEMS,
  GUARDRAIL_RULES,
  COMPLIANCE_ADOPTION,
  appsFor,
  agentsFor,
  knowledgeFor,
  teamsFor,
  hash12,
  appId,
  appRunId,
  customAgentId,
  governanceId,
  guardrailId,
  goldenId,
  evalRunId,
  collectionId,
  teamId,
  planById,
  runStatuses,
  totalRuns,
  viewerUser,
  planViewerUser,
  VIEWER_ROLE,
  VIEWER_PASSWORD_ENV,
} from '@/lib/tour-demo-seed';
import { CATALOG } from '@/lib/compliance-catalog';

// ─── Profiles ──────────────────────────────────────────────────────────────────────────────────
test('two tour profiles: a bank (org_bharat) and an insurer (org_suraksha)', () => {
  assert.equal(TOUR_PROFILES.length, 2);
  assert.equal(BHARAT_PROFILE.orgId, 'org_bharat');
  assert.equal(BHARAT_PROFILE.flavour, 'bank');
  assert.equal(SURAKSHA_PROFILE.orgId, 'org_suraksha');
  assert.equal(SURAKSHA_PROFILE.flavour, 'insurer');
});

test('viewer emails follow the demo convention per tenant', () => {
  assert.equal(BHARAT_PROFILE.viewerEmail, 'viewer@bharatunion.demo');
  assert.equal(SURAKSHA_PROFILE.viewerEmail, 'viewer@suraksha.demo');
});

// ─── hash12 determinism ──────────────────────────────────────────────────────────────────────────
test('hash12 is deterministic + 12 hex chars', () => {
  assert.equal(hash12('abc'), hash12('abc'));
  assert.match(hash12('abc'), /^[0-9a-f]{12}$/);
  assert.notEqual(hash12('abc'), hash12('abd'));
});

test('ids are deterministic and namespaced by org (no cross-tenant collision)', () => {
  assert.equal(appId('org_bharat', 'kyc-rekyc'), appId('org_bharat', 'kyc-rekyc'));
  assert.notEqual(appId('org_bharat', 'kyc-rekyc'), appId('org_suraksha', 'kyc-rekyc'));
  assert.match(appId('org_bharat', 'kyc-rekyc'), /^app_[0-9a-f]{12}$/);
  assert.match(customAgentId('org_bharat', 'kyc-analyst'), /^ca_[0-9a-f]{12}$/);
  assert.match(governanceId('org_bharat', 'ai-policy'), /^gov_[0-9a-f]{12}$/);
  assert.match(guardrailId('org_bharat', 'pan'), /^gr_[0-9a-f]{12}$/);
  assert.match(goldenId('org_bharat', 'kyc-rekyc', 0), /^gc_[0-9a-f]{12}$/);
  assert.match(evalRunId('org_bharat', 'kyc-rekyc', 0), /^eval_[0-9a-f]{12}$/);
  assert.match(collectionId('org_bharat', 'policies'), /^kc_[0-9a-f]{12}$/);
  assert.match(teamId('org_bharat', 'risk'), /^team_[0-9a-f]{12}$/);
});

test('appRunId is distinct per index (N runs per app are unique + stable)', () => {
  const a = appRunId('org_bharat', 'kyc-rekyc', 0);
  const b = appRunId('org_bharat', 'kyc-rekyc', 1);
  assert.notEqual(a, b);
  assert.equal(a, appRunId('org_bharat', 'kyc-rekyc', 0)); // stable
});

// ─── Content richness per surface ─────────────────────────────────────────────────────────────────
test('each tenant seeds 6 governed apps, domain-appropriate', () => {
  assert.equal(BANK_APPS.length, 6);
  assert.equal(INSURER_APPS.length, 6);
  assert.ok(BANK_APPS.some((a) => a.title.includes('KYC')));
  assert.ok(BANK_APPS.some((a) => a.title.includes('Loan')));
  assert.ok(INSURER_APPS.some((a) => a.title.includes('FNOL')));
  assert.ok(INSURER_APPS.some((a) => a.title.includes('Death-Claim')));
});

test('appsFor / agentsFor / teamsFor / knowledgeFor select by flavour', () => {
  assert.equal(appsFor(BHARAT_PROFILE), BANK_APPS);
  assert.equal(appsFor(SURAKSHA_PROFILE), INSURER_APPS);
  assert.equal(agentsFor(BHARAT_PROFILE), BANK_AGENTS);
  assert.equal(agentsFor(SURAKSHA_PROFILE), INSURER_AGENTS);
  assert.ok(teamsFor(BHARAT_PROFILE).length >= 3);
  assert.ok(knowledgeFor(SURAKSHA_PROFILE)[0].docs.length >= 3);
});

test('each app binds a governed pipeline NAME that exists in SAMPLE_PIPELINES', async () => {
  const { SAMPLE_PIPELINES } = await import('@/lib/pipelines-seed');
  const names = new Set(SAMPLE_PIPELINES.map((p) => p.name));
  for (const a of [...BANK_APPS, ...INSURER_APPS]) {
    assert.ok(names.has(a.pipelineName), `${a.title} → ${a.pipelineName} is a real pipeline`);
  }
});

test('every app has at least one output step and no live-delivery sink (SHADOW-safe)', () => {
  for (const a of [...BANK_APPS, ...INSURER_APPS]) {
    const outs = a.steps.filter((s) => s.kind === 'output');
    assert.ok(outs.length >= 1, `${a.title} has an output`);
    for (const o of outs) assert.ok(['report', 'console'].includes(o.sink ?? ''), `${a.title} sink is safe`);
  }
});

test('every connector-query step names a domain (LABEL) — no dangling query', () => {
  for (const a of [...BANK_APPS, ...INSURER_APPS]) {
    for (const s of a.steps) {
      if (s.kind === 'connector-query') assert.ok(s.domain && s.domain.length > 0, `${a.title} query has a domain`);
    }
  }
});

test('runs are a mix so Runs AND Review both populate', () => {
  const bankAwaiting = BANK_APPS.reduce((n, a) => n + a.runs.awaitingReview, 0);
  const insAwaiting = INSURER_APPS.reduce((n, a) => n + a.runs.awaitingReview, 0);
  assert.ok(bankAwaiting > 0, 'bank has awaiting-review runs');
  assert.ok(insAwaiting > 0, 'insurer has awaiting-review runs');
  assert.ok(totalRuns(BHARAT_PROFILE) > 20);
  assert.ok(totalRuns(SURAKSHA_PROFILE) > 20);
});

test('runStatuses expands counts into done + awaiting_human', () => {
  const spec = BANK_APPS[0]; // kyc: done 7, awaiting 2
  const st = runStatuses(spec);
  assert.equal(st.length, spec.runs.done + spec.runs.awaitingReview);
  assert.equal(st.filter((s) => s === 'done').length, spec.runs.done);
  assert.equal(st.filter((s) => s === 'awaiting_human').length, spec.runs.awaitingReview);
});

test('4 custom agents per tenant', () => {
  assert.equal(BANK_AGENTS.length, 4);
  assert.equal(INSURER_AGENTS.length, 4);
});

test('governance registry + guardrail rules are non-trivial and enabled', () => {
  assert.ok(GOVERNANCE_ITEMS.length >= 5);
  assert.ok(GOVERNANCE_ITEMS.some((g) => g.kind === 'policy'));
  assert.ok(GUARDRAIL_RULES.length >= 5);
  assert.ok(GUARDRAIL_RULES.every((r) => r.enabled));
  // PAN + IFSC (Indian BFSI) are covered.
  assert.ok(GUARDRAIL_RULES.some((r) => r.label.includes('PAN')));
  assert.ok(GUARDRAIL_RULES.some((r) => r.label.includes('IFSC')));
});

// ─── Regulatory adoption: partial coverage, every control id is REAL ──────────────────────────────
test('compliance adoption references only REAL control ids from the catalog', () => {
  const real = new Set<string>();
  for (const f of CATALOG) for (const c of f.controls) real.add(c.id);
  for (const a of COMPLIANCE_ADOPTION) {
    assert.ok(real.has(a.controlId), `${a.controlId} is a real control`);
  }
});

test('each framework gets partial (non-zero, non-full) adoption so coverage bars render', () => {
  for (const fw of ['iso-42001', 'nist-ai-rmf', 'eu-ai-act'] as const) {
    const seeded = COMPLIANCE_ADOPTION.filter((a) => a.frameworkId === fw);
    const total = CATALOG.find((f) => f.id === fw)!.controls.length;
    assert.ok(seeded.length > 0, `${fw} has adoption rows`);
    assert.ok(seeded.length < total, `${fw} is not 100% (stays realistic)`);
    assert.ok(seeded.some((a) => a.status === 'met'), `${fw} has 'met' controls`);
  }
});

// ─── planById idempotency ──────────────────────────────────────────────────────────────────────
test('planById: creates all when none exist, none on a re-run', () => {
  const idOf = (a: (typeof BANK_APPS)[number]) => appId('org_bharat', a.key);
  const first = planById(BANK_APPS, idOf, []);
  assert.equal(first.toCreate.length, BANK_APPS.length);
  assert.equal(first.present.length, 0);
  const existingIds = BANK_APPS.map(idOf);
  const rerun = planById(BANK_APPS, idOf, existingIds);
  assert.equal(rerun.toCreate.length, 0);
  assert.equal(rerun.present.length, BANK_APPS.length);
});

test('planById: partial — only the missing ones are created', () => {
  const idOf = (a: (typeof BANK_APPS)[number]) => appId('org_bharat', a.key);
  const partial = planById(BANK_APPS, idOf, [idOf(BANK_APPS[0])]);
  assert.equal(partial.present.length, 1);
  assert.equal(partial.toCreate.length, BANK_APPS.length - 1);
});

// ─── Viewer user ──────────────────────────────────────────────────────────────────────────────
test('viewerUser: read-only role, tenant-scoped, deterministic id, no password field', () => {
  const u = viewerUser(BHARAT_PROFILE);
  assert.equal(u.role, VIEWER_ROLE);
  assert.equal(u.role, 'viewer');
  assert.equal(u.orgId, 'org_bharat');
  assert.equal(u.email, 'viewer@bharatunion.demo');
  assert.match(u.id, /^usr_[0-9a-f]{12}$/);
  assert.equal(u.id, viewerUser(BHARAT_PROFILE).id); // stable
  assert.ok(!('password' in u), 'no password stored in the seed row');
});

test('viewer password comes from an env var, never a literal', () => {
  assert.equal(VIEWER_PASSWORD_ENV, 'DEMO_VIEWER_PASSWORD');
});

test('planViewerUser: creates when absent, idempotent when the email exists', () => {
  const absent = planViewerUser(BHARAT_PROFILE, []);
  assert.equal(absent.present, false);
  assert.ok(absent.create);
  const present = planViewerUser(BHARAT_PROFILE, [' Viewer@BharatUnion.Demo ']);
  assert.equal(present.present, true);
  assert.equal(present.create, null);
});
