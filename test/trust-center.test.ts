import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, isKnownControl } from '../src/lib/compliance-catalog.ts';
import {
  ARTIFACT_STATUSES,
  buildPosture,
  COMPLIANCE_ARTIFACTS,
  controlBriefs,
  EMPTY_INPUTS,
  INDIA_BFSI_FRAMINGS,
  isArtifactStatus,
  isPostureStatus,
  PILLAR_LABELS,
  PILLARS,
  POSTURE_STATUSES,
  rollupFramings,
  summariseArtifacts,
  summarisePosture,
  type PostureInputs,
  type PostureStatus,
} from '../src/lib/trust-center.ts';

// Pure aggregation for the Trust Center — posture derivation, artifact checklist, India-BFSI
// framings rollup, and the overall summary. No DB, no mocks. The I/O adapter (env/config reads) is
// verified by build + integration, not here.

// A fully-on snapshot — every fact true. Used to assert the "everything implemented" ceiling.
const ALL_ON: PostureInputs = {
  securityHeaders: true,
  wafEnabled: true,
  rateLimit: true,
  ssoConfigured: true,
  secretsVault: true,
  secretsVaultPersistent: true,
  auditImmutable: true,
  siemStreaming: true,
  provenanceSigning: true,
  piiRedaction: true,
  piiFloorEnforced: true,
  egressLeash: true,
  guardrails: true,
  onPrem: true,
  backupsAutomated: true,
  drReplica: true,
  coverageGate: true,
  tenantIsolationVerified: true,
};

// ── status guards ──────────────────────────────────────────────────────────────

test('isPostureStatus accepts every known status and rejects others', () => {
  for (const s of POSTURE_STATUSES) assert.equal(isPostureStatus(s), true);
  assert.equal(isPostureStatus('done'), false);
  assert.equal(isPostureStatus(42), false);
  assert.equal(isPostureStatus(undefined), false);
});

test('isArtifactStatus accepts every known status and rejects others', () => {
  for (const s of ARTIFACT_STATUSES) assert.equal(isArtifactStatus(s), true);
  assert.equal(isArtifactStatus('ready'), false);
  assert.equal(isArtifactStatus(null), false);
});

// ── posture derivation ──────────────────────────────────────────────────────────

test('buildPosture yields an item per spec across all posture pillars', () => {
  const items = buildPosture(EMPTY_INPUTS);
  assert.ok(items.length >= 15, 'a representative posture set');
  // every item sits in a known pillar and has capability copy + a status
  for (const it of items) {
    assert.ok(PILLARS.includes(it.pillar));
    assert.ok(it.title && it.detail, `${it.id} populated`);
    assert.ok(isPostureStatus(it.status));
  }
  // no posture item lands in the compliance-artifacts pillar (that has its own checklist)
  assert.ok(items.every((i) => i.pillar !== 'compliance-artifacts'));
});

test('every posture evidenceFor id is a real catalog control', () => {
  for (const it of buildPosture(ALL_ON)) {
    for (const id of it.evidenceFor) {
      assert.equal(isKnownControl(id), true, `${it.id} references known control ${id}`);
    }
  }
});

test('a stale evidence id would be dropped, not surfaced', () => {
  // Guard the filter: assert a bogus id is not a known control (so buildPosture would drop it) and
  // that no real posture item leaks one.
  assert.equal(isKnownControl('not-a-real-control'), false);
  const allEvidence = buildPosture(ALL_ON).flatMap((i) => i.evidenceFor);
  assert.ok(allEvidence.every(isKnownControl));
});

test('flag-driven items flip implemented<->in-progress with the snapshot', () => {
  const off = buildPosture(EMPTY_INPUTS);
  const on = buildPosture(ALL_ON);
  const status = (items: ReturnType<typeof buildPosture>, id: string): PostureStatus =>
    items.find((i) => i.id === id)!.status;

  // sec-headers is flag-driven off `securityHeaders`: off => in-progress, on => implemented
  assert.equal(status(off, 'sec-headers'), 'in-progress');
  assert.equal(status(on, 'sec-headers'), 'implemented');
  // sec-waf is flag-driven: off => in-progress, on => implemented
  assert.equal(status(off, 'sec-waf'), 'in-progress');
  assert.equal(status(on, 'sec-waf'), 'implemented');
  // sso
  assert.equal(status(off, 'sec-sso'), 'in-progress');
  assert.equal(status(on, 'sec-sso'), 'implemented');
});

test('on-prem is planned (not in-progress) when off — the honest floor for residency', () => {
  const off = buildPosture(EMPTY_INPUTS).find((i) => i.id === 'data-onprem')!;
  assert.equal(off.status, 'planned');
  const on = buildPosture(ALL_ON).find((i) => i.id === 'data-onprem')!;
  assert.equal(on.status, 'implemented');
});

test('secrets vault is three-state: planned -> in-progress -> implemented', () => {
  const planned = buildPosture({ ...EMPTY_INPUTS }).find((i) => i.id === 'data-vault')!;
  assert.equal(planned.status, 'planned'); // no vault at all
  const inProg = buildPosture({ ...EMPTY_INPUTS, secretsVault: true }).find(
    (i) => i.id === 'data-vault',
  )!;
  assert.equal(inProg.status, 'in-progress'); // vault present but not persistent (readiness R1)
  const done = buildPosture({
    ...EMPTY_INPUTS,
    secretsVault: true,
    secretsVaultPersistent: true,
  }).find((i) => i.id === 'data-vault')!;
  assert.equal(done.status, 'implemented');
});

test('audit trail needs both immutable recording AND searchable streaming to be implemented', () => {
  const none = buildPosture(EMPTY_INPUTS).find((i) => i.id === 'ai-audit')!;
  assert.equal(none.status, 'planned');
  const auditOnly = buildPosture({ ...EMPTY_INPUTS, auditImmutable: true }).find(
    (i) => i.id === 'ai-audit',
  )!;
  assert.equal(auditOnly.status, 'in-progress');
  const both = buildPosture({ ...EMPTY_INPUTS, auditImmutable: true, siemStreaming: true }).find(
    (i) => i.id === 'ai-audit',
  )!;
  assert.equal(both.status, 'implemented');
});

test('tenant isolation and PII floor are honest in-progress when unverified (open readiness items)', () => {
  const off = buildPosture(EMPTY_INPUTS);
  assert.equal(off.find((i) => i.id === 'sec-tenant-isolation')!.status, 'in-progress');
  assert.equal(off.find((i) => i.id === 'data-pii-floor')!.status, 'in-progress');
  const on = buildPosture(ALL_ON);
  assert.equal(on.find((i) => i.id === 'sec-tenant-isolation')!.status, 'implemented');
  assert.equal(on.find((i) => i.id === 'data-pii-floor')!.status, 'implemented');
});

test('network confinement needs BOTH on-prem and a WAF', () => {
  const status = (i: PostureInputs): PostureStatus =>
    buildPosture(i).find((x) => x.id === 'sec-network-confinement')!.status;
  assert.equal(status(EMPTY_INPUTS), 'in-progress');
  assert.equal(status({ ...EMPTY_INPUTS, onPrem: true }), 'in-progress'); // waf still off
  assert.equal(status({ ...EMPTY_INPUTS, wafEnabled: true }), 'in-progress'); // on-prem still off
  assert.equal(status({ ...EMPTY_INPUTS, onPrem: true, wafEnabled: true }), 'implemented');
});

// ── posture copy hygiene: NEVER name an OSS engine ───────────────────────────────

test('no posture copy names a banned OSS engine', () => {
  const banned = [
    'presidio',
    'coraza',
    'opensearch',
    'openbao',
    'keycloak',
    'sigstore',
    'temporal',
    'lancedb',
    'seaweedfs',
    'evidently',
    'ragas',
    'caddy',
  ];
  for (const it of buildPosture(ALL_ON)) {
    const hay = `${it.title} ${it.detail}`.toLowerCase();
    for (const b of banned) assert.ok(!hay.includes(b), `${it.id} must not name "${b}"`);
  }
});

// ── summary ──────────────────────────────────────────────────────────────────────

test('summarisePosture excludes not-applicable from the denominator and never inflates', () => {
  const posture = buildPosture(EMPTY_INPUTS);
  const s = summarisePosture(posture, '2026-01-01T00:00:00.000Z');
  assert.equal(s.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.ok(s.score >= 0 && s.score <= 100);
  const scoreable = s.totals.implemented + s.totals.inProgress + s.totals.planned;
  assert.equal(s.score, Math.round((s.totals.implemented / scoreable) * 100));
});

test('all-on posture scores 100%, empty scores below', () => {
  const on = summarisePosture(buildPosture(ALL_ON), 'x');
  assert.equal(on.score, 100);
  const off = summarisePosture(buildPosture(EMPTY_INPUTS), 'x');
  assert.ok(off.score < 100);
});

test('empty posture list scores 0 (no divide-by-zero)', () => {
  const s = summarisePosture([], 'x');
  assert.equal(s.score, 0);
  assert.equal(s.totals.implemented, 0);
});

test('pillar summaries cover every posture pillar and sum to totals', () => {
  const posture = buildPosture(ALL_ON);
  const s = summarisePosture(posture, 'x');
  // one summary row per pillar, in order
  assert.deepEqual(
    s.pillars.map((p) => p.pillar),
    [...PILLARS],
  );
  const implementedFromPillars = s.pillars.reduce((a, p) => a + p.implemented, 0);
  assert.equal(implementedFromPillars, s.totals.implemented);
  // labels resolve for every pillar
  for (const p of PILLARS) assert.ok(PILLAR_LABELS[p]);
});

test('summary counts not-applicable separately (branch coverage)', () => {
  const posture = [
    { id: 'x', pillar: 'security-posture' as const, title: 't', detail: 'd', status: 'not-applicable' as const, evidenceFor: [] },
    { id: 'y', pillar: 'security-posture' as const, title: 't', detail: 'd', status: 'implemented' as const, evidenceFor: [] },
  ];
  const s = summarisePosture(posture, 'x');
  assert.equal(s.totals.notApplicable, 1);
  assert.equal(s.totals.implemented, 1);
  assert.equal(s.score, 100); // N/A excluded from denominator
});

// ── compliance artifacts ───────────────────────────────────────────────────────

test('artifact checklist has honest statuses and no fabricated "available"', () => {
  assert.ok(COMPLIANCE_ARTIFACTS.length >= 6);
  for (const a of COMPLIANCE_ARTIFACTS) {
    assert.ok(isArtifactStatus(a.status));
    assert.ok(a.name && a.description);
  }
  // We do not currently HAVE any produced artifact — nothing is fabricated as "available".
  assert.equal(COMPLIANCE_ARTIFACTS.some((a) => a.status === 'available'), false);
  // But the live-generated ones ARE templates (the export exists).
  assert.ok(COMPLIANCE_ARTIFACTS.some((a) => a.status === 'template'));
  // And the heavy independent attestations are honestly planned.
  assert.ok(COMPLIANCE_ARTIFACTS.some((a) => a.id === 'soc2' && a.status === 'planned'));
});

test('summariseArtifacts tallies by status and totals correctly', () => {
  const s = summariseArtifacts(COMPLIANCE_ARTIFACTS);
  assert.equal(s.total, COMPLIANCE_ARTIFACTS.length);
  assert.equal(s.available + s.template + s.planned, s.total);
});

// ── India-BFSI framings ──────────────────────────────────────────────────────────

test('every framing maps only to real catalog controls', () => {
  assert.ok(INDIA_BFSI_FRAMINGS.length >= 4);
  const ids = ['rbi-model-governance', 'rbi-outsourcing-data-localisation', 'irdai-governance', 'dpdp-2023'];
  for (const id of ids) assert.ok(INDIA_BFSI_FRAMINGS.some((f) => f.id === id), `${id} present`);
  for (const f of INDIA_BFSI_FRAMINGS) {
    assert.ok(f.regulator && f.name && f.summary);
    assert.ok(f.controlIds.length > 0);
    for (const cid of f.controlIds) assert.equal(isKnownControl(cid), true, `${f.id} -> ${cid}`);
  }
});

test('rollupFramings evidences a framing only via IMPLEMENTED posture controls', () => {
  const onPosture = buildPosture(ALL_ON);
  const rolled = rollupFramings(INDIA_BFSI_FRAMINGS, onPosture);
  // with everything implemented, each framing whose controls are all covered reaches 100%
  for (const r of rolled) {
    assert.ok(r.coverage >= 0 && r.coverage <= 100);
    assert.equal(r.evidenced, r.controlIds.filter((cid) =>
      onPosture.some((p) => p.status === 'implemented' && p.evidenceFor.includes(cid)),
    ).length);
  }
  // with an EMPTY posture (nothing implemented), coverage is lower than the all-on case
  const offRolled = rollupFramings(INDIA_BFSI_FRAMINGS, buildPosture(EMPTY_INPUTS));
  const onTotal = rolled.reduce((a, r) => a + r.coverage, 0);
  const offTotal = offRolled.reduce((a, r) => a + r.coverage, 0);
  assert.ok(offTotal < onTotal);
});

test('rollupFramings handles an empty controlIds framing without dividing by zero', () => {
  const rolled = rollupFramings(
    [{ id: 'e', regulator: 'r', name: 'n', summary: 's', controlIds: [] }],
    buildPosture(ALL_ON),
  );
  assert.equal(rolled[0].coverage, 0);
  assert.equal(rolled[0].evidenced, 0);
});

// ── control briefs ───────────────────────────────────────────────────────────────

test('controlBriefs resolves known ids from the catalog and drops unknown', () => {
  const known = CATALOG[0].controls[0].id;
  const briefs = controlBriefs([known, 'ghost-control']);
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].id, known);
  assert.ok(briefs[0].ref && briefs[0].title && briefs[0].framework);
});

test('controlBriefs on an empty list returns empty', () => {
  assert.deepEqual(controlBriefs([]), []);
});
