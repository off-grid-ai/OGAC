#!/usr/bin/env node
// ─── Tour-worthy demo seed EMITTER (Phase 2.2/2.3) ────────────────────────────────────────────────
// Emit idempotent SQL that populates EVERY console tour surface for the two public-demo tenants so
// each reads as a real, populated Indian-BFSI enterprise:
//   • mock BANK    → org_bharat   (Bharat Union)   — bank use cases
//   • mock INSURER → org_suraksha (Suraksha Life)  — insurer use cases
//
// Surfaces filled (console Postgres `offgrid_console`):
//   apps (Studio) · app_runs (Runs/Review, done + awaiting_human) · custom_agents (Studio agents) ·
//   agent_runs (agent traces) · governance_items (Governance) · guardrails_rules (Guardrails) ·
//   compliance_adoption (Regulatory coverage) · golden_cases + eval_runs (Evals + Drift history) ·
//   org_knowledge_collections + org_knowledge_docs (Brain) · teams + team_members (Access) ·
//   user (a read-only VIEWER per tenant).
//
// SOURCE OF TRUTH: src/lib/tour-demo-seed.ts (pure spec + planners, unit-tested). JS can't import the
// TS source, so the spec is MIRRORED here and MUST stay in lock-step with it (same as
// seed-bfsi-demo.mjs mirrors bfsi-app-pipeline-map.ts). Deterministic FNV ids ⇒ idempotent.
//
// Usage (on S1; git is broken on the server → pipe into the pg client, per deploy/DEPLOY.md):
//   ORG=org_bharat   node deploy/onprem/seed-tour-demo.mjs | docker exec -i <pg> psql -U offgrid -d offgrid_console
//   ORG=org_suraksha node deploy/onprem/seed-tour-demo.mjs | docker exec -i <pg> psql -U offgrid -d offgrid_console
//   (omit ORG to emit BOTH tenants in one transaction)
//
// The read-only VIEWER user's PASSWORD is a Keycloak concern, sourced from env DEMO_VIEWER_PASSWORD —
// NEVER a literal in git. This script only writes the console-DB `user` row (RBAC + tenant binding);
// provision the Keycloak credential separately (see the report / SERVER_STATE).
//
// NOTE (analytics/FinOps): the Insights + FinOps charts read GATEWAY TELEMETRY from OpenSearch (index
// offgrid-gateway), NOT this DB. That's a separate data-plane step (a telemetry backfill) — this
// emitter honestly does not fake it. Drift + regulatory coverage DERIVE from eval_runs + adoption,
// which ARE seeded here, so those bars/charts render real numbers.

// ─── Deterministic id (FNV-1a → 12 hex). MIRRORS tour-demo-seed.ts hash12. ────────────────────────
function hash12(s) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0').slice(0, 12);
}
const appId = (org, k) => `app_${hash12(`${org}:app:${k}`)}`;
const appRunId = (org, k, n) => `run_${hash12(`${org}:run:${k}:${n}`)}`;
const customAgentId = (org, k) => `ca_${hash12(`${org}:agent:${k}`)}`;
const agentRunId = (org, k, n) => `ar_${hash12(`${org}:agentrun:${k}:${n}`)}`;
const governanceId = (org, k) => `gov_${hash12(`${org}:gov:${k}`)}`;
const guardrailId = (org, k) => `gr_${hash12(`${org}:guard:${k}`)}`;
const goldenId = (org, k, n) => `gc_${hash12(`${org}:golden:${k}:${n}`)}`;
const evalRunId = (org, k, n) => `eval_${hash12(`${org}:evalrun:${k}:${n}`)}`;
const collectionId = (org, k) => `kc_${hash12(`${org}:coll:${k}`)}`;
const knowledgeDocId = (org, ck, dk) => `kd_${hash12(`${org}:doc:${ck}:${dk}`)}`;
const teamId = (org, k) => `team_${hash12(`${org}:team:${k}`)}`;
const viewerUserId = (org) => `usr_${hash12(`viewer:${org}`)}`;
// A pipeline seeded by pipelines-seed.ts is `pl_seed_<org>_<key>`; map by NAME → key.
const PIPELINE_KEY_BY_NAME = {
  'Reimbursement Governance': 'reimbursement-governance',
  'Motor-Claim FNOL': 'motor-claim-fnol',
  'Loan Underwriting': 'loan-underwriting',
  'KYC Verification': 'kyc-verification',
  'Fraud Screening': 'fraud-screening',
  'Cross-Sell Advisor': 'cross-sell-advisor',
};
const pipelineId = (org, name) => {
  const key = PIPELINE_KEY_BY_NAME[name];
  return key ? `pl_seed_${org}_${key}` : null;
};

// ─── SQL helpers ──────────────────────────────────────────────────────────────────────────────
function qq(s) { return `'${String(s).replace(/'/g, "''")}'`; }
function jb(o) { return `${qq(JSON.stringify(o))}::jsonb`; }

// ─── Spec MIRROR (kept in lock-step with src/lib/tour-demo-seed.ts) ───────────────────────────────
const q = (label, domain) => ({ kind: 'connector-query', label, domain, op: 'read' });
const ag = (label, systemPrompt) => ({ kind: 'agent', label, systemPrompt });
const hu = (label) => ({ kind: 'human', label });
const out = (label) => ({ kind: 'output', label, sink: 'report' });

const BANK = {
  name: 'Bharat Union',
  apps: [
    { key: 'kyc-rekyc', title: 'KYC & Re-KYC Verification', summary: 'Onboarding / periodic Re-KYC — read the customer OVDs, verify PAN and masked-Aadhaar consistency, screen PEP/UAPA, flag mismatches for manual review per the RBI Master Direction.', pipelineName: 'KYC Verification', steps: [q('Read the customer & submitted OVDs', 'customer data'), ag('Verify KYC per RBI Master Direction', 'Check that name, PAN and address match across the OVDs; PAN is mandatory. Aadhaar must be handled masked. Screen PEP/UAPA. Route any mismatch to manual review. Cite the policy.'), hu('Compliance review'), out('KYC verdict (verified / manual-review)')], runs: { done: 7, awaitingReview: 2 } },
    { key: 'loan-underwriting', title: 'Personal Loan Underwriting Assist', summary: 'Personal-loan eligibility — pull the applicant and their transactions, compute FOIR and check CIBIL/income floors from policy, recommend approve/decline with reasons. Ticket ₹50k–₹40L.', pipelineName: 'Loan Underwriting', steps: [q('Pull the applicant', 'customer data'), q('Pull 6-month bank statement', 'transactions'), ag('Assess eligibility (FOIR, CIBIL, income)', 'Compute FOIR after the new EMI and check CIBIL and income floors. Recommend approve, decline, or refer-to-senior with the reason and policy clause. All amounts in ₹.'), hu('Credit officer decision'), out('Underwriting recommendation')], runs: { done: 9, awaitingReview: 3 } },
    { key: 'fraud-screening', title: 'Fraud Screening', summary: 'Transaction fraud screening — score UPI/NEFT/IMPS transactions against behavioural patterns; transaction data stays on the box, high-risk cases route for analyst review.', pipelineName: 'Fraud Screening', steps: [q('Pull the transaction & customer', 'transactions'), ag('Score fraud risk', 'Score the transaction for fraud against velocity, geolocation and beneficiary patterns. Explain the drivers. Flag anything above the risk threshold for analyst review. Amounts in ₹.'), hu('Fraud analyst review'), out('Fraud verdict + risk score')], runs: { done: 12, awaitingReview: 2 } },
    { key: 'reimbursement', title: 'Reimbursement Approval', summary: "Employee reimbursement — read the invoice, check the employee's quota, decide eligibility, then approve/reject. PAN/bank details masked, everything on-prem. Amounts in ₹.", pipelineName: 'Reimbursement Governance', steps: [q('Read the invoice', 'invoices'), q("Check the employee's reimbursement quota", 'reimbursement quota'), ag('Decide eligibility', 'Given the invoice amount and the employee reimbursement quota, decide whether the employee is within quota and eligible. State the remaining quota and a clear recommendation. Amounts in ₹.'), hu('Approve or reject'), out('Reimbursement decision')], runs: { done: 6, awaitingReview: 1 } },
    { key: 'cross-sell', title: 'Cross-Sell Advisor', summary: 'Next-best-action for relationship managers — suggest products from the customer holding pattern; aggregate insights only, individual PII masked.', pipelineName: 'Cross-Sell Advisor', steps: [q('Pull the customer holdings', 'customer data'), ag('Recommend next best action', 'From the customer holding pattern, suggest the next-best product with a one-line rationale. Aggregate insights only — never expose individual PII. Amounts in ₹.'), out('Cross-sell recommendation')], runs: { done: 8, awaitingReview: 0 } },
    { key: 'fnol-triage', title: 'Motor Claim FNOL Triage', summary: 'Motor own-damage FNOL — read the policy & claim, check the vehicle is covered and premium paid, decide cashless vs surveyor, route for approval. Amounts in ₹.', pipelineName: 'Motor-Claim FNOL', steps: [q('Read the claim & policy', 'claims'), q('Look up the customer & vehicle', 'customer data'), ag('Decide cashless vs surveyor', 'Given the FNOL claim and in-force policy, decide cashless at a network garage vs a surveyor (mandatory above ₹1,00,000). Never approve if the licence was invalid at the time of loss.'), hu('Claims officer approval'), out('Claim decision + audit note')], runs: { done: 5, awaitingReview: 2 } },
  ],
  agents: [
    { key: 'kyc-analyst', name: 'KYC Analyst', role: 'Compliance', description: 'Verifies OVDs and screens PEP/UAPA against the RBI Master Direction.', systemPrompt: 'You verify KYC documents against the RBI KYC Master Direction. PAN mandatory; Aadhaar masked. Cite the clause.' },
    { key: 'credit-officer', name: 'Credit Officer', role: 'Lending', description: 'Computes FOIR and checks CIBIL/income floors for retail loans.', systemPrompt: 'You assess retail loan eligibility using FOIR, CIBIL and income floors. Amounts in ₹. State the decision and reason.' },
    { key: 'fraud-analyst', name: 'Fraud Analyst', role: 'Risk', description: 'Scores UPI/NEFT/IMPS transactions for fraud risk.', systemPrompt: 'You score transactions for fraud against velocity, geo and beneficiary patterns. Explain the drivers. Amounts in ₹.' },
    { key: 'rm-advisor', name: 'RM Advisor', role: 'Sales', description: 'Suggests next-best-action products from the customer holding pattern.', systemPrompt: 'You suggest the next-best product from the customer holdings with a one-line rationale. Aggregate only; mask PII.' },
  ],
  teams: [
    { key: 'risk', name: 'Risk & Fraud', department: 'Risk', description: 'Owns fraud screening and credit-risk governance.' },
    { key: 'compliance', name: 'Compliance', department: 'Compliance', description: 'Owns KYC/AML and regulatory adoption.' },
    { key: 'lending', name: 'Retail Lending', department: 'Operations', description: 'Owns loan underwriting and disbursal workflows.' },
  ],
  knowledge: [
    { key: 'policies', name: 'BFSI Policies & SOPs', description: 'RBI-aligned KYC, lending and claims standard operating procedures.', docs: [
      { key: 'kyc', name: 'KYC & Periodic Re-KYC Policy (RBI Master Direction)' },
      { key: 'lending', name: 'Personal Loan Underwriting Guidelines' },
      { key: 'fnol', name: 'Motor Claim FNOL SOP (IRDAI-aligned)' },
    ] },
  ],
};

const INSURER = {
  name: 'Suraksha Life',
  apps: [
    { key: 'fnol-motor', title: 'Motor-Claim FNOL Intake', summary: 'First Notice of Loss intake — read the claim & policy, confirm cover and premium paid, decide cashless vs surveyor, route for approval. Policyholder PII never leaves the network. Amounts in ₹.', pipelineName: 'Motor-Claim FNOL', steps: [q('Read the FNOL claim', 'claims'), q('Check the policy is in force', 'policies'), ag('Decide cashless vs surveyor', 'Given the FNOL claim and in-force policy, decide cashless vs a mandatory surveyor (above ₹1,00,000). Cite the SOP. Never approve if the licence was invalid at the time of loss.'), hu('Claims officer approval'), out('Claim decision + audit note')], runs: { done: 8, awaitingReview: 3 } },
    { key: 'policy-underwriting', title: 'Policy Underwriting Assist', summary: 'Life-policy underwriting — read the proposal & rate card, assess sum-assured vs income and medical risk, recommend standard/loaded/decline per the OYRT rate card. Amounts in ₹.', pipelineName: 'Loan Underwriting', steps: [q('Read the proposal', 'policies'), q('Pull the OYRT rate card', 'pricing rate card'), ag('Assess underwriting decision', 'Assess sum-assured vs declared income and medical risk against the OYRT rate card. Recommend standard, loaded (with the loading %), or decline, with the reason. Amounts in ₹.'), hu('Underwriter decision'), out('Underwriting recommendation')], runs: { done: 7, awaitingReview: 2 } },
    { key: 'claims-triage', title: 'Death-Claim Assessment', summary: 'Death-claim assessment — read the claim documents, cross-check the policy and premium history, flag early-claim / non-disclosure risk for investigation. Amounts in ₹.', pipelineName: 'Fraud Screening', steps: [q('Read the claim documents', 'claim documents'), q('Check premium & persistency', 'premiums'), ag('Assess claim risk', 'Cross-check the death claim against the policy in-force date and premium history. Flag early-claim (within 3 years), non-disclosure or fraud-risk indicators for investigation, else fast-track. Amounts in ₹.'), hu('Claims committee review'), out('Claim assessment + risk flag')], runs: { done: 6, awaitingReview: 2 } },
    { key: 'renewal-persistency', title: 'Renewal & Persistency Nudge', summary: 'Renewal persistency — read the premium ledger, identify lapse-risk policies nearing the grace-period end, recommend a retention action per the advisor.', pipelineName: 'Cross-Sell Advisor', steps: [q('Read the premium ledger', 'premiums'), ag('Recommend a retention action', 'Identify policies nearing grace-period end at lapse risk. Recommend the retention action (advisor call, auto-debit setup, part-payment). Aggregate insights only — mask individual PII. Amounts in ₹.'), out('Persistency action list')], runs: { done: 9, awaitingReview: 0 } },
    { key: 'grievance', title: 'Grievance Resolution Assist', summary: 'Grievance handling — read the helpdesk case, classify by IRDAI category, draft a compliant resolution for a service officer to approve.', pipelineName: 'KYC Verification', steps: [q('Read the helpdesk case', 'helpdesk cases'), ag('Classify & draft a resolution', 'Classify the grievance by IRDAI category and draft a compliant, empathetic resolution referencing the policy terms. Route to a service officer for approval. Never send automatically.'), hu('Service officer approval'), out('Grievance resolution draft')], runs: { done: 5, awaitingReview: 2 } },
    { key: 'reimbursement', title: 'Reimbursement Approval', summary: "Employee reimbursement — read the invoice, check the employee's quota, decide eligibility, then approve/reject. PAN/bank details masked, everything on-prem. Amounts in ₹.", pipelineName: 'Reimbursement Governance', steps: [q("Check the employee's reimbursement quota", 'reimbursement quota'), ag('Decide eligibility', 'Given the claim amount and the employee reimbursement quota, decide whether the employee is within quota and eligible. State the remaining quota and a clear recommendation. Amounts in ₹.'), hu('Approve or reject'), out('Reimbursement decision')], runs: { done: 6, awaitingReview: 1 } },
  ],
  agents: [
    { key: 'claims-assessor', name: 'Claims Assessor', role: 'Claims', description: 'Assesses death claims against policy in-force date and premium history.', systemPrompt: 'You assess death claims for early-claim and non-disclosure risk against the policy and premium history. Amounts in ₹.' },
    { key: 'underwriter', name: 'Underwriter', role: 'Underwriting', description: 'Assesses life proposals against the OYRT rate card.', systemPrompt: 'You underwrite life proposals against the OYRT rate card: standard, loaded (with %), or decline, with reason. Amounts in ₹.' },
    { key: 'persistency-advisor', name: 'Persistency Advisor', role: 'Retention', description: 'Flags lapse-risk policies and recommends retention actions.', systemPrompt: 'You flag policies near grace-period end and recommend retention actions. Aggregate only; mask PII. Amounts in ₹.' },
    { key: 'grievance-officer', name: 'Grievance Officer', role: 'Service', description: 'Classifies grievances by IRDAI category and drafts resolutions.', systemPrompt: 'You classify grievances by IRDAI category and draft compliant, empathetic resolutions. Route for approval; never auto-send.' },
  ],
  teams: [
    { key: 'claims', name: 'Claims', department: 'Operations', description: 'Owns FNOL, death-claim assessment and settlement.' },
    { key: 'underwriting', name: 'Underwriting', department: 'Risk', description: 'Owns policy underwriting and the OYRT rate card.' },
    { key: 'service', name: 'Policyholder Service', department: 'Service', description: 'Owns grievance redressal and renewals.' },
  ],
  knowledge: [
    { key: 'policies', name: 'Insurance Policies & SOPs', description: 'IRDAI-aligned underwriting, claims and grievance standard operating procedures.', docs: [
      { key: 'underwriting', name: 'Life Underwriting OYRT Rate Card Guide' },
      { key: 'claims', name: 'Death-Claim Assessment SOP' },
      { key: 'grievance', name: 'Grievance Redressal Policy (IRDAI)' },
    ] },
  ],
};

// Shared governance, guardrails, adoption (identical for both tenants — a common BFSI governance posture).
const GOVERNANCE = [
  { key: 'ai-policy', kind: 'policy', title: 'Responsible AI Policy', owner: 'Chief Risk Officer', status: 'active', detail: 'Board-approved AI-usage policy: on-prem-first, human-in-the-loop for customer-impacting decisions, no PII egress.' },
  { key: 'raci', kind: 'raci', title: 'AI Governance RACI', owner: 'AI Governance Council', status: 'active', detail: 'Accountability matrix across Risk, Compliance, Data and Engineering for every governed pipeline.' },
  { key: 'ethics', kind: 'ethics_review', title: 'Model Ethics Review — Q2', owner: 'Ethics Committee', status: 'active', detail: 'Quarterly review of fairness, bias and adverse-action explainability across live use cases.' },
  { key: 'dpia', kind: 'impact_assessment', title: 'DPIA — Customer-Facing AI', owner: 'Data Protection Officer', status: 'active', detail: 'DPDP-Act-aligned data-protection impact assessment for the customer-facing governed apps.' },
  { key: 'training', kind: 'training', title: 'Staff AI-Literacy Training', owner: 'L&D', status: 'due', detail: 'Annual AI-literacy + responsible-use training for all operators. Renewal due this quarter.' },
  { key: 'vendor', kind: 'vendor', title: 'Cloud-Model Vendor Assessment', owner: 'Vendor Risk', status: 'active', detail: 'Assessment of the cloud model providers permitted by the egress leash (data-processing terms, region).' },
  { key: 'drill', kind: 'drill', title: 'AI Incident-Response Drill', owner: 'CISO', status: 'due', detail: 'Tabletop drill for an AI-incident (prompt-injection, data-exfil attempt). Next drill scheduled.' },
];
const GUARDRAILS = [
  { key: 'pan', matcher: 'regex', pattern: '[A-Z]{5}[0-9]{4}[A-Z]', action: 'mask', label: 'Mask PAN numbers' },
  { key: 'aadhaar', matcher: 'regex', pattern: '\\b\\d{4}\\s?\\d{4}\\s?\\d{4}\\b', action: 'redact', label: 'Redact Aadhaar numbers' },
  { key: 'ifsc', matcher: 'regex', pattern: '[A-Z]{4}0[A-Z0-9]{6}', action: 'mask', label: 'Mask IFSC codes' },
  { key: 'email', matcher: 'entity', pattern: 'EMAIL_ADDRESS', action: 'mask', label: 'Mask email addresses' },
  { key: 'phone', matcher: 'entity', pattern: 'PHONE_NUMBER', action: 'mask', label: 'Mask phone numbers' },
  { key: 'injection', matcher: 'regex', pattern: 'ignore (all )?previous instructions', action: 'block', label: 'Block prompt-injection attempts' },
];
const ADOPTION = [
  { framework: 'iso-42001', control: 'iso-a2-ai-policy', status: 'met' },
  { framework: 'iso-42001', control: 'iso-a3-roles', status: 'met' },
  { framework: 'iso-42001', control: 'iso-a5-impact-assessment', status: 'met' },
  { framework: 'iso-42001', control: 'iso-a7-data-governance', status: 'met' },
  { framework: 'iso-42001', control: 'iso-a9-human-oversight', status: 'in-progress' },
  { framework: 'iso-42001', control: 'iso-a8-transparency', status: 'in-progress' },
  { framework: 'nist-ai-rmf', control: 'nist-govern-1-1', status: 'met' },
  { framework: 'nist-ai-rmf', control: 'nist-govern-2-1', status: 'met' },
  { framework: 'nist-ai-rmf', control: 'nist-map-1-1', status: 'met' },
  { framework: 'nist-ai-rmf', control: 'nist-measure-2-1', status: 'in-progress' },
  { framework: 'nist-ai-rmf', control: 'nist-manage-2-1', status: 'in-progress' },
  { framework: 'eu-ai-act', control: 'eu-risk-tier', status: 'met' },
  { framework: 'eu-ai-act', control: 'eu-art-9-risk-mgmt', status: 'met' },
  { framework: 'eu-ai-act', control: 'eu-art-14-oversight', status: 'in-progress' },
  { framework: 'eu-ai-act', control: 'eu-art-13-transparency', status: 'in-progress' },
];

const PROFILES = {
  org_bharat: { flavour: 'bank', slug: 'bharatunion', viewerEmail: 'viewer@bharatunion.demo', viewerName: 'Bharat Union — Demo Viewer', ...BANK },
  org_suraksha: { flavour: 'insurer', slug: 'suraksha', viewerEmail: 'viewer@suraksha.demo', viewerName: 'Suraksha Life — Demo Viewer', ...INSURER },
};

// ─── SQL generation for one org ───────────────────────────────────────────────────────────────
function emitOrg(org, L) {
  const p = PROFILES[org];
  if (!p) { throw new Error(`unknown org ${org} (expected org_bharat | org_suraksha)`); }

  // Guard: self-migrating tables must exist before we insert (mirrors the app's ensure* functions).
  L.push(`-- ${p.name} (${org}) — ensure the self-migrating tour tables exist, then upsert.`);
  L.push(`CREATE TABLE IF NOT EXISTS guardrails_rules (id text PRIMARY KEY, org_id text NOT NULL DEFAULT 'default', matcher text NOT NULL, pattern text NOT NULL, action text NOT NULL, label text NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());`);
  L.push(`CREATE TABLE IF NOT EXISTS compliance_adoption (org_id text NOT NULL, framework_id text NOT NULL, control_id text NOT NULL, status text NOT NULL DEFAULT 'new', updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (org_id, control_id));`);
  L.push(`CREATE TABLE IF NOT EXISTS org_knowledge_collections (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', allowed_roles jsonb NOT NULL DEFAULT '[]'::jsonb, created_by text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());`);
  L.push(`ALTER TABLE org_knowledge_collections ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`);
  L.push(`CREATE TABLE IF NOT EXISTS org_knowledge_docs (id text PRIMARY KEY, collection_id text NOT NULL, name text NOT NULL, kind text NOT NULL DEFAULT 'text', size integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());`);

  // ── Apps (Studio) + their runs (Runs/Review) ──
  L.push(`-- Apps + runs for ${org}.`);
  for (const a of p.apps) {
    const id = appId(org, a.key);
    const steps = a.steps.map((s, i) => ({ id: `s${i + 1}`, ...s }));
    const edges = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id }));
    const plId = pipelineId(org, a.pipelineName);
    const slug = a.key;
    L.push(
      `INSERT INTO apps (id, org_id, owner_id, title, summary, visibility, pipeline_id, slug, published, trigger, steps, edges, created_at, updated_at) VALUES (` +
        `${qq(id)}, ${qq(org)}, ${qq('seed')}, ${qq(a.title)}, ${qq(a.summary)}, ${qq('org')}, ${plId ? qq(plId) : 'NULL'}, ${qq(slug)}, true, ` +
        `${jb({ kind: 'on-demand' })}, ${jb(steps)}, ${jb(edges)}, now(), now()) ` +
        `ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, pipeline_id = EXCLUDED.pipeline_id, ` +
        `steps = EXCLUDED.steps, edges = EXCLUDED.edges, published = true, updated_at = now();`,
    );
    // Runs: `done` first, then `awaiting_human` (so both Runs and Review populate). SHADOW-safe.
    let n = 0;
    const emitRun = (status) => {
      const runId = appRunId(org, a.key, n);
      const runSteps = steps.map((s) => ({
        id: s.id, kind: s.kind, label: s.label,
        status: status === 'awaiting_human' && s.kind === 'human' ? 'awaiting_human' : (status === 'done' ? 'done' : 'pending'),
      }));
      const outcome = status === 'done' ? `${a.title}: completed (see report).` : '';
      const finished = status === 'done' ? 'now()' : 'NULL';
      L.push(
        `INSERT INTO app_runs (id, org_id, app_id, status, trigger, input, steps, outcome, started_at, finished_at) VALUES (` +
          `${qq(runId)}, ${qq(org)}, ${qq(id)}, ${qq(status)}, ${jb({ kind: 'on-demand' })}, ${jb({})}, ${jb(runSteps)}, ${qq(outcome)}, ` +
          `now() - (interval '1 hour' * ${n + 1}), ${finished}) ` +
          `ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, steps = EXCLUDED.steps, outcome = EXCLUDED.outcome, finished_at = EXCLUDED.finished_at;`,
      );
      n++;
    };
    for (let i = 0; i < a.runs.done; i++) emitRun('done');
    for (let i = 0; i < a.runs.awaitingReview; i++) emitRun('awaiting_human');

    // ── Evals + golden set (Evals + Drift history) — one small golden set + a few eval runs per app. ──
    if (plId) {
      const golden = [
        { qy: `Is this ${a.title.toLowerCase()} case eligible?`, ex: 'A grounded decision with the policy clause cited.' },
        { qy: 'What does the policy require here?', ex: 'The relevant BFSI policy requirement, in INR where applicable.' },
        { qy: 'Flag any PII that must be masked.', ex: 'PAN / Aadhaar / IFSC identified and masked.' },
      ];
      golden.forEach((g, gi) => {
        L.push(
          `INSERT INTO golden_cases (id, org_id, app_id, pipeline_id, query, expected, created_at) VALUES (` +
            `${qq(goldenId(org, a.key, gi))}, ${qq(org)}, ${qq(id)}, ${qq(plId)}, ${qq(g.qy)}, ${qq(g.ex)}, now()) ` +
            `ON CONFLICT (id) DO UPDATE SET query = EXCLUDED.query, expected = EXCLUDED.expected;`,
        );
      });
      // Eval-run history — a gentle downward score trend so Drift (PSI over eval history) is non-flat.
      const scores = [96, 94, 91, 88];
      scores.forEach((sc, si) => {
        const passed = Math.round((golden.length * sc) / 100);
        const results = golden.map((g) => ({ query: g.qy, expected: g.ex, pass: true, top: g.ex, score: sc / 100 }));
        L.push(
          `INSERT INTO eval_runs (id, org_id, pipeline_id, score, total, passed, results, started_at) VALUES (` +
            `${qq(evalRunId(org, a.key, si))}, ${qq(org)}, ${qq(plId)}, ${sc}, ${golden.length}, ${passed}, ${jb(results)}, ` +
            `now() - (interval '1 day' * ${scores.length - si})) ` +
            `ON CONFLICT (id) DO UPDATE SET score = EXCLUDED.score, passed = EXCLUDED.passed, results = EXCLUDED.results;`,
        );
      });
    }
  }

  // ── Custom agents (Studio agents) + a couple of agent runs each ──
  L.push(`-- Custom agents + agent-run traces for ${org}.`);
  for (const g of p.agents) {
    const aid = customAgentId(org, g.key);
    L.push(
      `INSERT INTO custom_agents (id, org_id, name, role, description, system_prompt, model, tools, grounded, trigger, enabled, created_at) VALUES (` +
        `${qq(aid)}, ${qq(org)}, ${qq(g.name)}, ${qq(g.role)}, ${qq(g.description)}, ${qq(g.systemPrompt)}, ${qq('')}, ${jb([])}, true, ${qq('on-demand')}, true, now()) ` +
        `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, description = EXCLUDED.description, system_prompt = EXCLUDED.system_prompt;`,
    );
    for (let i = 0; i < 2; i++) {
      const steps = [
        { kind: 'plan', label: 'Plan', detail: 'Decompose the request.', refs: [], ms: 40 },
        { kind: 'retrieve', label: 'Retrieve', detail: 'Ground against org knowledge.', refs: ['doc:policy'], ms: 120 },
        { kind: 'answer', label: 'Answer', detail: 'Grounded response with citation.', refs: [], ms: 220 },
      ];
      const checks = [
        { name: 'pii-mask', verdict: 'pass', ms: 8 },
        { name: 'grounding', verdict: 'pass', score: 0.93, ms: 15 },
      ];
      L.push(
        `INSERT INTO agent_runs (id, org_id, agent_id, query, answer, status, steps, checks, started_at) VALUES (` +
          `${qq(agentRunId(org, g.key, i))}, ${qq(org)}, ${qq(aid)}, ${qq(`${g.role} demo query #${i + 1}`)}, ` +
          `${qq(`${g.name} produced a grounded, policy-cited answer.`)}, ${qq('done')}, ${jb(steps)}, ${jb(checks)}, ` +
          `now() - (interval '2 hour' * ${i + 1})) ` +
          `ON CONFLICT (id) DO UPDATE SET answer = EXCLUDED.answer, steps = EXCLUDED.steps, checks = EXCLUDED.checks;`,
      );
    }
  }

  // ── Governance registry ──
  L.push(`-- Governance registry for ${org}.`);
  for (const gi of GOVERNANCE) {
    L.push(
      `INSERT INTO governance_items (id, org_id, kind, title, owner, status, detail, reviewed_at, created_at) VALUES (` +
        `${qq(governanceId(org, gi.key))}, ${qq(org)}, ${qq(gi.kind)}, ${qq(gi.title)}, ${qq(gi.owner)}, ${qq(gi.status)}, ${qq(gi.detail)}, ${qq('')}, now()) ` +
        `ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, owner = EXCLUDED.owner, status = EXCLUDED.status, detail = EXCLUDED.detail;`,
    );
  }

  // ── Guardrail rules ──
  L.push(`-- Guardrail rules for ${org}.`);
  for (const r of GUARDRAILS) {
    L.push(
      `INSERT INTO guardrails_rules (id, org_id, matcher, pattern, action, label, enabled, created_at) VALUES (` +
        `${qq(guardrailId(org, r.key))}, ${qq(org)}, ${qq(r.matcher)}, ${qq(r.pattern)}, ${qq(r.action)}, ${qq(r.label)}, true, now()) ` +
        `ON CONFLICT (id) DO UPDATE SET matcher = EXCLUDED.matcher, pattern = EXCLUDED.pattern, action = EXCLUDED.action, label = EXCLUDED.label, enabled = true;`,
    );
  }

  // ── Regulatory adoption (partial coverage) ──
  L.push(`-- Regulatory control adoption for ${org} (partial → non-zero coverage bars).`);
  for (const a of ADOPTION) {
    L.push(
      `INSERT INTO compliance_adoption (org_id, framework_id, control_id, status, updated_at) VALUES (` +
        `${qq(org)}, ${qq(a.framework)}, ${qq(a.control)}, ${qq(a.status)}, now()) ` +
        `ON CONFLICT (org_id, control_id) DO UPDATE SET status = EXCLUDED.status, framework_id = EXCLUDED.framework_id, updated_at = now();`,
    );
  }

  // ── Knowledge / Brain collections + docs ──
  L.push(`-- Knowledge collections + docs for ${org}.`);
  for (const c of p.knowledge) {
    const cid = collectionId(org, c.key);
    L.push(
      `INSERT INTO org_knowledge_collections (id, org_id, name, description, allowed_roles, created_by, created_at) VALUES (` +
        `${qq(cid)}, ${qq(org)}, ${qq(c.name)}, ${qq(c.description)}, ${jb([])}, ${qq('seed')}, now()) ` +
        `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, org_id = EXCLUDED.org_id;`,
    );
    for (const d of c.docs) {
      L.push(
        `INSERT INTO org_knowledge_docs (id, collection_id, name, kind, size, created_at) VALUES (` +
          `${qq(knowledgeDocId(org, c.key, d.key))}, ${qq(cid)}, ${qq(d.name)}, ${qq('text')}, 0, now()) ` +
          `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, collection_id = EXCLUDED.collection_id;`,
      );
    }
  }

  // ── Teams (Access) + the viewer as a member ──
  L.push(`-- Teams + viewer membership for ${org}.`);
  for (const t of p.teams) {
    L.push(
      `INSERT INTO teams (id, org_id, name, description, department, created_at, updated_at) VALUES (` +
        `${qq(teamId(org, t.key))}, ${qq(org)}, ${qq(t.name)}, ${qq(t.description)}, ${qq(t.department)}, now(), now()) ` +
        `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, department = EXCLUDED.department, updated_at = now();`,
    );
  }

  // ── Read-only VIEWER user (RBAC + tenant binding). Password is a Keycloak/env concern, NOT here. ──
  L.push(`-- Read-only demo VIEWER user for ${org} (password provisioned in Keycloak from $DEMO_VIEWER_PASSWORD).`);
  L.push(
    `INSERT INTO "user" (id, name, email, role, org_id) VALUES (` +
      `${qq(viewerUserId(org))}, ${qq(p.viewerName)}, ${qq(p.viewerEmail)}, ${qq('viewer')}, ${qq(org)}) ` +
      `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = 'viewer', org_id = EXCLUDED.org_id;`,
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────────────────────────
const only = process.env.ORG;
const orgs = only ? [only] : ['org_bharat', 'org_suraksha'];
const L = ['BEGIN;', '-- Tour-worthy demo seed (Phase 2.2/2.3). Idempotent: deterministic ids + ON CONFLICT upserts.'];
for (const org of orgs) emitOrg(org, L);
L.push('COMMIT;');
process.stdout.write(L.join('\n') + '\n');
