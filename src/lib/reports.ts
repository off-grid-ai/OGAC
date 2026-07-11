import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { computeAnalytics } from '@/lib/analytics';
import { type Compliance, buildExport, computeCompliance } from '@/lib/compliance';
import { listEvalRuns, listGoldenCases } from '@/lib/evals';
import {
  type NormalizedTemplate,
  type ReportSection,
  slugifyTemplateName,
} from '@/lib/reports-template';
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

// Regulator response packs grounded in current (mid-2026) Indian guidance. `status` honestly
// flags binding vs advisory/draft, because most AI-specific instruments are NOT yet binding —
// enforceable obligations map to in-force generic directions (IT/cyber/outsourcing/localization)
// + the final DPDP Rules 2025 + CERT-In. `artifacts` = the evidence a compliance team keeps ready.
export interface RegulatorSpec {
  name: string;
  status: string;
  frameworks: string[];
  questions: string[];
  artifacts: string[];
}

export const REGULATORS: Record<string, RegulatorSpec> = {
  irdai: {
    name: 'IRDAI — insurers',
    status:
      'No standalone IRDAI AI rule exists. AI is governed indirectly via the IN-FORCE Information & Cyber Security Guidelines 2023, Policyholder Protection Regs 2024, Bima Bharosa grievance, Sandbox Regs 2025, and DPDP. "Explainable AI" is best practice, not a current IRDAI mandate.',
    frameworks: ['dpdp', 'iso-42001', 'hipaa'],
    questions: [
      'What data trains/feeds the model and the lawful basis/consent (DPDP) per category — esp. health/telematics/wearables?',
      'Bias / disparate-impact testing across protected + proxy variables in underwriting / pricing / claims — how often?',
      'For an adverse automated decision (decline / loading / claim rejection): a human-understandable explanation + audit trail?',
      'Where is the human in the loop before the policyholder is bound?',
      'How does an AI decision surface in the Bima Bharosa grievance flow, and within what TAT is it reviewed / reversed?',
      'Cyber/data controls on the model (encryption, access, VAPT) + incident reporting (CERT-In 6h / IRDAI 24h)?',
    ],
    artifacts: [
      'Model inventory + model cards (data lineage, features used/excluded)',
      'Bias/fairness reports + explainability + decision audit logs',
      'Human-oversight policy + sign-off matrix',
      'DPDP pack (consent, notices, DPIA, retention)',
      'Board-approved ICSP + ISRMC minutes + CISO appointment; TRA/VAPT + localization attestation',
      'Grievance MIS showing AI-complaint resolution times',
    ],
  },
  rbi: {
    name: 'RBI — banks / NBFCs',
    status:
      'AI-specific instruments are NON-BINDING (FREE-AI report Aug 2025; draft Model-Risk-in-Credit Aug 2024). Enforceable obligations come from the IN-FORCE IT Outsourcing MD (2023), Payment Data Localization (2018), and IT Governance/GRCA MD (2024).',
    frameworks: ['dpdp', 'occ-sr-11-7', 'dora', 'iso-42001'],
    questions: [
      'Board-approved AI / model-risk policy over the model lifecycle + named accountable owner — last board review?',
      'Independent pre-deployment validation + ≥annual revalidation, with drift/performance monitoring — show reports.',
      'Bias testing across protected attributes + an explanation for an individual adverse decision (e.g. loan rejection)?',
      'For external/hosted models: vendor due diligence, right-to-audit, and where payment/customer data is stored (India)?',
      'Is the customer told AI was used, with a grievance path that triggers human review / override?',
      'Audit trails for inputs/outputs/changes + incident process incl. RBI reporting within 6 hours?',
    ],
    artifacts: [
      'Board-approved AI/MRM policy + review minutes; model inventory + per-model documentation',
      'Independent validation + drift/performance reports',
      'Bias tests + sample adverse-action explanations',
      'Vendor due-diligence + right-to-audit + concentration assessment',
      'Payment-data residency map + CERT-In System Audit Report',
      'Incident runbook with the 6-hour RBI step; consumer disclosure + human-override workflow',
    ],
  },
  sebi: {
    name: 'SEBI — market participants',
    status:
      'IN FORCE: the 2019 AI/ML quarterly reporting circulars (file within 15 days of quarter-end). DRAFT: Responsible AI/ML Guidelines (Jun 2025 consultation) — not yet binding, but signals ≥5-yr input/output retention, accountability, and explainability.',
    frameworks: ['iso-42001', 'occ-sr-11-7', 'eu-ai-act'],
    questions: [
      'What is the system used for (advice / algo execution / surveillance / KYC), is it investor-facing, in-house/vendor/joint?',
      'Named senior accountable person + where the human-in-the-loop sits?',
      'Pre-deployment testing (segregated env, stressed/unstressed, shadow) + production monitoring?',
      'Bias detection/removal + outputs explainable, traceable, repeatable?',
      'Client disclosures (risks, model accuracy, fees) + AI grievance handling?',
      'Vendor risk (agreements, fallback, concentration) + data/cyber/breach controls?',
    ],
    artifacts: [
      'Quarterly AI/ML reporting forms (Annexure A) + filing receipts',
      'AI inventory (use-case, investor-facing flag, build model)',
      'Model documentation + explainability + accuracy; testing evidence (segregated/stressed/shadow)',
      'Governance: named owner, human-review workflow, committee minutes',
      'Vendor file (contracts, fallback/BCP, concentration analysis)',
      'Model input/output data retained ≥5 years; client disclosures + grievance records',
    ],
  },
  dpdp: {
    name: 'DPDP Act 2023 / DPDP Rules 2025 (MeitY)',
    status:
      'FINAL — Rules notified 14 Nov 2025, phased. Core duties (notice/consent, rights, breach, retention) + Significant-Data-Fiduciary obligations (DPO, annual DPIA + independent audit, algorithmic-fairness verification) land by ~13 May 2027. Country lists / SDF designations pending notification.',
    frameworks: ['dpdp', 'gdpr', 'hipaa'],
    questions: [
      'Lawful basis/consent per personal-data category used in training/fine-tuning/inference — notice + affirmative consent, no repurposing?',
      'Why each field is necessary + how you correct/erase a principal’s data, including data embedded in trained models / vector stores?',
      'SDF: what verifies the algorithm does not endanger principals’ rights (bias testing, model cards, human review)?',
      'How do erasure + default retention propagate across training sets / embeddings / caches / backups?',
      'On a data leak (memorization / prompt-injection / vector exfiltration): immediate principal notice + 72-hour Board report?',
      'Where is processing hosted, any restricted-jurisdiction transfer, do processor / LLM-API contracts flow down the Rule-6 safeguards?',
    ],
    artifacts: [
      'RoPA / data map for the AI system; consent + multi-language notices + withdrawal evidence',
      'DPIA + independent data audit (SDF, annual); algorithmic fairness/transparency assessment',
      'Rule-6 security evidence (encryption, access, ≥1-yr logs, IR plan, processor DPAs)',
      'Retention/erasure SOP + proof of deletion across embeddings/backups',
      'Breach playbook (Board + principal templates, 72h); DPO + grievance officer + cross-border register',
    ],
  },
  'cert-in': {
    name: 'CERT-In (2022 Directions)',
    status:
      'IN FORCE since Jun 2022 under IT Act s.70B. Annexure-I explicitly lists AI/ML-system incidents.',
    frameworks: ['iso-42001', 'dora'],
    questions: [
      'Are all clocks synced to NIC / NPL NTP — config + drift monitoring?',
      'Are logs retained ≥180 rolling days, stored within India — location + policy?',
      'Can you file with CERT-In within 6 hours of awareness (not confirmation)?',
      'Who is your 24x7 registered point of contact + escalation procedure?',
      'For an AI/ML system: how is a model/pipeline compromise detected, classified against Annexure I, and reported?',
      'Can you reconstruct the timeline of a past incident on demand?',
    ],
    artifacts: [
      'NTP config evidence + drift monitoring',
      'Log-retention policy + proof of 180-day India-resident storage',
      'IR runbook with the 6-hour CERT-In step + incident register',
      'Designated 24x7 PoC + CERT-In registration ack',
      'Incident → Annexure-I mapping incl. the AI/ML category',
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
  const residency = [
    `- Cloud egress: ${policy.egressAllowed ? 'allowed (leashed)' : 'blocked'}`,
    `- Allowed models: ${policy.allowedModels.join(', ') || 'none'}`,
    ...routes
      .filter((x) => x.attribute === 'region')
      .map((r) => `- Region rule: ${r.value} → ${r.action} (${r.model || 'default'})`),
  ];
  const body = [
    `# Regulator Response Pack — ${spec.name}`,
    `Generated: ${c.generatedAt}`,
    `Overall control posture: ${c.posture}%`,
    '',
    '## Regulatory status',
    `> ${spec.status}`,
    '',
    '## Questions you may ask — and where the evidence is',
    ...spec.questions.map((q) => `- ${q}`),
    '',
    '## Evidence to have ready',
    ...spec.artifacts.map((a) => `- ${a}`),
    '',
    '## Framework coverage',
    ...frameworkLines(c, spec.frameworks),
    '',
    '## Controls (live)',
    ...c.controls.map(
      (ctrl) => `- **${ctrl.name}** — ${ctrl.status.toUpperCase()} — ${ctrl.evidence}`,
    ),
    '',
    '## Governance (policies, committees, processes)',
    ...governanceLines(governance),
    '',
    '## Data residency & model routing',
    ...residency,
    '',
    '## Data inventory',
    ...datasets.map((d) => `- ${d.name} — ${d.classification} (${d.source})`),
    '',
    `## Fleet: ${devices.length} enrolled devices (kill switch available per device).`,
  ];
  return { filename: `offgrid-regulator-${id}.md`, body: body.join('\n') };
}

function h(lines: string[], title: string): void {
  lines.push(`# ${title}`);
}

async function auditSummary(): Promise<string> {
  const a = await computeAnalytics();
  const l: string[] = [];
  h(l, 'Off Grid AI — Audit & Usage Summary');
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

async function evalReport(orgId?: string): Promise<string> {
  // Latest run is org-scoped (undefined → DEFAULT_ORG in the store) so a tenant's quality report
  // reflects only its own eval history.
  const [cases, runs] = await Promise.all([listGoldenCases(), listEvalRuns(1, orgId)]);
  const latest = runs[0];
  const l: string[] = [];
  h(l, 'Off Grid AI — Retrieval Quality Report');
  l.push(`- Golden cases: ${cases.length}`);
  l.push(
    latest ? `- Latest run: ${latest.passed}/${latest.total} (${latest.score}%)` : '- No runs yet',
  );
  l.push('', '## Cases');
  for (const c of cases) {
    const r = latest?.results?.find((x) => x.query === c.query);
    let verdict = '—';
    if (r) verdict = r.pass ? `PASS · ${r.top}` : `FAIL · ${r.top}`;
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
  h(l, 'Off Grid AI — Model & Data Inventory');
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
  orgId?: string,
): Promise<{ filename: string; body: string } | null> {
  if (id === 'compliance') return buildExport();
  if (id === 'audit-summary')
    return { filename: 'offgrid-audit-summary.md', body: await auditSummary() };
  if (id === 'eval-report')
    return { filename: 'offgrid-eval-report.md', body: await evalReport(orgId) };
  if (id === 'inventory') return { filename: 'offgrid-inventory.md', body: await inventory() };
  if (id in REGULATORS) return regulatorPack(id);
  // Fall through to operator-authored custom templates stored in the DB.
  const custom = await getReportTemplate(id);
  if (custom?.kind === 'custom') return generateCustomReport(custom);
  return null;
}

// ── Report templates: console-owned CRUD ──────────────────────────────────────────────────────
// Operators manage report templates from the console. The table is created idempotently on first
// use (mirrors ensureFileSchema / the chat module's ensure pattern) so the module deploys over SSH
// with no migration step. The nine hardcoded REPORTS are seeded as `builtin` rows on first ensure
// so they show up in the same managed list; `custom` rows are fully operator-authored and are
// rendered by composing the same live section renderers used above.

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  source: string;
  kind: 'builtin' | 'custom';
  sections: ReportSection[];
  frameworks: string[];
  schedule: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  source: string;
  kind: string;
  sections: unknown;
  frameworks: unknown;
  schedule: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function rowToTemplate(r: TemplateRow): ReportTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    source: r.source,
    kind: r.kind === 'custom' ? 'custom' : 'builtin',
    sections: (Array.isArray(r.sections) ? r.sections : []) as ReportSection[],
    frameworks: Array.isArray(r.frameworks) ? (r.frameworks as string[]) : [],
    schedule: r.schedule || 'none',
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

let ensurePromise: Promise<void> | null = null;
export async function ensureReportSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS report_templates (
        id text PRIMARY KEY,
        name text NOT NULL DEFAULT 'Untitled report',
        description text NOT NULL DEFAULT '',
        source text NOT NULL DEFAULT 'Regulatory plane',
        kind text NOT NULL DEFAULT 'custom',
        sections jsonb NOT NULL DEFAULT '[]',
        frameworks jsonb NOT NULL DEFAULT '[]',
        schedule text NOT NULL DEFAULT 'none',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    // Seed the built-in catalog on first ensure so it's part of the same managed list. ON CONFLICT
    // DO NOTHING keeps operator edits to the description/etc. intact across restarts.
    for (const r of REPORTS) {
      await db.execute(sql`
        INSERT INTO report_templates (id, name, description, source, kind)
        VALUES (${r.id}, ${r.name}, ${r.description}, ${r.source}, 'builtin')
        ON CONFLICT (id) DO NOTHING;
      `);
    }
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

const REPORT_TABLE = sql.identifier('report_templates');

export async function listReportTemplates(): Promise<ReportTemplate[]> {
  await ensureReportSchema();
  const res = await db.execute(
    sql`SELECT * FROM ${REPORT_TABLE} ORDER BY kind ASC, name ASC`,
  );
  return (res.rows as unknown as TemplateRow[]).map(rowToTemplate);
}

export async function getReportTemplate(id: string): Promise<ReportTemplate | null> {
  await ensureReportSchema();
  const res = await db.execute(sql`SELECT * FROM ${REPORT_TABLE} WHERE id = ${id} LIMIT 1`);
  const row = (res.rows as unknown as TemplateRow[])[0];
  return row ? rowToTemplate(row) : null;
}

// Create a custom template. Returns the new id (a name-derived slug, deduped with a short suffix).
export async function createReportTemplate(t: NormalizedTemplate): Promise<string> {
  await ensureReportSchema();
  const slug = slugifyTemplateName(t.name);
  const exists = await getReportTemplate(slug);
  const id = exists ? `${slug}-${crypto.randomUUID().slice(0, 6)}` : slug;
  await db.execute(sql`
    INSERT INTO ${REPORT_TABLE} (id, name, description, source, kind, sections, frameworks, schedule)
    VALUES (${id}, ${t.name}, ${t.description}, ${t.source}, 'custom',
            ${JSON.stringify(t.sections)}::jsonb, ${JSON.stringify(t.frameworks)}::jsonb, ${t.schedule});
  `);
  return id;
}

// Patch a template. Built-in rows accept description/source/schedule edits only — their generation
// (sections) is code-defined, so name/sections changes to them are ignored.
export async function updateReportTemplate(
  id: string,
  patch: Partial<NormalizedTemplate>,
): Promise<ReportTemplate | null> {
  const existing = await getReportTemplate(id);
  if (!existing) return null;
  const isCustom = existing.kind === 'custom';
  const next = {
    name: isCustom && patch.name !== undefined ? patch.name : existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    source: patch.source !== undefined ? patch.source : existing.source,
    sections: isCustom && patch.sections !== undefined ? patch.sections : existing.sections,
    frameworks: patch.frameworks !== undefined ? patch.frameworks : existing.frameworks,
    schedule: patch.schedule !== undefined ? patch.schedule : existing.schedule,
  };
  await db.execute(sql`
    UPDATE ${REPORT_TABLE} SET
      name = ${next.name}, description = ${next.description}, source = ${next.source},
      sections = ${JSON.stringify(next.sections)}::jsonb,
      frameworks = ${JSON.stringify(next.frameworks)}::jsonb,
      schedule = ${next.schedule}, updated_at = now()
    WHERE id = ${id};
  `);
  return getReportTemplate(id);
}

// Delete a template. Built-in rows are protected (returns false) so the catalog can't be gutted.
export async function deleteReportTemplate(id: string): Promise<boolean> {
  const existing = await getReportTemplate(id);
  if (!existing || existing.kind === 'builtin') return false;
  await db.execute(sql`DELETE FROM ${REPORT_TABLE} WHERE id = ${id}`);
  return true;
}

// ── Custom report generation ──────────────────────────────────────────────────────────────────
// Compose a Markdown report from the operator-selected sections, each rendered from live data via
// the same engines the built-in reports use — so a custom report can't drift from the dashboards.
async function sectionBody(section: ReportSection, frameworks: string[]): Promise<string[]> {
  switch (section) {
    case 'compliance': {
      const c = await computeCompliance();
      return [`## Compliance posture`, `Overall control posture: ${c.posture}%`, ''];
    }
    case 'frameworks': {
      const c = await computeCompliance();
      const ids = frameworks.length ? frameworks : c.frameworks.map((f) => f.id);
      return ['## Framework coverage', ...frameworkLines(c, ids), ''];
    }
    case 'controls': {
      const c = await computeCompliance();
      return [
        '## Controls (live)',
        ...c.controls.map((ctrl) => `- **${ctrl.name}** — ${ctrl.status.toUpperCase()} — ${ctrl.evidence}`),
        '',
      ];
    }
    case 'governance': {
      return ['## Governance', ...governanceLines(await listGovernance()), ''];
    }
    case 'audit':
      return ['## Audit & usage', await auditSummary(), ''];
    case 'inventory':
      return ['## Model & data inventory', await inventory(), ''];
    case 'evals':
      return ['## Retrieval quality', await evalReport(), ''];
    case 'residency': {
      const [policy, routes] = await Promise.all([getOrgPolicy(), listRoutingRules()]);
      return [
        '## Data residency & model routing',
        `- Cloud egress: ${policy.egressAllowed ? 'allowed (leashed)' : 'blocked'}`,
        `- Allowed models: ${policy.allowedModels.join(', ') || 'none'}`,
        ...routes
          .filter((x) => x.attribute === 'region')
          .map((r) => `- Region rule: ${r.value} → ${r.action} (${r.model || 'default'})`),
        '',
      ];
    }
    default:
      return [];
  }
}

export async function generateCustomReport(
  t: ReportTemplate,
): Promise<{ filename: string; body: string }> {
  const lines: string[] = [`# ${t.name}`, `Generated: ${new Date().toISOString()}`];
  if (t.description) lines.push('', `> ${t.description}`);
  lines.push('');
  for (const section of t.sections) {
    lines.push(...(await sectionBody(section, t.frameworks)));
  }
  return { filename: `offgrid-${t.id}.md`, body: lines.join('\n') };
}
