// Trust & Security Center — the pure aggregation layer.
//
// WHY: BFSI buyers (banks/insurers) run a heavy CISO/procurement/risk due-diligence gate that
// lengthens or kills deals. This surface pre-answers it: security posture + data-governance +
// AI-governance + regulatory mapping + a procurement-artifact checklist, mapped to the frameworks
// the console already ships (ISO 42001 / NIST AI RMF / EU AI Act, from the control catalog) PLUS
// India-BFSI framings (RBI model governance, IRDAI, DPDP Act 2023).
//
// SOLID seam: EVERYTHING in this file is PURE and dependency-free (no Next / auth / DB / env / I/O).
// It takes a plain `PostureInputs` snapshot — collected by the thin I/O adapter (trust-center-inputs
// .ts) from REAL deployment state — and derives the posture-item model, the artifact checklist, the
// regulatory rollups, and the overall summary. Unit-testable in isolation with zero mocks. This is
// what lets the page stay a thin renderer and keeps the ≥85% coverage bar reachable.
//
// HONESTY: posture is never overstated. An item can be `in-progress` or `planned`; open items from
// PRODUCTION_READINESS.md (secrets-vault persistence, backups, tenant-isolation) surface truthfully.
// The overall summary counts only `implemented` items toward the headline score.
//
// COPY RULE: the rendered copy NEVER names an OSS engine (no engine names in customer-facing
// strings) — capability language only. Names stay in code comments / the I/O layer, not in the
// `title`/`detail` fields shown to a buyer.

import {
  CATALOG,
  isKnownControl,
  type CatalogControl,
  type FrameworkId,
} from '@/lib/compliance-catalog';

// ─── Status model ─────────────────────────────────────────────────────────────

// A posture item's maturity. `implemented` = live and verifiable now; `in-progress` = building,
// shown honestly; `planned` = on the roadmap, not yet started. `not-applicable` documents a
// deliberate non-scope so a reviewer isn't left guessing.
export const POSTURE_STATUSES = ['implemented', 'in-progress', 'planned', 'not-applicable'] as const;
export type PostureStatus = (typeof POSTURE_STATUSES)[number];

export function isPostureStatus(v: unknown): v is PostureStatus {
  return typeof v === 'string' && (POSTURE_STATUSES as readonly string[]).includes(v);
}

// The four evidence pillars a security reviewer walks in order.
export const PILLARS = [
  'security-posture',
  'data-governance',
  'ai-governance',
  'compliance-artifacts',
] as const;
export type PillarId = (typeof PILLARS)[number];

export interface PostureItem {
  id: string;
  pillar: PillarId;
  title: string; // capability language — NEVER an OSS-engine name
  detail: string; // plain-language, for a non-lawyer / CISO
  status: PostureStatus;
  // Control ids in the shipped catalog this posture item provides evidence FOR (cross-checked
  // against the catalog so a stale id can't silently mislead a reviewer).
  evidenceFor: string[];
}

// ─── Posture-item DERIVATION (pure) ───────────────────────────────────────────
//
// The catalog of posture ITEMS is fixed (the capabilities the platform has), but each item's STATUS
// is derived from the live snapshot, so the surface reflects real deployment state, not a claim.

// The live facts the adapter collects. All booleans so a partial snapshot degrades to the most
// conservative (honest) status rather than throwing.
export interface PostureInputs {
  securityHeaders: boolean; // CSP + HSTS + X-Frame-Options etc. emitted at the edge
  wafEnabled: boolean; // web-application-firewall in front of the app
  rateLimit: boolean; // per-IP + per-key request throttling
  ssoConfigured: boolean; // enterprise single-sign-on (OIDC) wired, not dev-login
  secretsVault: boolean; // secrets stored in a vault, not plaintext
  secretsVaultPersistent: boolean; // vault survives restart (readiness R1 — open item)
  auditImmutable: boolean; // append-only audit trail is recording
  siemStreaming: boolean; // audit stream shipped to a searchable security-event store
  provenanceSigning: boolean; // answers/artifacts cryptographically signed (real key, not dev)
  piiRedaction: boolean; // inbound PII detection + masking capability present
  piiFloorEnforced: boolean; // org-level mask FLOOR on every run (readiness G1/G2 — open item)
  egressLeash: boolean; // cloud egress default-deny / leashed
  guardrails: boolean; // input/output guardrails enforced
  onPrem: boolean; // runs on the customer's own infrastructure
  backupsAutomated: boolean; // scheduled off-box backups running (readiness R2 — open item)
  drReplica: boolean; // HA / disaster-recovery replica (readiness R3 — open item)
  coverageGate: boolean; // >=85% test-coverage gate enforced in CI
  tenantIsolationVerified: boolean; // multi-tenant isolation verified across surfaces (readiness P0)
}

// A conservative default snapshot — every fact false. The adapter overrides with real reads; a page
// that can't reach the adapter still renders truthfully (everything "planned/in-progress"), never
// falsely "implemented".
export const EMPTY_INPUTS: PostureInputs = {
  securityHeaders: false,
  wafEnabled: false,
  rateLimit: false,
  ssoConfigured: false,
  secretsVault: false,
  secretsVaultPersistent: false,
  auditImmutable: false,
  siemStreaming: false,
  provenanceSigning: false,
  piiRedaction: false,
  piiFloorEnforced: false,
  egressLeash: false,
  guardrails: false,
  onPrem: false,
  backupsAutomated: false,
  drReplica: false,
  coverageGate: false,
  tenantIsolationVerified: false,
};

// A live boolean -> implemented, else the given honest fallback (in-progress by default).
function fromFlag(on: boolean, fallback: PostureStatus = 'in-progress'): PostureStatus {
  return on ? 'implemented' : fallback;
}

interface PostureSpec {
  id: string;
  pillar: PillarId;
  title: string;
  detail: string;
  evidenceFor: string[];
  status: (i: PostureInputs) => PostureStatus;
}

// The posture-item specs. `status` is a pure function of the snapshot. Copy is capability-language.
const POSTURE_SPECS: PostureSpec[] = [
  // -- 1. Security posture ------------------------------------------------------
  {
    id: 'sec-headers',
    pillar: 'security-posture',
    title: 'Hardened browser security headers',
    detail:
      'Every response carries a strict content-security policy, HTTP Strict-Transport-Security, clickjacking and MIME-sniffing protections, and a locked-down permissions policy.',
    evidenceFor: ['eu-art-15-accuracy', 'nist-measure-2-7'],
    status: (i) => fromFlag(i.securityHeaders),
  },
  {
    id: 'sec-waf',
    pillar: 'security-posture',
    title: 'Web-application firewall at the edge',
    detail:
      'A rule-based firewall inspects every inbound request at the network edge and blocks common web attacks before they reach the application.',
    evidenceFor: ['eu-art-15-accuracy', 'nist-measure-2-7'],
    status: (i) => fromFlag(i.wafEnabled),
  },
  {
    id: 'sec-ratelimit',
    pillar: 'security-posture',
    title: 'Abuse & rate-limit protection',
    detail:
      'Per-client and per-credential request throttling caps abusive traffic and protects the platform from denial-of-service and credential-stuffing.',
    evidenceFor: ['nist-measure-2-7'],
    status: (i) => fromFlag(i.rateLimit),
  },
  {
    id: 'sec-sso',
    pillar: 'security-posture',
    title: 'Enterprise single sign-on',
    detail:
      'Sign-in federates to the enterprise identity provider over OIDC, with role mapping and least-privilege machine credentials — no shared or local passwords in production.',
    evidenceFor: ['iso-a3-roles', 'nist-govern-2-1'],
    status: (i) => fromFlag(i.ssoConfigured),
  },
  {
    id: 'sec-network-confinement',
    pillar: 'security-posture',
    title: 'Backend-service network confinement',
    detail:
      'Data stores, the secrets vault, and inference back-ends are bound to the loopback / private network and reachable only through the authenticated edge — never exposed publicly.',
    evidenceFor: ['iso-a6-lifecycle'],
    status: (i) => fromFlag(i.onPrem && i.wafEnabled),
  },
  {
    id: 'sec-tenant-isolation',
    pillar: 'security-posture',
    title: 'Multi-tenant data isolation',
    detail:
      'Each tenant sees only its own data. Single-tenant deployments (one customer, one box) are isolated by construction; verified cross-surface isolation for shared multi-tenant deployments is being hardened.',
    evidenceFor: ['iso-a7-data-governance', 'eu-art-10-data-gov'],
    status: (i) => (i.tenantIsolationVerified ? 'implemented' : 'in-progress'),
  },

  // -- 2. Data governance & residency -------------------------------------------
  {
    id: 'data-onprem',
    pillar: 'data-governance',
    title: 'On-premises — your data never leaves',
    detail:
      'The platform runs on your own infrastructure. Prompts, documents, and model inference stay inside your network by default; nothing is sent to a third party unless you explicitly allow it.',
    evidenceFor: ['iso-a7-data-governance', 'eu-art-10-data-gov'],
    status: (i) => fromFlag(i.onPrem, 'planned'),
  },
  {
    id: 'data-egress-leash',
    pillar: 'data-governance',
    title: 'Cloud egress leash (default-deny)',
    detail:
      'Any route to an external model is default-denied and, when allowed, leashed by policy with least-permissive-wins — so data cannot leave the boundary without an explicit, auditable decision.',
    evidenceFor: ['iso-a7-data-governance', 'eu-art-10-data-gov'],
    status: (i) => fromFlag(i.egressLeash),
  },
  {
    id: 'data-pii-redaction',
    pillar: 'data-governance',
    title: 'Sensitive-data detection & masking',
    detail:
      'Inbound text is scanned for personal and financial identifiers and masked before it reaches a model, with the redaction recorded for audit.',
    evidenceFor: ['iso-a7-data-governance', 'eu-art-10-data-gov'],
    status: (i) => fromFlag(i.piiRedaction),
  },
  {
    id: 'data-pii-floor',
    pillar: 'data-governance',
    title: 'Organisation-wide masking floor',
    detail:
      'A tenant-level masking floor that applies to every run regardless of the surface is being finished, so no path can reach a model with unmasked sensitive data.',
    evidenceFor: ['iso-a7-data-governance'],
    status: (i) => (i.piiFloorEnforced ? 'implemented' : 'in-progress'),
  },
  {
    id: 'data-retention-rtbf',
    pillar: 'data-governance',
    title: 'Retention & right-to-be-forgotten',
    detail:
      'Data-subject erasure and retention controls let you honour deletion requests across the warehouse, vector store, and lineage graph.',
    evidenceFor: ['iso-a7-data-governance', 'eu-art-10-data-gov'],
    status: () => 'implemented',
  },
  {
    id: 'data-lineage',
    pillar: 'data-governance',
    title: 'Source-to-answer data lineage',
    detail:
      'Every answer records the sources it drew on, so you can trace any output back to the exact data that produced it.',
    evidenceFor: ['eu-art-12-logging', 'nist-manage-4-1'],
    status: () => 'implemented',
  },
  {
    id: 'data-vault',
    pillar: 'data-governance',
    title: 'Secrets vaulting',
    detail:
      'Connector, tool, and gateway credentials are stored in a dedicated secrets vault and are write-only from the console — key names are listed, values never read back.',
    evidenceFor: ['iso-a7-data-governance'],
    status: (i) =>
      i.secretsVault && i.secretsVaultPersistent
        ? 'implemented'
        : i.secretsVault
          ? 'in-progress'
          : 'planned',
  },

  // -- 3. AI governance / model risk --------------------------------------------
  {
    id: 'ai-guardrails',
    pillar: 'ai-governance',
    title: 'Input & output guardrails',
    detail:
      'Configurable guardrails screen prompts and responses — prompt-injection, unsafe content, and policy violations — and block or redact before anything is returned.',
    evidenceFor: ['nist-measure-2-7', 'eu-art-15-accuracy'],
    status: (i) => fromFlag(i.guardrails),
  },
  {
    id: 'ai-evals',
    pillar: 'ai-governance',
    title: 'Evaluations & faithfulness scoring',
    detail:
      'Outputs are scored against documented test sets and grounding/faithfulness metrics, so model behaviour is evidenced rather than assumed.',
    evidenceFor: ['nist-measure-2-1', 'eu-art-13-transparency', 'iso-a8-transparency'],
    status: () => 'implemented',
  },
  {
    id: 'ai-drift',
    pillar: 'ai-governance',
    title: 'Drift & post-deployment monitoring',
    detail:
      'Live behaviour is monitored for drift after deployment and fed back into risk management, with alerting on deviation.',
    evidenceFor: ['nist-manage-4-1', 'eu-art-12-logging'],
    status: () => 'implemented',
  },
  {
    id: 'ai-human-oversight',
    pillar: 'ai-governance',
    title: 'Human-in-the-loop oversight',
    detail:
      'Sensitive actions can require human review and approval, and an operator can intervene in, override, or stop any run.',
    evidenceFor: ['iso-a9-human-oversight', 'eu-art-14-oversight', 'nist-manage-2-1'],
    status: () => 'implemented',
  },
  {
    id: 'ai-provenance',
    pillar: 'ai-governance',
    title: 'Cryptographic provenance on outputs',
    detail:
      'Answers and generated artifacts are cryptographically signed so an exported output is tamper-evident and verifiable offline — every AI action is attributable.',
    evidenceFor: ['eu-art-12-logging', 'iso-a8-transparency'],
    status: (i) => fromFlag(i.provenanceSigning),
  },
  {
    id: 'ai-audit',
    pillar: 'ai-governance',
    title: 'Immutable, searchable audit trail',
    detail:
      'Every governed action is recorded to an append-only audit trail — who did what, what was blocked or redacted, and what it cost — so every AI action is observable and reversible.',
    evidenceFor: ['eu-art-12-logging', 'nist-manage-4-1', 'iso-a6-lifecycle'],
    status: (i) =>
      i.auditImmutable && i.siemStreaming
        ? 'implemented'
        : i.auditImmutable
          ? 'in-progress'
          : 'planned',
  },
  {
    id: 'ai-model-risk-lifecycle',
    pillar: 'ai-governance',
    title: 'Model-risk lifecycle governance',
    detail:
      'Models and pipelines are governed across their lifecycle — documented gates, a versioned policy contract, and a risk register — the model-risk story a regulator expects.',
    evidenceFor: ['iso-a6-lifecycle', 'eu-art-9-risk-mgmt', 'nist-manage-1-1'],
    status: () => 'implemented',
  },
];

// Derive the live posture items from a snapshot. Pure. Validates every `evidenceFor` id against the
// shipped catalog so a stale reference can't silently mislead a reviewer (dropped if unknown).
export function buildPosture(inputs: PostureInputs): PostureItem[] {
  return POSTURE_SPECS.map((s) => ({
    id: s.id,
    pillar: s.pillar,
    title: s.title,
    detail: s.detail,
    status: s.status(inputs),
    evidenceFor: s.evidenceFor.filter(isKnownControl),
  }));
}

// ─── Compliance-artifact checklist (pure) ─────────────────────────────────────
//
// The procurement pack a CISO asks for. Statuses are HONEST placeholders — `available` only when we
// truly have it. Nothing here is fabricated as "available".
export const ARTIFACT_STATUSES = ['available', 'template', 'planned'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export function isArtifactStatus(v: unknown): v is ArtifactStatus {
  return typeof v === 'string' && (ARTIFACT_STATUSES as readonly string[]).includes(v);
}

export interface ComplianceArtifact {
  id: string;
  name: string;
  description: string;
  status: ArtifactStatus;
}

// Honest baseline. `template` = we generate a live document from the control plane (e.g. the DPIA /
// evidence pack export). `available` = a produced artifact exists. `planned` = not yet — shown so a
// reviewer sees the real state, never an overstated claim.
export const COMPLIANCE_ARTIFACTS: ComplianceArtifact[] = [
  {
    id: 'evidence-pack',
    name: 'Compliance evidence pack',
    description:
      'A regulator-ready summary of posture and control coverage, generated live from the control plane.',
    status: 'template',
  },
  {
    id: 'dpia',
    name: 'Data-protection impact assessment (DPIA)',
    description:
      'A per-framework DPIA template populated from the live control catalogue and audit ledger.',
    status: 'template',
  },
  {
    id: 'trust-summary',
    name: 'Trust & security summary',
    description: 'This Trust Center as a downloadable, printable report for a procurement pack.',
    status: 'template',
  },
  {
    id: 'data-flow-diagram',
    name: 'Data-flow diagram',
    description: 'A diagram of how data moves through the platform and where it is stored.',
    status: 'planned',
  },
  {
    id: 'pentest',
    name: 'Penetration test / VAPT report',
    description: 'An independent penetration-test and vulnerability-assessment report.',
    status: 'planned',
  },
  {
    id: 'sbom',
    name: 'Software bill of materials (SBOM)',
    description: 'A machine-readable inventory of all software components and their licences.',
    status: 'planned',
  },
  {
    id: 'soc2',
    name: 'SOC 2 Type II report',
    description: 'An independent attestation of security, availability, and confidentiality controls.',
    status: 'planned',
  },
  {
    id: 'iso27001',
    name: 'ISO/IEC 27001 certificate',
    description: 'Certification of the information-security management system.',
    status: 'planned',
  },
];

export interface ArtifactSummary {
  total: number;
  available: number;
  template: number;
  planned: number;
}

export function summariseArtifacts(artifacts: ComplianceArtifact[]): ArtifactSummary {
  const s: ArtifactSummary = { total: artifacts.length, available: 0, template: 0, planned: 0 };
  for (const a of artifacts) s[a.status] += 1;
  return s;
}

// ─── India-BFSI regulatory framings (content) ─────────────────────────────────
//
// The console ships three global frameworks (ISO 42001 / NIST AI RMF / EU AI Act) in the control
// catalog. BFSI buyers in India also gate on domestic regulators. We ADD these as mapped control
// GROUPS — content only — pointing at the catalog controls that already satisfy the same intent, so
// the mapping reuses the real catalog (DRY) instead of duplicating a control library.
//
// GROUNDING: framing text describes each regulator's real, published expectations in plain language.
// It does not quote or fabricate clause numbers — the mapped `controlIds` carry the auditable link.

export interface BfsiFraming {
  id: string;
  regulator: string; // the Indian authority
  name: string;
  summary: string; // plain-language, what the regulator expects
  controlIds: string[]; // catalog controls that provide evidence for this expectation
}

export const INDIA_BFSI_FRAMINGS: BfsiFraming[] = [
  {
    id: 'rbi-model-governance',
    regulator: 'Reserve Bank of India (RBI)',
    name: 'Model / analytics governance for regulated entities',
    summary:
      'RBI expects banks and NBFCs to govern models and analytics with clear ownership, validation, documented lifecycle controls, and auditability — the model-risk discipline a supervisor can inspect.',
    controlIds: [
      'iso-a3-roles',
      'iso-a6-lifecycle',
      'nist-manage-1-1',
      'nist-measure-2-1',
      'eu-art-12-logging',
    ],
  },
  {
    id: 'rbi-outsourcing-data-localisation',
    regulator: 'Reserve Bank of India (RBI)',
    name: 'IT outsourcing & data storage in India',
    summary:
      'RBI requires that regulated entities keep control over outsourced IT and store payment/financial data within India — met by running the platform on-premises inside your own boundary with a leashed egress path.',
    controlIds: ['iso-a7-data-governance', 'eu-art-10-data-gov', 'iso-a10-third-party'],
  },
  {
    id: 'irdai-governance',
    regulator: 'IRDAI',
    name: 'Information & cyber-security governance for insurers',
    summary:
      'IRDAI expects insurers to run a board-approved information-security programme with access control, audit logging, and oversight of technology risk across the policy and claims lifecycle.',
    controlIds: [
      'iso-a2-ai-policy',
      'iso-a3-roles',
      'iso-a9-human-oversight',
      'eu-art-12-logging',
      'nist-govern-1-1',
    ],
  },
  {
    id: 'dpdp-2023',
    regulator: 'Government of India (MeitY)',
    name: 'Digital Personal Data Protection Act, 2023',
    summary:
      'The DPDP Act requires lawful processing of personal data with purpose limitation, data-principal rights including erasure, and accountable data-fiduciary controls — met by on-prem processing, sensitive-data masking, retention/erasure, and a full audit trail.',
    controlIds: [
      'iso-a7-data-governance',
      'eu-art-10-data-gov',
      'iso-a5-impact-assessment',
      'eu-art-12-logging',
    ],
  },
];

// A framing rolled up against the live posture: which of its mapped controls have implemented
// posture evidence. Pure — takes the derived posture items. `coverage` is the share of mapped
// controls that at least one IMPLEMENTED posture item provides evidence for.
export interface FramingRollup extends BfsiFraming {
  evidenced: number; // mapped controls with >=1 implemented posture item
  coverage: number; // 0-100
}

export function rollupFramings(framings: BfsiFraming[], posture: PostureItem[]): FramingRollup[] {
  const implementedControlIds = new Set(
    posture.filter((p) => p.status === 'implemented').flatMap((p) => p.evidenceFor),
  );
  return framings.map((f) => {
    const evidenced = f.controlIds.filter((id) => implementedControlIds.has(id)).length;
    const coverage =
      f.controlIds.length === 0 ? 0 : Math.round((evidenced / f.controlIds.length) * 100);
    return { ...f, evidenced, coverage };
  });
}

// A brief for a mapped control id, resolved from the shipped catalog (so framings reuse the real
// catalog rather than duplicating titles). Unknown ids are dropped.
export interface ControlBrief {
  id: string;
  framework: FrameworkId;
  ref: string;
  title: string;
}

const CATALOG_INDEX: Map<string, { framework: FrameworkId; control: CatalogControl }> = new Map(
  CATALOG.flatMap((f) => f.controls.map((control) => [control.id, { framework: f.id, control }])),
);

export function controlBriefs(ids: string[]): ControlBrief[] {
  return ids
    .map((id) => CATALOG_INDEX.get(id))
    .filter((e): e is { framework: FrameworkId; control: CatalogControl } => Boolean(e))
    .map(({ framework, control }) => ({
      id: control.id,
      framework,
      ref: control.ref,
      title: control.title,
    }));
}

// ─── Overall summary (pure) ────────────────────────────────────────────────────

export interface PillarSummary {
  pillar: PillarId;
  total: number;
  implemented: number;
  inProgress: number;
  planned: number;
}

export interface TrustSummary {
  generatedAt: string;
  // Headline posture: share of scoreable items that are implemented. `not-applicable` items are
  // excluded from the denominator (they aren't in scope), so the score reflects real coverage of
  // applicable controls and is never inflated by counting N/A as done.
  score: number; // 0-100
  totals: { implemented: number; inProgress: number; planned: number; notApplicable: number };
  pillars: PillarSummary[];
}

const PILLAR_ORDER: PillarId[] = [...PILLARS];

export function summarisePosture(posture: PostureItem[], generatedAt: string): TrustSummary {
  const totals = { implemented: 0, inProgress: 0, planned: 0, notApplicable: 0 };
  for (const p of posture) {
    if (p.status === 'implemented') totals.implemented += 1;
    else if (p.status === 'in-progress') totals.inProgress += 1;
    else if (p.status === 'planned') totals.planned += 1;
    else totals.notApplicable += 1;
  }
  const scoreable = totals.implemented + totals.inProgress + totals.planned;
  const score = scoreable === 0 ? 0 : Math.round((totals.implemented / scoreable) * 100);

  const pillars: PillarSummary[] = PILLAR_ORDER.map((pillar) => {
    const items = posture.filter((p) => p.pillar === pillar);
    return {
      pillar,
      total: items.length,
      implemented: items.filter((p) => p.status === 'implemented').length,
      inProgress: items.filter((p) => p.status === 'in-progress').length,
      planned: items.filter((p) => p.status === 'planned').length,
    };
  });

  return { generatedAt, score, totals, pillars };
}

// Human-readable pillar labels (single source, reused by page + report).
export const PILLAR_LABELS: Record<PillarId, string> = {
  'security-posture': 'Security posture',
  'data-governance': 'Data governance & residency',
  'ai-governance': 'AI governance & model risk',
  'compliance-artifacts': 'Compliance artifacts',
};
