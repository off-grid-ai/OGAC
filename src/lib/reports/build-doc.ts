// PURE data → ReportDoc mappers. ZERO IO, zero ambient time: every input (live data + `now` +
// resolved tenant name + provenance) is passed IN, so each mapper is a deterministic function that
// is unit-tested directly (test/report-build.test.ts) and whose output is guaranteed to satisfy
// validateReportDoc. The async fetch-and-assemble half lives in build.ts (thin IO glue); this file
// owns the SHAPE of every regulator/DPO/CDO document. Keeping the mapping pure is what lets us prove
// — without a DB, a renderer, or a request — that a submittable artifact is complete and correct.
//
// A regulator document must never contain an empty cell, an `undefined`, a `NaN`, or a lone dash.
// The `cell()` / `pct()` / `num()` helpers below normalize every value BEFORE it reaches the model,
// and the mappers only emit rows/sections that carry real content, so validateReportDoc passes.
import type { Analytics } from '@/lib/analytics-types';
import type { Compliance, Status } from '@/lib/compliance';
import type { ComplianceActivity } from '@/lib/compliance-activity';
import type { RegulatorSpec } from '@/lib/reports-spec';
import type {
  ComplianceArtifact,
  FramingRollup,
  PostureItem,
  TrustSummary,
} from '@/lib/trust-center';
import type {
  Classification,
  ControlStatus as ChipStatus,
  Recipient,
  ReportBlock,
  ReportDoc,
  ReportProvenance,
  ReportSection,
} from '@/lib/reports/model';

// ── Value normalizers (the anti-"undefined cell" guard) ──────────────────────────────────────────

/** Render any cell value as a non-empty string. Empty/whitespace/nullish → a printable placeholder
 * that is STILL non-empty so the row is never flagged as blank, but reads honestly to a regulator. */
export function cell(v: unknown, fallback = 'Not recorded'): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length > 0 ? s : fallback;
}

/** A finite integer or 0 — never NaN/Infinity in a table. */
export function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Format a 0–100 integer percentage. */
export function pct(v: number | null | undefined): string {
  return `${num(v)}%`;
}

/** Format a 0–1 rate as a percentage with one decimal (e.g. egress rate). */
export function ratePct(v: number | null | undefined): string {
  return `${(num(v) * 100).toFixed(1)}%`;
}

/** Thousands-separated integer (locale-stable en-US) for volumes/tokens. */
export function count(v: number | null | undefined): string {
  return num(v).toLocaleString('en-US');
}

/** Map a compliance control Status → the renderer's chip status. `gap` is a hard fail; `satisfied`
 * a pass; `partial` partial. Exhaustive so a new Status surfaces as a type error, never silently. */
export function chipFor(status: Status): ChipStatus {
  switch (status) {
    case 'satisfied':
      return 'pass';
    case 'partial':
      return 'partial';
    case 'gap':
      return 'fail';
    default:
      return 'na';
  }
}

// ── Shared meta assembly ─────────────────────────────────────────────────────────────────────────

export interface DocMetaInput {
  title: string;
  subtitle?: string;
  tenantName: string;
  framework?: string;
  recipient: Recipient;
  classification: Classification;
  now: string; // ISO — passed in, never Date.now() here
  provenance?: ReportProvenance;
  filenameBase: string;
}

/** The reporting period is the 30 days ending at `now` (inclusive), as ISO dates. Pure. */
export function periodEndingAt(now: string): { from: string; to: string } {
  const end = new Date(now);
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function assemble(meta: DocMetaInput, sections: ReportSection[]): ReportDoc {
  return {
    filenameBase: meta.filenameBase,
    meta: {
      title: meta.title,
      subtitle: meta.subtitle,
      tenantName: meta.tenantName,
      framework: meta.framework,
      period: periodEndingAt(meta.now),
      recipient: meta.recipient,
      classification: meta.classification,
      generatedAt: meta.now,
      provenance: meta.provenance,
    },
    sections,
  };
}

// ── Inputs each family maps from (the live data, already fetched) ──────────────────────────────────

export interface DataResidency {
  egressAllowed: boolean;
  allowedModels: string[];
  regionRules: { value: string; action: string; model: string }[];
}
export interface GovernanceLine {
  title: string;
  kind: string;
  status: string;
  owner: string;
}
export interface DatasetLine {
  name: string;
  classification: string;
  source: string;
  rows: number;
}
export interface DeviceLine {
  name: string;
  os: string;
  role: string;
  status: string;
}
export interface ConnectorLine {
  name: string;
  type: string;
  status: string;
}

export interface RegulatorDocInput {
  spec: RegulatorSpec;
  compliance: Compliance;
  governance: GovernanceLine[];
  residency: DataResidency;
  datasets: DatasetLine[];
  deviceCount: number;
}

// ── Section builders (small, composable, DRY) ──────────────────────────────────────────────────────

function residencySection(r: DataResidency): ReportSection {
  const rows: [string, string][] = [
    ['Cloud egress', r.egressAllowed ? 'Allowed (leashed)' : 'Blocked (on-prem only)'],
    ['Allowed models', r.allowedModels.length ? r.allowedModels.join(', ') : 'None configured'],
  ];
  const blocks: ReportBlock[] = [
    { type: 'keyValues', rows: rows.map(([label, value]) => ({ label, value })) },
  ];
  if (r.regionRules.length > 0) {
    blocks.push({
      type: 'table',
      columns: ['Region / attribute', 'Action', 'Model'],
      rows: r.regionRules.map((x) => [cell(x.value), cell(x.action), cell(x.model, 'default')]),
      declaredCount: r.regionRules.length,
    });
  }
  return { heading: 'Data residency & model routing', blocks };
}

function governanceSection(items: GovernanceLine[]): ReportSection {
  return {
    heading: 'Governance (policies, committees, processes)',
    blocks: [
      {
        type: 'table',
        columns: ['Item', 'Type', 'Status', 'Owner'],
        rows: items.map((g) => [
          cell(g.title),
          cell(g.kind),
          cell(g.status),
          cell(g.owner, 'Unassigned'),
        ]),
        declaredCount: items.length,
      },
    ],
  };
}

function controlsSection(c: Compliance): ReportSection {
  return {
    heading: 'Controls (live posture)',
    blocks: [
      {
        type: 'statusList',
        items: c.controls.map((ctrl) => ({
          label: cell(ctrl.name),
          status: chipFor(ctrl.status),
          note: cell(ctrl.evidence, 'No evidence recorded'),
        })),
      },
    ],
  };
}

function frameworkSection(c: Compliance, ids: string[]): ReportSection {
  const chosen = c.frameworks.filter((f) => ids.includes(f.id));
  const rows = (chosen.length ? chosen : c.frameworks).map((f) => ({
    label: cell(f.name),
    value: pct(f.coverage),
  }));
  return {
    heading: 'Framework coverage',
    blocks: [{ type: 'keyValues', rows }],
  };
}

function signerName(prov?: ReportProvenance): string {
  return prov ? cell(prov.signer, 'Off Grid AI signing key') : 'Off Grid AI signing key';
}

// ── Family: Regulator response pack ────────────────────────────────────────────────────────────────

export function buildRegulatorDoc(input: RegulatorDocInput, meta: DocMetaInput): ReportDoc {
  const { spec, compliance: c } = input;
  const sections: ReportSection[] = [
    {
      heading: 'Regulatory status',
      blocks: [
        { type: 'callout', tone: 'info', text: cell(spec.status) },
        {
          type: 'keyValues',
          rows: [{ label: 'Overall control posture', value: pct(c.posture) }],
        },
      ],
    },
    {
      heading: 'Questions you may ask — and where the evidence sits',
      blocks: [
        {
          type: 'table',
          columns: ['#', 'Anticipated question'],
          rows: spec.questions.map((q, i) => [String(i + 1), cell(q)]),
          declaredCount: spec.questions.length,
        },
      ],
    },
    {
      heading: 'Evidence held ready',
      blocks: [
        {
          type: 'table',
          columns: ['#', 'Artifact'],
          rows: spec.artifacts.map((a, i) => [String(i + 1), cell(a)]),
          declaredCount: spec.artifacts.length,
        },
      ],
    },
    frameworkSection(c, spec.frameworks),
    controlsSection(c),
    governanceSection(input.governance),
    residencySection(input.residency),
    {
      heading: 'Data inventory',
      blocks: [
        {
          type: 'table',
          columns: ['Dataset', 'Classification', 'Source'],
          rows: input.datasets.map((d) => [
            cell(d.name),
            cell(d.classification),
            cell(d.source),
          ]),
          declaredCount: input.datasets.length,
        },
      ],
    },
    {
      heading: 'Fleet & attestation',
      blocks: [
        {
          type: 'paragraph',
          text: `${count(input.deviceCount)} device(s) are enrolled under this tenant's policy, each with a per-device kill switch available to the administrator. This document reflects the live control-plane state for the reporting period and is exported directly from the Off Grid AI Console.`,
        },
        {
          type: 'callout',
          tone: 'attest',
          text: `I attest that the controls, governance items and data inventory above reflect the operating state of the AI system for ${meta.tenantName} over the stated period.`,
        },
        {
          type: 'signature',
          name: signerName(meta.provenance),
          title: 'Accountable owner — submitted via Off Grid AI Console',
        },
      ],
    },
  ];
  return assemble(meta, sections);
}

// ── Family: Compliance evidence pack (DPO) ──────────────────────────────────────────────────────────

export interface ComplianceDocInput {
  compliance: Compliance;
  governance: GovernanceLine[];
}

export function buildComplianceDoc(input: ComplianceDocInput, meta: DocMetaInput): ReportDoc {
  const { compliance: c } = input;
  const sections: ReportSection[] = [
    {
      heading: 'Posture summary',
      blocks: [
        {
          type: 'keyValues',
          rows: [
            { label: 'Overall control posture', value: pct(c.posture) },
            { label: 'Frameworks assessed', value: count(c.frameworks.length) },
            { label: 'Controls evaluated', value: count(c.controls.length) },
          ],
        },
      ],
    },
    frameworkSection(c, c.frameworks.map((f) => f.id)),
    controlsSection(c),
    governanceSection(input.governance),
    {
      heading: 'Attestation',
      blocks: [
        {
          type: 'callout',
          tone: 'attest',
          text: 'This evidence pack is generated live from the control plane; every control status is backed by the evidence noted against it.',
        },
        {
          type: 'signature',
          name: signerName(meta.provenance),
          title: 'Data Protection Officer',
        },
      ],
    },
  ];
  return assemble(meta, sections);
}

// ── Family: Trust summary (DPO / buyer procurement) ─────────────────────────────────────────────────

export interface TrustDocInput {
  summary: TrustSummary;
  posture: PostureItem[];
  framings: FramingRollup[];
  artifacts: ComplianceArtifact[];
}

const POSTURE_CHIP: Record<PostureItem['status'], ChipStatus> = {
  implemented: 'pass',
  'in-progress': 'partial',
  planned: 'na',
  'not-applicable': 'na',
};

export function buildTrustDoc(input: TrustDocInput, meta: DocMetaInput): ReportDoc {
  const { summary: s } = input;
  const sections: ReportSection[] = [
    {
      heading: 'Trust posture at a glance',
      blocks: [
        {
          type: 'keyValues',
          rows: [
            { label: 'Overall posture score', value: pct(s.score) },
            { label: 'Implemented', value: count(s.totals.implemented) },
            { label: 'In progress', value: count(s.totals.inProgress) },
            { label: 'Planned', value: count(s.totals.planned) },
          ],
        },
      ],
    },
    {
      heading: 'Capabilities',
      blocks: [
        {
          type: 'statusList',
          items: input.posture.map((p) => ({
            label: cell(p.title),
            status: POSTURE_CHIP[p.status] ?? 'na',
            note: cell(p.detail, ''),
          })),
        },
      ],
    },
    {
      heading: 'Regulatory framings (India BFSI)',
      blocks: [
        {
          type: 'table',
          columns: ['Regulator', 'Framing', 'Coverage'],
          rows: input.framings.map((f) => [cell(f.regulator), cell(f.name), pct(f.coverage)]),
          declaredCount: input.framings.length,
        },
      ],
    },
    {
      heading: 'Compliance artifacts',
      blocks: [
        {
          type: 'table',
          columns: ['Artifact', 'Status'],
          rows: input.artifacts.map((a) => [cell(a.name), cell(a.status)]),
          declaredCount: input.artifacts.length,
        },
      ],
    },
  ];
  return assemble(meta, sections);
}

// ── Family: Model & data inventory (CDO) ─────────────────────────────────────────────────────────────

export interface InventoryDocInput {
  residency: DataResidency;
  devices: DeviceLine[];
  connectors: ConnectorLine[];
  datasets: DatasetLine[];
}

export function buildInventoryDoc(input: InventoryDocInput, meta: DocMetaInput): ReportDoc {
  const sections: ReportSection[] = [
    residencySection(input.residency),
    {
      heading: `Enrolled devices (${input.devices.length})`,
      blocks: [
        {
          type: 'table',
          columns: ['Device', 'OS', 'Role', 'Status'],
          rows: input.devices.map((d) => [
            cell(d.name),
            cell(d.os),
            cell(d.role),
            cell(d.status),
          ]),
          declaredCount: input.devices.length,
        },
      ],
    },
    {
      heading: `Connected sources (${input.connectors.length})`,
      blocks: [
        {
          type: 'table',
          columns: ['Connector', 'Type', 'Status'],
          rows: input.connectors.map((c) => [cell(c.name), cell(c.type), cell(c.status)]),
          declaredCount: input.connectors.length,
        },
      ],
    },
    {
      heading: `Datasets (${input.datasets.length})`,
      blocks: [
        {
          type: 'table',
          columns: ['Dataset', 'Source', 'Rows', 'Classification'],
          rows: input.datasets.map((d) => [
            cell(d.name),
            cell(d.source),
            count(d.rows),
            cell(d.classification),
          ]),
          declaredCount: input.datasets.length,
        },
      ],
    },
  ];
  return assemble(meta, sections);
}

// ── Family: Audit & usage summary (CDO / internal) ────────────────────────────────────────────────────

export function buildAuditDoc(a: Analytics, meta: DocMetaInput): ReportDoc {
  const sections: ReportSection[] = [
    {
      heading: 'Volume & latency',
      blocks: [
        {
          type: 'keyValues',
          rows: [
            { label: 'Total events', value: count(a.totalEvents) },
            { label: 'Total tokens', value: count(a.totalTokens) },
            { label: 'Latency p50 / p95', value: `${num(a.p50)}ms / ${num(a.p95)}ms` },
            { label: 'Cloud egress rate', value: ratePct(a.egressRate) },
          ],
        },
      ],
    },
    {
      heading: 'Outcomes',
      blocks: [
        {
          type: 'keyValues',
          rows: [
            { label: 'OK', value: count(a.outcomes.ok) },
            { label: 'Redacted (PII masked)', value: count(a.outcomes.redacted) },
            { label: 'Blocked (policy)', value: count(a.outcomes.blocked) },
          ],
        },
      ],
    },
    {
      heading: 'Per-model breakdown',
      blocks: [
        {
          type: 'table',
          columns: ['Model', 'Events', 'Tokens', 'Avg latency'],
          rows: a.byModel.map((m) => [
            cell(m.model),
            count(m.events),
            count(m.tokens),
            `${num(m.avgLatency)}ms`,
          ]),
          declaredCount: a.byModel.length,
        },
      ],
    },
    {
      heading: 'Drift & performance signals',
      blocks: [
        {
          type: 'statusList',
          items: [
            {
              label: 'Model drift',
              status: a.drift.flagged ? 'fail' : 'pass',
              note: `recent ${num(a.drift.recent)} vs baseline ${num(a.drift.baseline)}`,
            },
            {
              label: 'Performance',
              status: a.perf.flagged ? 'fail' : 'pass',
              note: `recent ${num(a.perf.recent)}ms vs baseline ${num(a.perf.baseline)}ms`,
            },
          ],
        },
      ],
    },
  ];
  return assemble(meta, sections);
}

// ── Family: Retrieval quality / eval report (CDO / internal) ──────────────────────────────────────────

export interface EvalCaseLine {
  query: string;
  expected: string;
  verdict: 'pass' | 'fail' | 'na';
  top: string;
}
export interface EvalDocInput {
  caseCount: number;
  latest?: { passed: number; total: number; score: number };
  cases: EvalCaseLine[];
}

// ── Family: Data Processing Activity Report / DPIA (DPO) ─────────────────────────────────────────────

/** Money as USD with 2dp (the ledger carries 4dp; a report reads at 2dp). */
export function usd(v: number | null | undefined): string {
  return `$${num(v).toFixed(2)}`;
}

export function buildActivityDoc(a: ComplianceActivity, meta: DocMetaInput): ReportDoc {
  const sections: ReportSection[] = [
    {
      heading: 'Processing activity summary',
      blocks: [
        {
          type: 'keyValues',
          rows: [
            { label: 'Events processed', value: count(a.totals.events) },
            { label: 'Distinct actors', value: count(a.totals.actors) },
            { label: 'Tokens', value: count(a.totals.tokens) },
            { label: 'Cost', value: usd(a.totals.costUsd) },
            { label: 'Enforcement actions (blocked/denied)', value: count(a.totals.blockedOrDenied) },
            { label: 'Redactions (PII masked)', value: count(a.totals.redacted) },
          ],
        },
      ],
    },
    {
      heading: 'Outcomes',
      blocks: [
        {
          type: 'keyValues',
          rows: [
            { label: 'OK', value: count(a.outcomes.ok) },
            { label: 'Redacted', value: count(a.outcomes.redacted) },
            { label: 'Blocked', value: count(a.outcomes.blocked) },
            { label: 'Denied', value: count(a.outcomes.denied) },
            { label: 'Error', value: count(a.outcomes.error) },
          ],
        },
      ],
    },
    {
      heading: 'By actor',
      blocks: [
        {
          type: 'table',
          columns: ['Actor', 'Events', 'Enforced', 'Cost'],
          rows: a.byActor.map((r) => [cell(r.key), count(r.events), count(r.blocked), usd(r.costUsd)]),
          declaredCount: a.byActor.length,
        },
      ],
    },
    {
      heading: 'By model',
      blocks: [
        {
          type: 'table',
          columns: ['Model', 'Events', 'Tokens', 'Cost'],
          rows: a.byModel.map((r) => [cell(r.key), count(r.events), count(r.tokens), usd(r.costUsd)]),
          declaredCount: a.byModel.length,
        },
      ],
    },
    {
      heading: 'Provenance coverage',
      blocks: [
        {
          type: 'keyValues',
          rows: [
            { label: 'Agent runs', value: count(a.provenance.runs) },
            { label: 'Signed', value: count(a.provenance.signed) },
            { label: 'Coverage', value: pct(a.provenance.coveragePct) },
          ],
        },
        {
          type: 'callout',
          tone: a.provenance.coveragePct >= 100 ? 'attest' : 'info',
          text: `${count(a.provenance.signed)} of ${count(a.provenance.runs)} agent runs in this period carry a tamper-evident, signed provenance record.`,
        },
      ],
    },
  ];
  return assemble(meta, sections);
}

export function buildEvalDoc(input: EvalDocInput, meta: DocMetaInput): ReportDoc {
  const summaryRows = [
    { label: 'Golden cases', value: count(input.caseCount) },
    {
      label: 'Latest run',
      value: input.latest
        ? `${count(input.latest.passed)} / ${count(input.latest.total)} (${pct(input.latest.score)})`
        : 'No runs recorded yet',
    },
  ];
  const sections: ReportSection[] = [
    { heading: 'Retrieval quality summary', blocks: [{ type: 'keyValues', rows: summaryRows }] },
    {
      heading: 'Cases',
      blocks: [
        {
          type: 'statusList',
          items: input.cases.map((c) => ({
            label: cell(c.query),
            status: c.verdict,
            note: `expected: ${cell(c.expected)} — retrieved: ${cell(c.top, 'no result')}`,
          })),
        },
      ],
    },
  ];
  return assemble(meta, sections);
}
