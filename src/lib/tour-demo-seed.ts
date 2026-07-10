// ─── Tour-worthy demo seed (Phase 2.2/2.3) — PURE spec + planners, parametrized by tenant ─────────
//
// THE GOAL: make BOTH public-demo tenants look like a real, populated Indian-BFSI enterprise across
// EVERY tour surface — Studio (apps + agents), Runs/Review, Pipelines, Gateways, Connectors/Data,
// Governance (policy/guardrails/evals/drift/regulatory), Insights/Analytics, Knowledge/Brain, and
// Access (teams/users) — plus a read-only VIEWER user per tenant that the hellobar surfaces.
//
//   • mock BANK    → org_bharat   (Bharat Union — bharatunion-onprem-console.getoffgridai.co)
//   • mock INSURER → org_suraksha (Suraksha Life — suraksha-onprem-console.getoffgridai.co)
//
// SOLID: this module is PURE DATA + PURE PLANNERS (zero I/O, zero store imports). ONE parametrized
// profile drives both tenants — the bank/insurer difference is DATA (a TenantProfile), never a code
// fork. The SQL emitter (deploy/onprem/seed-tour-demo.mjs) and any POST route inject the current rows
// and drive these planners idempotently. Deterministic ids (a stable FNV hash of org+key, like
// seed-bharat-catalog.mjs) so re-running creates nothing new (idempotent by construction).
//
// HONESTY: apps bind to data-domain LABELS that already resolve to the REAL seeded connectors
// (mirrors data-domains-demo-seed / suraksha-tenant-seed). No fabricated PII — every value is
// synthetic Indian-BFSI (INR, PAN, IFSC, Indian names, banks/NBFCs/insurers). Runs are seeded in a
// mix of `done` + `awaiting_human` so Runs/Review light up; apps are SHADOW-safe (side-effecting
// sinks are `report`/`console`, never live delivery) so a public demo never acts on the world.
//
// NOTE on analytics/FinOps: those charts read GATEWAY TELEMETRY from OpenSearch (index
// `offgrid-gateway`), NOT the console Postgres — see analytics.ts / finops.ts. This module seeds the
// console-DB surfaces; the telemetry docs are a data-plane step (documented in the emitter + report).
// Drift + regulatory coverage DERIVE from console-DB rows we DO seed here (eval_runs + adoption).

import { egressClassFor, type GatewayKind } from '@/lib/gateways-policy';
import type { AppStep, AppEdge, OutputStep } from '@/lib/app-model';

// ─── Deterministic id helper (FNV-1a → 12 hex, matches seed-bharat-catalog.mjs) ───────────────────
/** Stable 12-hex digest of a key. Deterministic (no randomUUID) ⇒ the seed is idempotent. */
export function hash12(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0').slice(0, 12);
}

// ─── Tenant profile — the ONLY thing that differs between bank & insurer ──────────────────────────
export interface TenantProfile {
  orgId: string;
  slug: string;
  /** Domain flavour, used only for copy — 'bank' | 'insurer'. */
  flavour: 'bank' | 'insurer';
  /** Read-only demo viewer identity (the hellobar surfaces this email; password comes from env). */
  viewerEmail: string;
  viewerName: string;
}

// The env var that holds a tenant's real read-only viewer login email — the SINGLE source of truth
// for who signs in (OFFGRID_DEMO_VIEWER_<SLUG>_EMAIL, set in .env.local on the server). Chat and other
// per-user seed rows MUST be owned by this exact identity, or the logged-in viewer (keyed on
// session.user.email) sees none of them. Pure: derives the key, does not read the environment.
export function viewerEmailEnvKey(slug: string): string {
  return `OFFGRID_DEMO_VIEWER_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '')}_EMAIL`;
}

export const BHARAT_PROFILE: TenantProfile = {
  orgId: 'org_bharat',
  slug: 'bharatunion',
  flavour: 'bank',
  viewerEmail: 'viewer@bharatunion.demo',
  viewerName: 'Bharat Union — Demo Viewer',
};

export const SURAKSHA_PROFILE: TenantProfile = {
  orgId: 'org_suraksha',
  slug: 'suraksha',
  flavour: 'insurer',
  viewerEmail: 'viewer@suraksha.demo',
  viewerName: 'Suraksha Life — Demo Viewer',
};

export const TOUR_PROFILES: readonly TenantProfile[] = [BHARAT_PROFILE, SURAKSHA_PROFILE];

// ─── Apps + agents (Studio) — governed use cases, each bound to a pipeline by NAME ────────────────
// A step is a minimal AppSpec step. `domain` on connector-query steps is a LABEL (resolves at run
// time via the label-matching resolver — the honesty seam in data-domains-demo-seed).
export interface AppStepSpec {
  kind: 'connector-query' | 'agent' | 'human' | 'output';
  label: string;
  domain?: string; // connector-query only — a data-domain LABEL that already resolves for the org
  op?: string; // connector-query only
  systemPrompt?: string; // agent only
  sink?: string; // output only — 'report' | 'console' (SHADOW-safe; never live delivery)
}

export interface AppSpecSeed {
  /** Stable key — the idempotency root within an org. */
  key: string;
  title: string;
  summary: string;
  /** The governed pipeline NAME this app runs on (resolved to id at seed time). Mirrors SAMPLE_PIPELINES. */
  pipelineName: string;
  steps: AppStepSpec[];
  /** How many demo runs to seed, and how many of those pause at the human gate (awaiting_review). */
  runs: { done: number; awaitingReview: number };
}

// Step builders (DRY — mirror scripts/seed-bfsi-demo.mjs).
const q = (label: string, domain: string): AppStepSpec => ({ kind: 'connector-query', label, domain, op: 'read' });
const ag = (label: string, systemPrompt: string): AppStepSpec => ({ kind: 'agent', label, systemPrompt });
const hu = (label: string): AppStepSpec => ({ kind: 'human', label });
const out = (label: string): AppStepSpec => ({ kind: 'output', label, sink: 'report' });

// ── BANK apps (org_bharat) — 6 governed use cases ──
export const BANK_APPS: readonly AppSpecSeed[] = [
  {
    key: 'kyc-rekyc',
    title: 'KYC & Re-KYC Verification',
    summary:
      'Onboarding / periodic Re-KYC — read the customer OVDs, verify PAN and masked-Aadhaar consistency, screen PEP/UAPA, flag mismatches for manual review per the RBI Master Direction.',
    pipelineName: 'KYC Verification',
    steps: [
      q('Read the customer & submitted OVDs', 'customer data'),
      ag('Verify KYC per RBI Master Direction', 'Check that name, PAN and address match across the OVDs; PAN is mandatory. Aadhaar must be handled masked. Screen PEP/UAPA. Route any mismatch to manual review. Cite the policy.'),
      hu('Compliance review'),
      out('KYC verdict (verified / manual-review)'),
    ],
    runs: { done: 7, awaitingReview: 2 },
  },
  {
    key: 'loan-underwriting',
    title: 'Personal Loan Underwriting Assist',
    summary:
      'Personal-loan eligibility — pull the applicant and their transactions, compute FOIR and check CIBIL/income floors from policy, recommend approve/decline with reasons. Ticket ₹50k–₹40L.',
    pipelineName: 'Loan Underwriting',
    steps: [
      q('Pull the applicant', 'customer data'),
      q('Pull 6-month bank statement', 'transactions'),
      ag('Assess eligibility (FOIR, CIBIL, income)', 'Compute FOIR after the new EMI and check CIBIL and income floors. Recommend approve, decline, or refer-to-senior with the reason and policy clause. All amounts in ₹.'),
      hu('Credit officer decision'),
      out('Underwriting recommendation'),
    ],
    runs: { done: 9, awaitingReview: 3 },
  },
  {
    key: 'fraud-screening',
    title: 'Fraud Screening',
    summary:
      'Transaction fraud screening — score UPI/NEFT/IMPS transactions against behavioural patterns; transaction data stays on the box, high-risk cases route for analyst review.',
    pipelineName: 'Fraud Screening',
    steps: [
      q('Pull the transaction & customer', 'transactions'),
      ag('Score fraud risk', 'Score the transaction for fraud against velocity, geolocation and beneficiary patterns. Explain the drivers. Flag anything above the risk threshold for analyst review. Amounts in ₹.'),
      hu('Fraud analyst review'),
      out('Fraud verdict + risk score'),
    ],
    runs: { done: 12, awaitingReview: 2 },
  },
  {
    key: 'reimbursement',
    title: 'Reimbursement Approval',
    summary:
      "Employee reimbursement — read the invoice, check the employee's quota, decide eligibility, then approve/reject. PAN/bank details masked, everything on-prem. Amounts in ₹.",
    pipelineName: 'Reimbursement Governance',
    steps: [
      q('Read the invoice', 'invoices'),
      q("Check the employee's reimbursement quota", 'reimbursement quota'),
      ag('Decide eligibility', 'Given the invoice amount and the employee reimbursement quota, decide whether the employee is within quota and eligible. State the remaining quota and a clear eligible / not-eligible recommendation. Amounts in ₹.'),
      hu('Approve or reject'),
      out('Reimbursement decision'),
    ],
    runs: { done: 6, awaitingReview: 1 },
  },
  {
    key: 'cross-sell',
    title: 'Cross-Sell Advisor',
    summary:
      'Next-best-action for relationship managers — suggest products from the customer holding pattern; aggregate insights only, individual PII masked.',
    pipelineName: 'Cross-Sell Advisor',
    steps: [
      q('Pull the customer holdings', 'customer data'),
      ag('Recommend next best action', 'From the customer holding pattern, suggest the next-best product with a one-line rationale. Aggregate insights only — never expose individual PII. Amounts in ₹.'),
      out('Cross-sell recommendation'),
    ],
    runs: { done: 8, awaitingReview: 0 },
  },
  {
    key: 'fnol-triage',
    title: 'Motor Claim FNOL Triage',
    summary:
      'Motor own-damage FNOL — read the policy & claim, check the vehicle is covered and premium paid, decide cashless vs surveyor, route for approval. Amounts in ₹.',
    pipelineName: 'Motor-Claim FNOL',
    steps: [
      q('Read the claim & policy', 'claims'),
      q('Look up the customer & vehicle', 'customer data'),
      ag('Decide cashless vs surveyor', 'Given the FNOL claim and in-force policy, decide cashless at a network garage vs a surveyor (mandatory above ₹1,00,000). Never approve if the licence was invalid at the time of loss.'),
      hu('Claims officer approval'),
      out('Claim decision + audit note'),
    ],
    runs: { done: 5, awaitingReview: 2 },
  },
];

// ── INSURER apps (org_suraksha) — 6 governed use cases (bind to Suraksha's domains) ──
export const INSURER_APPS: readonly AppSpecSeed[] = [
  {
    key: 'fnol-motor',
    title: 'Motor-Claim FNOL Intake',
    summary:
      'First Notice of Loss intake — read the claim & policy, confirm cover and premium paid, decide cashless vs surveyor, route for approval. Policyholder PII never leaves the network. Amounts in ₹.',
    pipelineName: 'Motor-Claim FNOL',
    steps: [
      q('Read the FNOL claim', 'claims'),
      q('Check the policy is in force', 'policies'),
      ag('Decide cashless vs surveyor', 'Given the FNOL claim and in-force policy, decide cashless vs a mandatory surveyor (above ₹1,00,000). Cite the SOP. Never approve if the licence was invalid at the time of loss.'),
      hu('Claims officer approval'),
      out('Claim decision + audit note'),
    ],
    runs: { done: 8, awaitingReview: 3 },
  },
  {
    key: 'policy-underwriting',
    title: 'Policy Underwriting Assist',
    summary:
      'Life-policy underwriting — read the proposal & rate card, assess sum-assured vs income and medical risk, recommend standard/loaded/decline per the OYRT rate card. Amounts in ₹.',
    pipelineName: 'Loan Underwriting',
    steps: [
      q('Read the proposal', 'policies'),
      q('Pull the OYRT rate card', 'pricing rate card'),
      ag('Assess underwriting decision', 'Assess sum-assured vs declared income and medical risk against the OYRT rate card. Recommend standard, loaded (with the loading %), or decline, with the reason. Amounts in ₹.'),
      hu('Underwriter decision'),
      out('Underwriting recommendation'),
    ],
    runs: { done: 7, awaitingReview: 2 },
  },
  {
    key: 'claims-triage',
    title: 'Death-Claim Assessment',
    summary:
      'Death-claim assessment — read the claim documents, cross-check the policy and premium history, flag early-claim / non-disclosure risk for investigation. Amounts in ₹.',
    pipelineName: 'Fraud Screening',
    steps: [
      q('Read the claim documents', 'claim documents'),
      q('Check premium & persistency', 'premiums'),
      ag('Assess claim risk', 'Cross-check the death claim against the policy in-force date and premium history. Flag early-claim (within 3 years), non-disclosure or fraud-risk indicators for investigation, else fast-track. Amounts in ₹.'),
      hu('Claims committee review'),
      out('Claim assessment + risk flag'),
    ],
    runs: { done: 6, awaitingReview: 2 },
  },
  {
    key: 'renewal-persistency',
    title: 'Renewal & Persistency Nudge',
    summary:
      'Renewal persistency — read the premium ledger, identify lapse-risk policies nearing the grace-period end, recommend a retention action per the advisor.',
    pipelineName: 'Cross-Sell Advisor',
    steps: [
      q('Read the premium ledger', 'premiums'),
      ag('Recommend a retention action', 'Identify policies nearing grace-period end at lapse risk. Recommend the retention action (advisor call, auto-debit setup, part-payment). Aggregate insights only — mask individual PII. Amounts in ₹.'),
      out('Persistency action list'),
    ],
    runs: { done: 9, awaitingReview: 0 },
  },
  {
    key: 'grievance',
    title: 'Grievance Resolution Assist',
    summary:
      'Grievance handling — read the helpdesk case, classify by IRDAI category, draft a compliant resolution for a service officer to approve.',
    pipelineName: 'KYC Verification',
    steps: [
      q('Read the helpdesk case', 'helpdesk cases'),
      ag('Classify & draft a resolution', 'Classify the grievance by IRDAI category and draft a compliant, empathetic resolution referencing the policy terms. Route to a service officer for approval. Never send automatically.'),
      hu('Service officer approval'),
      out('Grievance resolution draft'),
    ],
    runs: { done: 5, awaitingReview: 2 },
  },
  {
    key: 'reimbursement',
    title: 'Reimbursement Approval',
    summary:
      "Employee reimbursement — read the invoice, check the employee's quota, decide eligibility, then approve/reject. PAN/bank details masked, everything on-prem. Amounts in ₹.",
    pipelineName: 'Reimbursement Governance',
    steps: [
      q("Check the employee's reimbursement quota", 'reimbursement quota'),
      ag('Decide eligibility', 'Given the claim amount and the employee reimbursement quota, decide whether the employee is within quota and eligible. State the remaining quota and a clear recommendation. Amounts in ₹.'),
      hu('Approve or reject'),
      out('Reimbursement decision'),
    ],
    runs: { done: 6, awaitingReview: 1 },
  },
];

/** The apps for a profile — bank vs insurer. */
export function appsFor(profile: TenantProfile): readonly AppSpecSeed[] {
  return profile.flavour === 'bank' ? BANK_APPS : INSURER_APPS;
}

// ─── AppSpecSeed → AppSpec steps/edges (PURE) — the seam that MUST satisfy validateAppSpec ─────────
// WHY this exists: the seed writes apps through createApp/updateApp, which run validateAppSpec
// (src/lib/app-model.ts). That validator reads each field at the step's TOP level — a connector-query
// needs `step.domain`, an agent needs `step.agentId` OR `step.inlineAgent.systemPrompt`, an output
// needs `step.sink`. A prior mapping stuffed everything under `step.config`, so every seeded app spec
// failed validation ("needs a domain binding / needs agentId or inlineAgent / needs a sink") and the
// whole run aborted at seedApps. Keeping this mapping PURE + unit-tested against the REAL validator is
// the fails-before/passes-after proof, and DRY (the .mts runner imports it — never re-implements it).
const OUTPUT_SINKS: readonly OutputStep['sink'][] = ['console', 'report', 'email', 'whatsapp'];

/** Normalise a seed sink label to a valid OutputStep sink (SHADOW-safe default: 'report'). */
function toSink(sink: string | undefined): OutputStep['sink'] {
  return (OUTPUT_SINKS as readonly string[]).includes(sink ?? '')
    ? (sink as OutputStep['sink'])
    : 'report';
}

/**
 * Map one app's ordered AppStepSpec[] to concrete AppStep[] whose shape passes validateAppSpec.
 * Ids are `s0..sN` (positional) so buildAppEdges can wire a linear chain that mirrors step order.
 */
export function buildAppSteps(spec: AppSpecSeed): AppStep[] {
  return spec.steps.map((s, i): AppStep => {
    const id = `s${i}`;
    switch (s.kind) {
      case 'connector-query':
        // domain is the LABEL binding validateStepShape requires at the top level.
        return { id, kind: 'connector-query', label: s.label, domain: s.domain ?? '', op: 'read' };
      case 'agent':
        // No pre-existing agent id at spec time ⇒ an inlineAgent carrying the systemPrompt (grounded).
        return {
          id,
          kind: 'agent',
          label: s.label,
          inlineAgent: { systemPrompt: s.systemPrompt ?? s.label, grounded: true },
        };
      case 'human':
        return { id, kind: 'human', label: s.label };
      case 'output':
        return { id, kind: 'output', label: s.label, sink: toSink(s.sink) };
    }
  });
}

/** Wire a linear chain over the built steps (s0→s1→…→sN): exactly one entry, all reachable. */
export function buildAppEdges(steps: AppStep[]): AppEdge[] {
  return steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id }));
}

/** Convenience: both halves of a valid app graph for a seed spec. */
export function buildAppGraph(spec: AppSpecSeed): { steps: AppStep[]; edges: AppEdge[] } {
  const steps = buildAppSteps(spec);
  return { steps, edges: buildAppEdges(steps) };
}

// ── Custom agents (Studio "agents" list, `custom_agents`) — 4 per tenant ──
export interface CustomAgentSeed {
  key: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
}

export const BANK_AGENTS: readonly CustomAgentSeed[] = [
  { key: 'kyc-analyst', name: 'KYC Analyst', role: 'Compliance', description: 'Verifies OVDs and screens PEP/UAPA against the RBI Master Direction.', systemPrompt: 'You verify KYC documents against the RBI KYC Master Direction. PAN mandatory; Aadhaar masked. Cite the clause.' },
  { key: 'credit-officer', name: 'Credit Officer', role: 'Lending', description: 'Computes FOIR and checks CIBIL/income floors for retail loans.', systemPrompt: 'You assess retail loan eligibility using FOIR, CIBIL and income floors. Amounts in ₹. State the decision and reason.' },
  { key: 'fraud-analyst', name: 'Fraud Analyst', role: 'Risk', description: 'Scores UPI/NEFT/IMPS transactions for fraud risk.', systemPrompt: 'You score transactions for fraud against velocity, geo and beneficiary patterns. Explain the drivers. Amounts in ₹.' },
  { key: 'rm-advisor', name: 'RM Advisor', role: 'Sales', description: 'Suggests next-best-action products from the customer holding pattern.', systemPrompt: 'You suggest the next-best product from the customer holdings with a one-line rationale. Aggregate only; mask PII.' },
];

export const INSURER_AGENTS: readonly CustomAgentSeed[] = [
  { key: 'claims-assessor', name: 'Claims Assessor', role: 'Claims', description: 'Assesses death claims against policy in-force date and premium history.', systemPrompt: 'You assess death claims for early-claim and non-disclosure risk against the policy and premium history. Amounts in ₹.' },
  { key: 'underwriter', name: 'Underwriter', role: 'Underwriting', description: 'Assesses life proposals against the OYRT rate card.', systemPrompt: 'You underwrite life proposals against the OYRT rate card: standard, loaded (with %), or decline, with reason. Amounts in ₹.' },
  { key: 'persistency-advisor', name: 'Persistency Advisor', role: 'Retention', description: 'Flags lapse-risk policies and recommends retention actions.', systemPrompt: 'You flag policies near grace-period end and recommend retention actions. Aggregate only; mask PII. Amounts in ₹.' },
  { key: 'grievance-officer', name: 'Grievance Officer', role: 'Service', description: 'Classifies grievances by IRDAI category and drafts resolutions.', systemPrompt: 'You classify grievances by IRDAI category and draft compliant, empathetic resolutions. Route for approval; never auto-send.' },
];

export function agentsFor(profile: TenantProfile): readonly CustomAgentSeed[] {
  return profile.flavour === 'bank' ? BANK_AGENTS : INSURER_AGENTS;
}

// ── Governance items (governance_items) — the org's AI-governance registry ──
export interface GovernanceSeed {
  key: string;
  kind: string; // policy | ethics_review | raci | training | vendor | insurance | drill | impact_assessment
  title: string;
  owner: string;
  status: string; // draft | active | due | expired
  detail: string;
}

export const GOVERNANCE_ITEMS: readonly GovernanceSeed[] = [
  { key: 'ai-policy', kind: 'policy', title: 'Responsible AI Policy', owner: 'Chief Risk Officer', status: 'active', detail: 'Board-approved AI-usage policy: on-prem-first, human-in-the-loop for customer-impacting decisions, no PII egress.' },
  { key: 'raci', kind: 'raci', title: 'AI Governance RACI', owner: 'AI Governance Council', status: 'active', detail: 'Accountability matrix across Risk, Compliance, Data and Engineering for every governed pipeline.' },
  { key: 'ethics', kind: 'ethics_review', title: 'Model Ethics Review — Q2', owner: 'Ethics Committee', status: 'active', detail: 'Quarterly review of fairness, bias and adverse-action explainability across live use cases.' },
  { key: 'dpia', kind: 'impact_assessment', title: 'DPIA — Customer-Facing AI', owner: 'Data Protection Officer', status: 'active', detail: 'DPDP-Act-aligned data-protection impact assessment for the customer-facing governed apps.' },
  { key: 'training', kind: 'training', title: 'Staff AI-Literacy Training', owner: 'L&D', status: 'due', detail: 'Annual AI-literacy + responsible-use training for all operators. Renewal due this quarter.' },
  { key: 'vendor', kind: 'vendor', title: 'Cloud-Model Vendor Assessment', owner: 'Vendor Risk', status: 'active', detail: 'Assessment of the cloud model providers permitted by the egress leash (data-processing terms, region).' },
  { key: 'drill', kind: 'drill', title: 'AI Incident-Response Drill', owner: 'CISO', status: 'due', detail: 'Tabletop drill for an AI-incident (prompt-injection, data-exfil attempt). Next drill scheduled.' },
];

// ── Guardrail rules (guardrails_rules) — enabled PII/matcher rules ──
export interface GuardrailRuleSeed {
  key: string;
  matcher: 'entity' | 'regex';
  pattern: string;
  action: string; // redact | mask | hash | allow | block | flag | log
  label: string;
  enabled: boolean;
}

export const GUARDRAIL_RULES: readonly GuardrailRuleSeed[] = [
  { key: 'pan', matcher: 'regex', pattern: '[A-Z]{5}[0-9]{4}[A-Z]', action: 'mask', label: 'Mask PAN numbers', enabled: true },
  { key: 'aadhaar', matcher: 'regex', pattern: '\\b\\d{4}\\s?\\d{4}\\s?\\d{4}\\b', action: 'redact', label: 'Redact Aadhaar numbers', enabled: true },
  { key: 'ifsc', matcher: 'regex', pattern: '[A-Z]{4}0[A-Z0-9]{6}', action: 'mask', label: 'Mask IFSC codes', enabled: true },
  { key: 'email', matcher: 'entity', pattern: 'EMAIL_ADDRESS', action: 'mask', label: 'Mask email addresses', enabled: true },
  { key: 'phone', matcher: 'entity', pattern: 'PHONE_NUMBER', action: 'mask', label: 'Mask phone numbers', enabled: true },
  { key: 'injection', matcher: 'regex', pattern: 'ignore (all )?previous instructions', action: 'block', label: 'Block prompt-injection attempts', enabled: true },
];

// ── Regulatory adoption (compliance_adoption) — partial coverage so bars are non-zero ──
// Pairs of (controlId → status). We mark a realistic SUBSET as 'met'/'in-progress' and leave the rest
// 'new' (default), so each framework's coverage bar sits partially filled, not at 0% or 100%.
export interface AdoptionSeed {
  frameworkId: 'iso-42001' | 'nist-ai-rmf' | 'eu-ai-act';
  controlId: string;
  status: 'new' | 'in-progress' | 'met';
}

export const COMPLIANCE_ADOPTION: readonly AdoptionSeed[] = [
  // ISO 42001 — 6 of 9 controls addressed.
  { frameworkId: 'iso-42001', controlId: 'iso-a2-ai-policy', status: 'met' },
  { frameworkId: 'iso-42001', controlId: 'iso-a3-roles', status: 'met' },
  { frameworkId: 'iso-42001', controlId: 'iso-a5-impact-assessment', status: 'met' },
  { frameworkId: 'iso-42001', controlId: 'iso-a7-data-governance', status: 'met' },
  { frameworkId: 'iso-42001', controlId: 'iso-a9-human-oversight', status: 'in-progress' },
  { frameworkId: 'iso-42001', controlId: 'iso-a8-transparency', status: 'in-progress' },
  // NIST AI RMF — 5 addressed.
  { frameworkId: 'nist-ai-rmf', controlId: 'nist-govern-1-1', status: 'met' },
  { frameworkId: 'nist-ai-rmf', controlId: 'nist-govern-2-1', status: 'met' },
  { frameworkId: 'nist-ai-rmf', controlId: 'nist-map-1-1', status: 'met' },
  { frameworkId: 'nist-ai-rmf', controlId: 'nist-measure-2-1', status: 'in-progress' },
  { frameworkId: 'nist-ai-rmf', controlId: 'nist-manage-2-1', status: 'in-progress' },
  // EU AI Act — 4 addressed.
  { frameworkId: 'eu-ai-act', controlId: 'eu-risk-tier', status: 'met' },
  { frameworkId: 'eu-ai-act', controlId: 'eu-art-9-risk-mgmt', status: 'met' },
  { frameworkId: 'eu-ai-act', controlId: 'eu-art-14-oversight', status: 'in-progress' },
  { frameworkId: 'eu-ai-act', controlId: 'eu-art-13-transparency', status: 'in-progress' },
];

// ── Knowledge / Brain (org_knowledge_collections + org_knowledge_docs) ──
export interface KnowledgeDocSeed {
  key: string;
  name: string;
  text: string;
}
export interface KnowledgeCollectionSeed {
  key: string;
  name: string;
  description: string;
  docs: KnowledgeDocSeed[];
}

const BANK_KNOWLEDGE: readonly KnowledgeCollectionSeed[] = [
  {
    key: 'policies',
    name: 'BFSI Policies & SOPs',
    description: 'RBI-aligned KYC, lending and claims standard operating procedures.',
    docs: [
      { key: 'kyc', name: 'KYC & Periodic Re-KYC Policy (RBI Master Direction)', text: 'Officially Valid Documents: Aadhaar (masked), PAN, Passport, Voter ID, DL. PAN mandatory above INR 50,000. Re-KYC: high-risk 2y, medium 8y, low 10y. PEP/UAPA screening on every onboarding.' },
      { key: 'lending', name: 'Personal Loan Underwriting Guidelines', text: 'Min net monthly income INR 25,000 (salaried). FOIR below 50% after the new EMI. CIBIL floor 730. Ticket INR 50,000 to INR 40,00,000, tenure 12 to 60 months. Decline on CIBIL below 700 or FOIR above 55%.' },
      { key: 'fnol', name: 'Motor Claim FNOL SOP (IRDAI-aligned)', text: 'Capture policy number, vehicle registration, chassis, date and place of loss, PAN. Verify in-force plus premium paid. Surveyor mandatory above INR 1,00,000. Reject if the DL was invalid at the time of loss.' },
    ],
  },
];

const INSURER_KNOWLEDGE: readonly KnowledgeCollectionSeed[] = [
  {
    key: 'policies',
    name: 'Insurance Policies & SOPs',
    description: 'IRDAI-aligned underwriting, claims and grievance standard operating procedures.',
    docs: [
      { key: 'underwriting', name: 'Life Underwriting OYRT Rate Card Guide', text: 'One-Year Renewable Term rates by age band and sum-assured. Loadings for smoker/medical risk. Sum-assured vs declared income multiple caps by age.' },
      { key: 'claims', name: 'Death-Claim Assessment SOP', text: 'Early-claim (within 3 years of risk-commencement) requires investigation. Cross-check premium history for lapse. Non-disclosure of material facts is a repudiation ground. Settle genuine claims within IRDAI timelines.' },
      { key: 'grievance', name: 'Grievance Redressal Policy (IRDAI)', text: 'Classify grievances by IRDAI category. Acknowledge within 3 days, resolve within 15. Escalate unresolved to the GRO, then the Insurance Ombudsman.' },
    ],
  },
];

export function knowledgeFor(profile: TenantProfile): readonly KnowledgeCollectionSeed[] {
  return profile.flavour === 'bank' ? BANK_KNOWLEDGE : INSURER_KNOWLEDGE;
}

// ── Teams (Access) — departments that own the pipelines/apps ──
export interface TeamSeed {
  key: string;
  name: string;
  department: string;
  description: string;
}

const BANK_TEAMS: readonly TeamSeed[] = [
  { key: 'risk', name: 'Risk & Fraud', department: 'Risk', description: 'Owns fraud screening and credit-risk governance.' },
  { key: 'compliance', name: 'Compliance', department: 'Compliance', description: 'Owns KYC/AML and regulatory adoption.' },
  { key: 'lending', name: 'Retail Lending', department: 'Operations', description: 'Owns loan underwriting and disbursal workflows.' },
];

const INSURER_TEAMS: readonly TeamSeed[] = [
  { key: 'claims', name: 'Claims', department: 'Operations', description: 'Owns FNOL, death-claim assessment and settlement.' },
  { key: 'underwriting', name: 'Underwriting', department: 'Risk', description: 'Owns policy underwriting and the OYRT rate card.' },
  { key: 'service', name: 'Policyholder Service', department: 'Service', description: 'Owns grievance redressal and renewals.' },
];

export function teamsFor(profile: TenantProfile): readonly TeamSeed[] {
  return profile.flavour === 'bank' ? BANK_TEAMS : INSURER_TEAMS;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC IDS — every entity id is a stable FNV hash of (org, kind, key) so a re-run produces
// the SAME id and the emitter's ON CONFLICT DO NOTHING/UPDATE makes the seed idempotent.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function appId(orgId: string, key: string): string {
  return `app_${hash12(`${orgId}:app:${key}`)}`;
}
export function appRunId(orgId: string, appKey: string, n: number): string {
  return `run_${hash12(`${orgId}:run:${appKey}:${n}`)}`;
}
export function customAgentId(orgId: string, key: string): string {
  return `ca_${hash12(`${orgId}:agent:${key}`)}`;
}
export function agentRunId(orgId: string, agentKey: string, n: number): string {
  return `ar_${hash12(`${orgId}:agentrun:${agentKey}:${n}`)}`;
}
export function governanceId(orgId: string, key: string): string {
  return `gov_${hash12(`${orgId}:gov:${key}`)}`;
}
export function guardrailId(orgId: string, key: string): string {
  return `gr_${hash12(`${orgId}:guard:${key}`)}`;
}
export function goldenId(orgId: string, appKey: string, n: number): string {
  return `gc_${hash12(`${orgId}:golden:${appKey}:${n}`)}`;
}
export function evalRunId(orgId: string, appKey: string, n: number): string {
  return `eval_${hash12(`${orgId}:evalrun:${appKey}:${n}`)}`;
}
export function collectionId(orgId: string, key: string): string {
  return `kc_${hash12(`${orgId}:coll:${key}`)}`;
}
export function knowledgeDocId(orgId: string, collKey: string, docKey: string): string {
  return `kd_${hash12(`${orgId}:doc:${collKey}:${docKey}`)}`;
}
export function teamId(orgId: string, key: string): string {
  return `team_${hash12(`${orgId}:team:${key}`)}`;
}

/** Generic idempotent split: which specs (by deterministic id) are missing vs already present. */
export function planById<T>(
  specs: readonly T[],
  idOf: (spec: T) => string,
  existingIds: readonly string[],
): { toCreate: T[]; present: T[] } {
  const have = new Set(existingIds);
  const toCreate: T[] = [];
  const present: T[] = [];
  for (const s of specs) (have.has(idOf(s)) ? present : toCreate).push(s);
  return { toCreate, present };
}

// ─── Runs — derive per-app run status list (done + awaiting_human) for Runs/Review ────────────────
/** Expand an app's run counts into an ordered status list. `done` runs first, then `awaiting_human`. */
export function runStatuses(spec: AppSpecSeed): string[] {
  const out: string[] = [];
  for (let i = 0; i < spec.runs.done; i++) out.push('done');
  for (let i = 0; i < spec.runs.awaitingReview; i++) out.push('awaiting_human');
  return out;
}

/** Total demo runs a profile seeds (across all apps) — used by tests + the report. */
export function totalRuns(profile: TenantProfile): number {
  return appsFor(profile).reduce((sum, a) => sum + a.runs.done + a.runs.awaitingReview, 0);
}

// ─── Viewer user (Access) — RBAC row; PASSWORD is a Keycloak/env concern, never stored here ───────
export interface ViewerUserSeed {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string;
}
export const VIEWER_ROLE = 'viewer'; // the read-only role another agent defines; referenced by name.
/** The env var the Keycloak provisioning reads for the viewer password (NOT a value in git). */
export const VIEWER_PASSWORD_ENV = 'DEMO_VIEWER_PASSWORD';

export function viewerUser(profile: TenantProfile): ViewerUserSeed {
  return {
    id: `usr_${hash12(`viewer:${profile.orgId}`)}`,
    email: profile.viewerEmail,
    name: profile.viewerName,
    role: VIEWER_ROLE,
    orgId: profile.orgId,
  };
}

export function planViewerUser(
  profile: TenantProfile,
  existingEmails: readonly string[],
): { create: ViewerUserSeed | null; present: boolean } {
  const spec = viewerUser(profile);
  const taken = new Set(existingEmails.map((e) => e.trim().toLowerCase()));
  if (taken.has(spec.email.toLowerCase())) return { create: null, present: true };
  return { create: spec, present: false };
}

// ─── Convenience re-export for the emitter to derive gateway egress class from kind ───────────────
export function gatewayEgress(kind: GatewayKind): ReturnType<typeof egressClassFor> {
  return egressClassFor(kind);
}
