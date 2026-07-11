// AUTOMATED regulator-PDF verification. For every report family: build the ReportDoc from realistic
// India-BFSI fixture data via the REAL pure mappers (src/lib/reports/build-doc.ts), render it through
// the REAL branded renderer (src/lib/reports/render.tsx), then extract ALL text with pdfjs-dist and
// assert the terminal artifact:
//   (a) it is a valid %PDF with pageCount >= 1;
//   (b) the EXPECTED data is present — tenant name, framework, the "Prepared for" recipient, and at
//       least one real metric/number; and
//   (c) NONE of the forbidden markers appear — "undefined", "NaN", "[object Object]", "TODO", or a
//       lone "—" cell — the tells of a broken/half-empty document that must never reach a regulator.
// Each PDF is written to <scratchpad>/report-pdfs/<id>.pdf for a visual on-brand check, and a
// PASS/FAIL table is printed. Runs DB-less (fixtures) so it is deterministic in any environment; the
// real DB path is proven separately by test/report-pdf.integration.test.ts.
//
// Run: npm run verify:reports  (which sets --import ./test/support/register-alias.mjs so `@/` +
// the .tsx transform hook resolve).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildActivityDoc,
  buildAuditDoc,
  buildComplianceDoc,
  buildEvalDoc,
  buildInventoryDoc,
  buildRegulatorDoc,
  buildTrustDoc,
} from '@/lib/reports/build-doc';
import { renderReportDoc } from '@/lib/reports/render';
import { validateReportDoc } from '@/lib/reports/validate';
import { REGULATORS } from '@/lib/reports-spec';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR =
  process.env.REPORT_PDF_OUT ??
  join(
    '/private/tmp/claude-501/-Users-user-wednesday-off-grid-ai-console/323d0eb2-d030-4591-b755-1399e29a3fc6/scratchpad',
    'report-pdfs',
  );

const NOW = '2026-07-12T09:00:00.000Z';
const TENANT = 'Suraksha Life Insurance';

// ── Realistic India-BFSI (insurer) fixtures ────────────────────────────────────────────────────────
const compliance = {
  generatedAt: NOW,
  posture: 63,
  controls: [
    { id: 'audit', name: 'Immutable audit trail', status: 'satisfied', evidence: 'Append-only ledger, 400 days' },
    { id: 'pii', name: 'PII masking (policyholder data)', status: 'satisfied', evidence: 'PAN / Aadhaar recognizers active' },
    { id: 'bias', name: 'Bias / fairness testing', status: 'partial', evidence: 'Underwriting model tested quarterly' },
    { id: 'erasure', name: 'Right-to-erasure (DPDP)', status: 'gap', evidence: 'Embedding-store propagation pending' },
  ],
  frameworks: [
    { id: 'dpdp', name: 'DPDP Act 2023', coverage: 71, controlIds: ['audit', 'pii', 'erasure'] },
    { id: 'iso-42001', name: 'ISO/IEC 42001', coverage: 58, controlIds: ['bias'] },
    { id: 'hipaa', name: 'HIPAA', coverage: 44, controlIds: ['pii'] },
  ],
};
const governance = [
  { title: 'Board-approved AI policy', kind: 'policy', status: 'active', owner: 'A. Rao (CCO)' },
  { title: 'Model Risk Committee', kind: 'committee', status: 'active', owner: 'S. Iyer' },
  { title: 'Quarterly bias review', kind: 'process', status: 'active', owner: 'Data Science' },
];
const residency = {
  egressAllowed: false,
  allowedModels: ['llama-3.1-70b', 'mistral-large'],
  regionRules: [{ value: 'in', action: 'local', model: 'llama-3.1-70b' }],
};
const datasets = [
  { name: 'Policyholder master', classification: 'Restricted', source: 'Core insurance DB', rows: 4200000 },
  { name: 'Claims history', classification: 'Confidential', source: 'Claims system', rows: 830000 },
];
const devices = [
  { name: 'underwriting-mac-01', os: 'macOS', role: 'workstation', status: 'online' },
  { name: 'claims-mac-02', os: 'macOS', role: 'workstation', status: 'offline' },
];
const connectors = [{ name: 'Core insurance DB', type: 'postgres', status: 'connected' }];
const analytics = {
  totalEvents: 128450,
  totalTokens: 9820000,
  p50: 320,
  p95: 1180,
  egressRate: 0,
  outcomes: { ok: 126900, redacted: 1200, blocked: 350 },
  byModel: [
    { model: 'llama-3.1-70b', events: 98000, tokens: 7100000, avgLatency: 340 },
    { model: 'mistral-large', events: 30450, tokens: 2720000, avgLatency: 410 },
  ],
  series: [],
  drift: { recent: 0.12, baseline: 0.1, flagged: false },
  perf: { recent: 340, baseline: 330, flagged: false },
};
const trustSummary = {
  generatedAt: NOW,
  score: 72,
  totals: { implemented: 13, inProgress: 4, planned: 2, notApplicable: 1 },
  pillars: [],
};
const posture = [
  { id: 'p1', pillar: 'security-posture', title: 'On-prem inference (no cloud egress)', detail: 'All inference local', status: 'implemented', evidenceFor: [] },
  { id: 'p2', pillar: 'ai-governance', title: 'Bias / fairness testing', detail: 'Quarterly', status: 'in-progress', evidenceFor: [] },
  { id: 'p3', pillar: 'compliance-artifacts', title: 'DPIA on file', detail: 'Annual', status: 'planned', evidenceFor: [] },
];
const framings = [
  { id: 'f1', regulator: 'IRDAI', name: 'Insurer AI governance', summary: '', controlIds: [], evidenced: 3, coverage: 60 },
  { id: 'f2', regulator: 'RBI', name: 'Model risk', summary: '', controlIds: [], evidenced: 2, coverage: 50 },
];
const artifacts = [
  { id: 'a1', name: 'DPIA template', description: '', status: 'available' },
  { id: 'a2', name: 'Model cards', description: '', status: 'template' },
];
const activity = {
  generatedAt: NOW,
  from: '2026-06-12',
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

function meta(overrides) {
  return { tenantName: TENANT, now: NOW, ...overrides };
}

// The report families this harness verifies (regulator packs are expanded from REGULATORS).
function allDocs() {
  const docs = [];
  for (const [id, spec] of Object.entries(REGULATORS)) {
    docs.push({
      id: `regulator-${id}`,
      framework: (spec.frameworks[0] ?? '').toUpperCase(),
      recipient: spec.name,
      doc: buildRegulatorDoc(
        { spec, compliance, governance, residency, datasets, deviceCount: devices.length },
        meta({
          title: `Regulator Response Pack — ${spec.name}`,
          subtitle: spec.frameworks.join(' · ').toUpperCase(),
          framework: spec.frameworks[0]?.toUpperCase(),
          recipient: { role: 'regulator', name: spec.name },
          classification: 'Confidential',
          filenameBase: `offgrid-regulator-${id}`,
        }),
      ),
    });
  }
  docs.push({
    id: 'compliance',
    framework: 'DPDP Act 2023',
    recipient: 'Data Protection Officer',
    doc: buildComplianceDoc(
      { compliance, governance },
      meta({
        title: 'Compliance Evidence Pack',
        framework: 'DPDP Act 2023',
        recipient: { role: 'dpo', name: `${TENANT} Data Protection Officer` },
        classification: 'Confidential',
        filenameBase: 'offgrid-compliance-evidence',
      }),
    ),
  });
  docs.push({
    id: 'trust',
    framework: undefined,
    recipient: 'Data Protection Officer',
    doc: buildTrustDoc(
      { summary: trustSummary, posture, framings, artifacts },
      meta({
        title: 'Trust & Security Summary',
        recipient: { role: 'dpo', name: `${TENANT} Data Protection Officer` },
        classification: 'Confidential',
        filenameBase: 'offgrid-trust-summary',
      }),
    ),
  });
  docs.push({
    id: 'inventory',
    framework: undefined,
    recipient: 'Chief Data Officer',
    doc: buildInventoryDoc(
      { residency, devices, connectors, datasets },
      meta({
        title: 'Model & Data Inventory',
        recipient: { role: 'cdo', name: `${TENANT} Chief Data Officer` },
        classification: 'Internal',
        filenameBase: 'offgrid-inventory',
      }),
    ),
  });
  docs.push({
    id: 'audit-summary',
    framework: undefined,
    recipient: 'Chief Data Officer',
    doc: buildAuditDoc(
      analytics,
      meta({
        title: 'Audit & Usage Summary',
        recipient: { role: 'cdo', name: `${TENANT} Chief Data Officer` },
        classification: 'Internal',
        filenameBase: 'offgrid-audit-summary',
      }),
    ),
  });
  docs.push({
    id: 'eval-report',
    framework: undefined,
    recipient: 'AI Governance',
    doc: buildEvalDoc(
      {
        caseCount: 3,
        latest: { passed: 2, total: 3, score: 67 },
        cases: [
          { query: 'What is the surrender value?', expected: 'policy clause 7', verdict: 'pass', top: 'clause 7' },
          { query: 'Claim rejection reason?', expected: 'exclusion list', verdict: 'fail', top: 'clause 3' },
          { query: 'Premium due date?', expected: 'schedule A', verdict: 'pass', top: 'schedule A' },
        ],
      },
      meta({
        title: 'Retrieval Quality Report',
        recipient: { role: 'internal', name: `${TENANT} AI Governance` },
        classification: 'Internal',
        filenameBase: 'offgrid-eval-report',
      }),
    ),
  });
  docs.push({
    id: 'processing-activity',
    framework: 'DPDP Act 2023',
    recipient: 'Data Protection Officer',
    doc: buildActivityDoc(
      activity,
      meta({
        title: 'Data Processing Activity Report',
        framework: 'DPDP Act 2023',
        recipient: { role: 'dpo', name: `${TENANT} Data Protection Officer` },
        classification: 'Confidential',
        filenameBase: 'offgrid-processing-activity',
      }),
    ),
  });
  return docs;
}

async function extractText(bytes) {
  // pdfjs-dist legacy build runs in Node with no worker/canvas.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableWorker: true });
  const pdf = await loadingTask.promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  return { text, pageCount: pdf.numPages };
}

const FORBIDDEN = ['undefined', 'NaN', '[object Object]', 'TODO'];

function checkForbidden(text) {
  // Literal placeholder tells that must never render in a regulator artifact.
  return FORBIDDEN.filter((m) => text.includes(m));
}

// A lone "—"/"–" TABLE CELL is the placeholder tell the task forbids. validate.ts already rejects it
// STRUCTURALLY (a cell whose only content is a dash), and the harness runs validateReportDoc before
// render — so a lone-dash cell can never reach the PDF. We assert it at the structural layer (where a
// cell is unambiguous) rather than in flattened PDF text, where a legitimate prose em-dash ("expected
// X — retrieved Y") or a date-range en-dash is indistinguishable from a cell dash and yields false
// positives. This finds any table/keyValues cell that is exactly a dash.
function loneDashCells(doc) {
  const bad = [];
  for (const s of doc.sections) {
    for (const b of s.blocks) {
      if (b.type === 'table') {
        for (const row of b.rows) for (const c of row) if (isDashOnly(c)) bad.push(`${s.heading}:cell`);
      } else if (b.type === 'keyValues') {
        for (const r of b.rows) if (isDashOnly(r.value)) bad.push(`${s.heading}:${r.label}`);
      }
    }
  }
  return bad;
}
function isDashOnly(v) {
  return /^\s*[—–-]\s*$/.test(String(v));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const docs = allDocs();
  const results = [];
  for (const { id, framework, recipient, doc } of docs) {
    const row = { id, ok: true, reasons: [], pages: 0 };
    try {
      const verdict = validateReportDoc(doc);
      if (!verdict.ok) {
        row.ok = false;
        row.reasons.push(`invalid: ${verdict.issues.map((i) => `${i.path}:${i.message}`).join('; ')}`);
      }
      const bytes = await renderReportDoc(doc);
      const outPath = join(OUT_DIR, `${id}.pdf`);
      writeFileSync(outPath, Buffer.from(bytes));
      row.path = outPath;

      const head = Buffer.from(bytes.slice(0, 5)).toString();
      if (head !== '%PDF-') {
        row.ok = false;
        row.reasons.push(`bad header "${head}"`);
      }
      const { text, pageCount } = await extractText(bytes);
      row.pages = pageCount;
      if (pageCount < 1) {
        row.ok = false;
        row.reasons.push('pageCount < 1');
      }
      // (b) expected data present
      if (!text.includes(TENANT)) {
        row.ok = false;
        row.reasons.push('tenant name missing');
      }
      if (framework && !text.includes(framework)) {
        row.ok = false;
        row.reasons.push(`framework "${framework}" missing`);
      }
      if (!text.includes(recipient)) {
        row.ok = false;
        row.reasons.push(`recipient "${recipient}" missing`);
      }
      if (!/\d/.test(text)) {
        row.ok = false;
        row.reasons.push('no numeric metric present');
      }
      // (c) forbidden markers absent — literal placeholder strings in the rendered text …
      const forbidden = checkForbidden(text);
      if (forbidden.length) {
        row.ok = false;
        row.reasons.push(`forbidden: ${forbidden.join(', ')}`);
      }
      // … and no lone "—" cell in the structured document (unambiguous at the model layer).
      const dashCells = loneDashCells(doc);
      if (dashCells.length) {
        row.ok = false;
        row.reasons.push(`lone-dash cell(s): ${dashCells.join(', ')}`);
      }
    } catch (e) {
      row.ok = false;
      row.reasons.push(`threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    results.push(row);
  }

  // Print a PASS/FAIL table.
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nReport PDF verification — ${results.length} documents`);
  console.log('─'.repeat(78));
  console.log(`${pad('ID', 30)}${pad('PAGES', 7)}${pad('RESULT', 8)}REASONS`);
  console.log('─'.repeat(78));
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${pad(r.id, 30)}${pad(r.pages, 7)}${pad(r.ok ? 'PASS' : 'FAIL', 8)}${r.reasons.join('; ')}`);
  }
  console.log('─'.repeat(78));
  console.log(`${results.length - failed}/${results.length} passed. PDFs in ${OUT_DIR}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
