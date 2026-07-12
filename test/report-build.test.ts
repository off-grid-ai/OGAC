import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Analytics } from '../src/lib/analytics-types.ts';
import type { Compliance } from '../src/lib/compliance.ts';
import type { ComplianceActivity } from '../src/lib/compliance-activity.ts';
import type { RegulatorSpec } from '../src/lib/reports-spec.ts';
import {
  buildActivityDoc,
  buildAuditDoc,
  buildComplianceDoc,
  buildEvalDoc,
  buildInventoryDoc,
  buildRegulatorDoc,
  buildTrustDoc,
  cell,
  chipFor,
  count,
  num,
  pct,
  periodEndingAt,
  ratePct,
  usd,
  type DocMetaInput,
} from '../src/lib/reports/build-doc.ts';
import type { ReportDoc } from '../src/lib/reports/model.ts';
import { validateReportDoc } from '../src/lib/reports/validate.ts';

// PURE tests: feed the data→ReportDoc mappers realistic India-BFSI (insurer) fixtures and assert the
// document (a) carries the required sections + REAL values, and (b) passes validateReportDoc. No IO,
// no ambient time — `now` is passed in. The mappers are the correctness core; the terminal PDF
// artifact is proven by the verify:reports harness + the integration test.

const NOW = '2026-07-12T09:00:00.000Z';
const TENANT = 'Suraksha Life Insurance';

function baseMeta(overrides: Partial<DocMetaInput> & Pick<DocMetaInput, 'title' | 'recipient' | 'classification' | 'filenameBase'>): DocMetaInput {
  return { tenantName: TENANT, now: NOW, ...overrides };
}

const compliance: Compliance = {
  generatedAt: NOW,
  posture: 63,
  controls: [
    { id: 'audit', name: 'Immutable audit trail', status: 'satisfied', evidence: '400-day append-only ledger' },
    { id: 'bias', name: 'Bias / fairness testing', status: 'partial', evidence: 'Underwriting model, quarterly' },
    { id: 'erasure', name: 'Right-to-erasure (DPDP)', status: 'gap', evidence: 'Embedding propagation pending' },
  ],
  frameworks: [
    { id: 'dpdp', name: 'DPDP Act 2023', coverage: 71, controlIds: ['audit', 'erasure'] },
    { id: 'iso-42001', name: 'ISO/IEC 42001', coverage: 58, controlIds: ['bias'] },
  ],
};
const governance = [
  { title: 'Board-approved AI policy', kind: 'policy', status: 'active', owner: 'A. Rao (CCO)' },
  { title: 'Model Risk Committee', kind: 'committee', status: 'active', owner: 'S. Iyer' },
];
const residency = {
  egressAllowed: false,
  allowedModels: ['llama-3.1-70b', 'mistral-large'],
  regionRules: [{ value: 'in', action: 'local', model: 'llama-3.1-70b' }],
};
const datasets = [
  { name: 'Policyholder master', classification: 'Restricted', source: 'Core insurance DB', rows: 4200000 },
];
const devices = [{ name: 'underwriting-mac-01', os: 'macOS', role: 'workstation', status: 'online' }];
const connectors = [{ name: 'Core insurance DB', type: 'postgres', status: 'connected' }];

// ── Value normalizers ─────────────────────────────────────────────────────────────────────────────

test('normalizers: cell/num/pct/count/ratePct/usd never emit undefined/NaN/blank', () => {
  assert.equal(cell(null), 'Not recorded');
  assert.equal(cell(''), 'Not recorded');
  assert.equal(cell('  '), 'Not recorded');
  assert.equal(cell(undefined, 'Unassigned'), 'Unassigned');
  assert.equal(cell('IRDAI'), 'IRDAI');
  assert.equal(cell(42), '42');
  assert.equal(num(NaN), 0);
  assert.equal(num(Infinity), 0);
  assert.equal(num(12), 12);
  assert.equal(pct(71), '71%');
  assert.equal(pct(null), '0%');
  assert.equal(count(4200000), '4,200,000');
  assert.equal(ratePct(0), '0.0%');
  assert.equal(ratePct(0.125), '12.5%');
  assert.equal(usd(512.444), '$512.44');
  assert.equal(usd(null), '$0.00');
});

test('chipFor maps compliance status to renderer chips exhaustively', () => {
  assert.equal(chipFor('satisfied'), 'pass');
  assert.equal(chipFor('partial'), 'partial');
  assert.equal(chipFor('gap'), 'fail');
});

test('periodEndingAt is a 30-day window ending at now, ISO dates, ordered', () => {
  const p = periodEndingAt(NOW);
  assert.equal(p.to, '2026-07-12');
  assert.equal(p.from, '2026-06-13');
  assert.ok(p.from < p.to);
});

// ── Family mappers ──────────────────────────────────────────────────────────────────────────────

const spec: RegulatorSpec = {
  name: 'IRDAI — insurers',
  status: 'No standalone IRDAI AI rule exists; governed via in-force cyber + DPDP.',
  frameworks: ['dpdp', 'iso-42001', 'hipaa'],
  questions: ['What data trains the model and the lawful basis?', 'How is bias tested in underwriting?'],
  artifacts: ['Model inventory + model cards', 'Bias/fairness reports + audit logs'],
};

function assertValid(doc: ReportDoc): void {
  const r = validateReportDoc(doc);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
}

test('buildRegulatorDoc: real values, required sections, passes validation', () => {
  const doc = buildRegulatorDoc(
    { spec, compliance, governance, residency, datasets, deviceCount: devices.length },
    baseMeta({
      title: `Regulator Response Pack — ${spec.name}`,
      subtitle: spec.frameworks.join(' · ').toUpperCase(),
      framework: 'DPDP',
      recipient: { role: 'regulator', name: spec.name },
      classification: 'Confidential',
      filenameBase: 'offgrid-regulator-irdai',
    }),
  );
  assertValid(doc);
  assert.equal(doc.meta.tenantName, TENANT);
  assert.equal(doc.meta.recipient.role, 'regulator');
  const headings = doc.sections.map((s) => s.heading);
  assert.ok(headings.includes('Framework coverage'));
  assert.ok(headings.includes('Controls (live posture)'));
  assert.ok(headings.includes('Data residency & model routing'));
  // The regulator's own questions/artifacts are carried into tables with reconciled counts.
  const qTable = doc.sections
    .find((s) => s.heading.startsWith('Questions'))!
    .blocks.find((b) => b.type === 'table');
  assert.ok(qTable && qTable.type === 'table');
  if (qTable.type === 'table') assert.equal(qTable.declaredCount, spec.questions.length);
  // Posture percentage present as a real value.
  const statusSection = doc.sections.find((s) => s.heading === 'Regulatory status')!;
  const kv = statusSection.blocks.find((b) => b.type === 'keyValues');
  assert.ok(kv && kv.type === 'keyValues' && kv.rows.some((r) => r.value === '63%'));
});

test('buildComplianceDoc: posture + frameworks + controls, passes validation', () => {
  const doc = buildComplianceDoc(
    { compliance, governance },
    baseMeta({
      title: 'Compliance Evidence Pack',
      framework: 'DPDP Act 2023',
      recipient: { role: 'dpo', name: `${TENANT} Data Protection Officer` },
      classification: 'Confidential',
      filenameBase: 'offgrid-compliance-evidence',
    }),
  );
  assertValid(doc);
  assert.equal(doc.meta.recipient.role, 'dpo');
  const summary = doc.sections[0];
  const kv = summary.blocks.find((b) => b.type === 'keyValues');
  assert.ok(kv && kv.type === 'keyValues');
  if (kv.type === 'keyValues') assert.ok(kv.rows.some((r) => r.value === '63%'));
});

test('buildTrustDoc: posture score + framings + artifacts, passes validation', () => {
  const doc = buildTrustDoc(
    {
      summary: {
        generatedAt: NOW,
        score: 72,
        totals: { implemented: 13, inProgress: 4, planned: 2, notApplicable: 1 },
        pillars: [],
      },
      posture: [
        { id: 'p1', pillar: 'security-posture', title: 'On-prem inference', detail: 'All local', status: 'implemented', evidenceFor: [] },
        { id: 'p2', pillar: 'ai-governance', title: 'Bias testing', detail: 'Quarterly', status: 'in-progress', evidenceFor: [] },
      ],
      framings: [
        { id: 'f1', regulator: 'IRDAI', name: 'Insurer AI governance', summary: '', controlIds: [], evidenced: 3, coverage: 60 },
      ],
      artifacts: [{ id: 'a1', name: 'DPIA template', description: '', status: 'available' }],
    },
    baseMeta({
      title: 'Trust & Security Summary',
      recipient: { role: 'dpo', name: `${TENANT} Data Protection Officer` },
      classification: 'Confidential',
      filenameBase: 'offgrid-trust-summary',
    }),
  );
  assertValid(doc);
  const kv = doc.sections[0].blocks.find((b) => b.type === 'keyValues');
  assert.ok(kv && kv.type === 'keyValues' && kv.rows.some((r) => r.value === '72%'));
});

test('buildInventoryDoc: devices/connectors/datasets tables reconcile, passes validation', () => {
  const doc = buildInventoryDoc(
    { residency, devices, connectors, datasets },
    baseMeta({
      title: 'Model & Data Inventory',
      recipient: { role: 'cdo', name: `${TENANT} Chief Data Officer` },
      classification: 'Internal',
      filenameBase: 'offgrid-inventory',
    }),
  );
  assertValid(doc);
  assert.equal(doc.meta.recipient.role, 'cdo');
  const dsTable = doc.sections
    .find((s) => s.heading.startsWith('Datasets'))!
    .blocks.find((b) => b.type === 'table');
  assert.ok(dsTable && dsTable.type === 'table');
  if (dsTable.type === 'table') {
    assert.equal(dsTable.declaredCount, 1);
    assert.ok(dsTable.rows[0].includes('4,200,000')); // real row count, formatted
  }
});

const analytics: Analytics = {
  totalEvents: 128450,
  totalTokens: 9820000,
  p50: 320,
  p95: 1180,
  egressRate: 0,
  outcomes: { ok: 126900, redacted: 1200, blocked: 350 },
  byModel: [{ model: 'llama-3.1-70b', events: 98000, tokens: 7100000, avgLatency: 340 }],
  series: [],
  drift: { recent: 0.12, baseline: 0.1, flagged: false },
  perf: { recent: 340, baseline: 330, flagged: false },
};

test('buildAuditDoc: volume/outcomes/per-model/signals, passes validation', () => {
  const doc = buildAuditDoc(
    analytics,
    baseMeta({
      title: 'Audit & Usage Summary',
      recipient: { role: 'cdo', name: `${TENANT} Chief Data Officer` },
      classification: 'Internal',
      filenameBase: 'offgrid-audit-summary',
    }),
  );
  assertValid(doc);
  const vol = doc.sections[0].blocks.find((b) => b.type === 'keyValues');
  assert.ok(vol && vol.type === 'keyValues' && vol.rows.some((r) => r.value === '128,450'));
});

test('buildEvalDoc: cases carry pass/fail verdicts, passes validation', () => {
  const doc = buildEvalDoc(
    {
      caseCount: 2,
      latest: { passed: 1, total: 2, score: 50 },
      cases: [
        { query: 'Surrender value?', expected: 'clause 7', verdict: 'pass', top: 'clause 7' },
        { query: 'Rejection reason?', expected: 'exclusions', verdict: 'fail', top: 'clause 3' },
      ],
    },
    baseMeta({
      title: 'Retrieval Quality Report',
      recipient: { role: 'internal', name: `${TENANT} AI Governance` },
      classification: 'Internal',
      filenameBase: 'offgrid-eval-report',
    }),
  );
  assertValid(doc);
  const list = doc.sections.find((s) => s.heading === 'Cases')!.blocks.find((b) => b.type === 'statusList');
  assert.ok(list && list.type === 'statusList');
  if (list.type === 'statusList') {
    assert.equal(list.items[0].status, 'pass');
    assert.equal(list.items[1].status, 'fail');
  }
});

test('buildEvalDoc: no runs yet still produces a valid document (honest placeholder)', () => {
  const doc = buildEvalDoc(
    { caseCount: 0, latest: undefined, cases: [{ query: 'q', expected: 'e', verdict: 'na', top: '' }] },
    baseMeta({
      title: 'Retrieval Quality Report',
      recipient: { role: 'internal', name: `${TENANT} AI Governance` },
      classification: 'Internal',
      filenameBase: 'offgrid-eval-report',
    }),
  );
  assertValid(doc);
  const kv = doc.sections[0].blocks.find((b) => b.type === 'keyValues');
  assert.ok(kv && kv.type === 'keyValues' && kv.rows.some((r) => r.value === 'No runs recorded yet'));
});

const activity: ComplianceActivity = {
  generatedAt: NOW,
  from: '2026-06-13',
  to: '2026-07-12',
  org: 'default',
  totals: { events: 128450, costUsd: 512.44, tokens: 9820000, actors: 42, blockedOrDenied: 350, redacted: 1200 },
  outcomes: { ok: 126900, blocked: 300, redacted: 1200, denied: 40, error: 10 },
  byActor: [{ key: 'underwriting-team', events: 60000, costUsd: 240.11, tokens: 4000000, blocked: 120 }],
  byAction: [{ key: 'model.call', events: 128000, costUsd: 512.0, tokens: 9800000, blocked: 350 }],
  byModel: [{ key: 'llama-3.1-70b', events: 98000, costUsd: 380.22, tokens: 7100000, blocked: 200 }],
  blockedEvents: [],
  provenance: { runs: 5400, signed: 5400, coveragePct: 100 },
};

test('buildActivityDoc: totals/outcomes/actor/model + provenance, passes validation', () => {
  const doc = buildActivityDoc(
    activity,
    baseMeta({
      title: 'Data Processing Activity Report',
      framework: 'DPDP Act 2023',
      recipient: { role: 'dpo', name: `${TENANT} Data Protection Officer` },
      classification: 'Confidential',
      filenameBase: 'offgrid-processing-activity',
    }),
  );
  assertValid(doc);
  const totals = doc.sections[0].blocks.find((b) => b.type === 'keyValues');
  assert.ok(totals && totals.type === 'keyValues' && totals.rows.some((r) => r.value === '$512.44'));
  const prov = doc.sections.find((s) => s.heading === 'Provenance coverage')!;
  const callout = prov.blocks.find((b) => b.type === 'callout');
  assert.ok(callout && callout.type === 'callout' && callout.tone === 'attest');
});

test('mappers tolerate missing/blank fields without emitting placeholders that fail validation', () => {
  // Owner missing, model missing on a region rule — the normalizers backfill readable, non-empty text.
  const doc = buildRegulatorDoc(
    {
      spec,
      compliance,
      governance: [{ title: 'Policy', kind: 'policy', status: 'active', owner: '' }],
      residency: { egressAllowed: true, allowedModels: [], regionRules: [{ value: 'in', action: 'local', model: '' }] },
      datasets: [{ name: 'DS', classification: 'Internal', source: 'src', rows: 0 }],
      deviceCount: 0,
    },
    baseMeta({
      title: 'Regulator Response Pack — IRDAI',
      recipient: { role: 'regulator', name: 'IRDAI' },
      classification: 'Confidential',
      filenameBase: 'offgrid-regulator-irdai',
    }),
  );
  assertValid(doc);
  const gov = doc.sections.find((s) => s.heading.startsWith('Governance'))!.blocks.find((b) => b.type === 'table');
  assert.ok(gov && gov.type === 'table' && gov.rows[0].includes('Unassigned'));
});
