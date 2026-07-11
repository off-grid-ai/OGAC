// PURE regulator/report SPEC data — the catalog of report families (REPORTS) and the per-regulator
// question/artifact packs (REGULATORS). ZERO imports so it can be consumed by the pure ReportDoc
// mappers (reports/build-doc.ts) without pulling in the DB. reports.ts re-exports these for the
// existing markdown/CRUD paths, so there is ONE source of truth for the spec (DRY).

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
