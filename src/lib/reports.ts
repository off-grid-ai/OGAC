import { computeAnalytics } from '@/lib/analytics';
import { type Compliance, buildExport, computeCompliance } from '@/lib/compliance';
import { listEvalRuns, listGoldenCases } from '@/lib/evals';
import {
  type GovernanceItem,
  getOrgPolicy,
  listConnectors,
  listDatasets,
  listDevices,
  listGovernance,
  listRoutingRules,
} from '@/lib/store';

// Regulator-ready reports. Each is generated live from the control plane — citation-backed,
// traceable end to end — and exported as Markdown. Reuses the compliance/analytics/eval
// engines rather than recomputing, so a report can never drift from the dashboards.
export interface ReportDef {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const REPORTS: ReportDef[] = [
  {
    id: 'compliance',
    name: 'Compliance evidence pack',
    description:
      'Posture, per-framework coverage (DPDP / EU AI Act / ISO 42001 / GDPR), every control + evidence.',
    source: 'Regulatory plane',
  },
  {
    id: 'audit-summary',
    name: 'Audit & usage summary',
    description:
      'Volume, latency (p50/p95), outcomes, egress rate, per-model breakdown, drift/perf signals.',
    source: 'Analytics · audit store',
  },
  {
    id: 'eval-report',
    name: 'Retrieval quality (evals)',
    description: 'Latest golden-set run: recall score and per-case pass/fail against the Brain.',
    source: 'Brain · golden set',
  },
  {
    id: 'inventory',
    name: 'Model & data inventory',
    description:
      'Allowed models, enrolled devices, connected sources, and dataset classifications.',
    source: 'Control & data planes',
  },
  {
    id: 'irdai',
    name: 'IRDAI response pack',
    description:
      'Insurance regulator: AI in underwriting/claims, policyholder data, explainability.',
    source: 'Regulator pack',
  },
  {
    id: 'rbi',
    name: 'RBI response pack',
    description: 'Banking regulator: model risk, data localization, outsourcing, audit trail.',
    source: 'Regulator pack',
  },
  {
    id: 'sebi',
    name: 'SEBI response pack',
    description:
      'Securities regulator: AI/ML governance, accountability, audit, investor protection.',
    source: 'Regulator pack',
  },
  {
    id: 'dpdp',
    name: 'DPDP / MeitY response pack',
    description: 'Data protection: data-principal rights, localization, masking, breach response.',
    source: 'Regulator pack',
  },
  {
    id: 'cert-in',
    name: 'CERT-In response pack',
    description: 'Incident reporting: audit retention, logs, traceability, kill switch.',
    source: 'Regulator pack',
  },
];

// What each regulator typically asks — mapped to the frameworks + the live evidence we hold.
interface RegulatorSpec {
  name: string;
  frameworks: string[];
  questions: string[];
}

const REGULATORS: Record<string, RegulatorSpec> = {
  irdai: {
    name: 'IRDAI (Insurance Regulatory and Development Authority of India)',
    frameworks: ['dpdp', 'iso-42001', 'eu-ai-act'],
    questions: [
      'Which AI models touch underwriting / claims, and do they run on-device or in the cloud?',
      'How is policyholder (PII/PHI) data masked and prevented from leaving the device?',
      'Are AI decisions explainable and grounded to a cited source?',
      'Is there an algorithmic impact assessment and a human review path?',
    ],
  },
  rbi: {
    name: 'RBI (Reserve Bank of India)',
    frameworks: ['dpdp', 'occ-sr-11-7', 'dora', 'iso-42001'],
    questions: [
      'Model risk governance: inventory, validation, monitoring, and the model-risk framework?',
      'Data localization / residency: is regulated data kept in-country / on-device?',
      'Outsourcing & third-party (vendor) controls for any cloud model?',
      'Is there a complete, tamper-evident audit trail and a kill switch?',
    ],
  },
  sebi: {
    name: 'SEBI (Securities and Exchange Board of India)',
    frameworks: ['iso-42001', 'occ-sr-11-7', 'eu-ai-act'],
    questions: [
      'AI/ML governance, accountability (RACI), and the review board?',
      'Audit trail of every model decision and who is accountable?',
      'Investor-protection controls: guardrails, grounding, and disclosure?',
    ],
  },
  dpdp: {
    name: 'DPDP Act 2023 / MeitY',
    frameworks: ['dpdp', 'gdpr', 'hipaa'],
    questions: [
      'Data-principal rights: access, correction, and erasure (DSAR)?',
      'PII masking / tokenization at ingest, and data localization?',
      'Consent, purpose limitation, and breach-response process?',
    ],
  },
  'cert-in': {
    name: 'CERT-In',
    frameworks: ['iso-42001', 'dora'],
    questions: [
      'Are logs retained and synchronized with traceability (audit + traces)?',
      'Incident detection, tabletop drills, and the response runbook?',
      'Can a compromised node be isolated / killed in seconds?',
    ],
  },
};

function frameworkLines(c: Compliance, ids: string[]): string[] {
  return c.frameworks
    .filter((f) => ids.includes(f.id))
    .map((f) => `- **${f.name}** — ${f.coverage}% coverage`);
}

function governanceLines(items: GovernanceItem[]): string[] {
  if (items.length === 0) return ['- (no governance items recorded)'];
  return items.map((g) => `- **${g.title}** (${g.kind}) — ${g.status}, owner: ${g.owner || '—'}`);
}

async function regulatorPack(id: string): Promise<{ filename: string; body: string }> {
  const spec = REGULATORS[id];
  const [c, governance, policy, datasets, devices, routes] = await Promise.all([
    computeCompliance(),
    listGovernance(),
    getOrgPolicy(),
    listDatasets(),
    listDevices(),
    listRoutingRules(),
  ]);
  const l: string[] = [];
  h(l, `Regulator Response Pack — ${spec.name}`);
  l.push(`Generated: ${c.generatedAt}`, `Overall control posture: ${c.posture}%`, '');
  l.push('## Questions you may ask — and where the evidence is');
  for (const q of spec.questions) l.push(`- ${q}`);
  l.push('', '## Framework coverage', ...frameworkLines(c, spec.frameworks));
  l.push('', '## Controls (live)');
  for (const ctrl of c.controls) {
    l.push(`- **${ctrl.name}** — ${ctrl.status.toUpperCase()} — ${ctrl.evidence}`);
  }
  l.push('', '## Governance (policies, committees, processes)', ...governanceLines(governance));
  l.push('', '## Data residency & model routing');
  l.push(`- Cloud egress: ${policy.egressAllowed ? 'allowed (leashed)' : 'blocked'}`);
  l.push(`- Allowed models: ${policy.allowedModels.join(', ') || 'none'}`);
  for (const r of routes.filter((x) => x.attribute === 'region')) {
    l.push(`- Region rule: ${r.value} → ${r.action} (${r.model || 'default'})`);
  }
  l.push('', '## Data inventory');
  for (const d of datasets) l.push(`- ${d.name} — ${d.classification} (${d.source})`);
  l.push('', `## Fleet: ${devices.length} enrolled devices (kill switch available per device).`);
  return { filename: `offgrid-regulator-${id}.md`, body: l.join('\n') };
}

function h(lines: string[], title: string): void {
  lines.push(`# ${title}`);
}

async function auditSummary(): Promise<string> {
  const a = await computeAnalytics();
  const l: string[] = [];
  h(l, 'Off Grid — Audit & Usage Summary');
  l.push(`- Events: ${a.totalEvents}`, `- Tokens: ${a.totalTokens}`);
  l.push(`- Latency p50/p95: ${a.p50}ms / ${a.p95}ms`, `- Egress rate: ${a.egressRate}%`);
  l.push(
    `- Outcomes — ok: ${a.outcomes.ok}, redacted: ${a.outcomes.redacted}, blocked: ${a.outcomes.blocked}`,
  );
  l.push('', '## Per model');
  for (const m of a.byModel) {
    l.push(`- **${m.model}** — ${m.events} events, ${m.tokens} tokens, ${m.avgLatency}ms avg`);
  }
  l.push('', '## Signals');
  l.push(
    `- Drift: ${a.drift.flagged ? 'FLAGGED' : 'normal'} (recent ${a.drift.recent} vs ${a.drift.baseline})`,
  );
  l.push(
    `- Perf degradation: ${a.perf.flagged ? 'FLAGGED' : 'normal'} (recent ${a.perf.recent}ms vs ${a.perf.baseline}ms)`,
  );
  return l.join('\n');
}

async function evalReport(): Promise<string> {
  const [cases, runs] = await Promise.all([listGoldenCases(), listEvalRuns(1)]);
  const latest = runs[0];
  const l: string[] = [];
  h(l, 'Off Grid — Retrieval Quality Report');
  l.push(`- Golden cases: ${cases.length}`);
  l.push(
    latest ? `- Latest run: ${latest.passed}/${latest.total} (${latest.score}%)` : '- No runs yet',
  );
  l.push('', '## Cases');
  for (const c of cases) {
    const r = latest?.results?.find((x) => x.query === c.query);
    const verdict = r ? (r.pass ? `PASS · ${r.top}` : `FAIL · ${r.top}`) : '—';
    l.push(`- **${c.query}** → expected ${c.expected} — ${verdict}`);
  }
  return l.join('\n');
}

async function inventory(): Promise<string> {
  const [policy, devices, connectors, datasets] = await Promise.all([
    getOrgPolicy(),
    listDevices(),
    listConnectors(),
    listDatasets(),
  ]);
  const l: string[] = [];
  h(l, 'Off Grid — Model & Data Inventory');
  l.push(`- Allowed models: ${policy.allowedModels.join(', ') || 'none'}`);
  l.push(`- Cloud egress: ${policy.egressAllowed ? 'allowed (leashed)' : 'blocked'}`);
  l.push('', `## Devices (${devices.length})`);
  for (const d of devices) l.push(`- ${d.name} — ${d.os}, ${d.role}, ${d.status}`);
  l.push('', `## Connectors (${connectors.length})`);
  for (const c of connectors) l.push(`- ${c.name} — ${c.type}, ${c.status}`);
  l.push('', `## Datasets (${datasets.length})`);
  for (const d of datasets)
    l.push(`- ${d.name} — ${d.source}, ${d.rows} rows, class: ${d.classification}`);
  return l.join('\n');
}

export async function generateReport(
  id: string,
): Promise<{ filename: string; body: string } | null> {
  if (id === 'compliance') return buildExport();
  if (id === 'audit-summary')
    return { filename: 'offgrid-audit-summary.md', body: await auditSummary() };
  if (id === 'eval-report') return { filename: 'offgrid-eval-report.md', body: await evalReport() };
  if (id === 'inventory') return { filename: 'offgrid-inventory.md', body: await inventory() };
  if (id in REGULATORS) return regulatorPack(id);
  return null;
}
