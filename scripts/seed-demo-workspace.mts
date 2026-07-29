// ─── Fill the empty demo surfaces: prompts, chat projects, templates, evals, policy rules ────────────
//
// The audit found these EMPTY in both demo tenants while the `default` org had content, so a walkthrough hit
// blank screens on surfaces that work perfectly well. Seeded with Indian-BFSI content matching each tenant, so
// the reader recognises the domain rather than reading lorem ipsum.
//
// Scoped to org_bharat and org_suraksha. Deterministic ids, so a re-run updates nothing and duplicates nothing.
//
// RUN: npx tsx scripts/seed-demo-workspace.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

type Tenant = {
  orgId: string;
  slug: string;
  viewer: string;
  prompts: { name: string; description: string }[];
  projects: { name: string; description: string; systemPrompt: string }[];
  templates: { title: string; summary: string; prompt: string }[];
  evals: { name: string; metric: string; description: string }[];
  policies: { name: string; description: string; attribute: string; value: string; effect: string }[];
};

const TENANTS: Tenant[] = [
  {
    orgId: 'org_bharat',
    slug: 'bharatunion',
    viewer: 'demo-bank@getoffgridai.co',
    prompts: [
      { name: 'Explain a CIBIL band to a customer', description: 'Plain-language explanation of a credit band and what improves it, with no advice that implies a guaranteed outcome.' },
      { name: 'Summarise a loan application', description: 'FOIR, income stability and obligations in six lines, for a credit officer skim.' },
      { name: 'Draft a KYC document request', description: 'Polite request for the specific missing OVD, naming exactly what is needed and why.' },
      { name: 'Explain a declined reimbursement', description: 'Why a claim fell outside policy, written so the employee can act on it.' },
      { name: 'Flag a suspicious transaction pattern', description: 'Describe the pattern and the reason for review without asserting fraud.' },
    ],
    projects: [
      { name: 'Retail lending queries', description: 'Day-to-day questions from the lending desk.', systemPrompt: 'Answer only from approved bank policy and the customer records provided. Never state an approval decision — surface the criteria and the gaps.' },
      { name: 'Collections scripts', description: 'Compliant customer contact language.', systemPrompt: 'Follow RBI fair-practices language. Never threaten, never imply legal action that has not been authorised.' },
      { name: 'Branch operations help', description: 'Process questions from branch staff.', systemPrompt: 'Cite the operations circular you relied on. If the circular does not cover it, say so.' },
    ],
    templates: [
      { title: 'Weekly delinquency digest', summary: 'Overdue accounts grouped by days-past-due with a suggested contact order.', prompt: 'Every Monday, list accounts past due, group them by 0-30 / 31-60 / 61-90 days, and suggest a contact order with reasons.' },
      { title: 'New-customer onboarding check', summary: 'Verify a new account against KYC requirements and flag what is missing.', prompt: 'When a new account is opened, check the KYC documents on file, list what is missing, and draft the request to the customer.' },
    ],
    evals: [
      { name: 'Answers cite a bank policy', metric: 'faithfulness', description: 'A lending answer must be traceable to approved policy, not invented.' },
      { name: 'No guaranteed-outcome language', metric: 'answer_relevancy', description: 'Never implies an approval or rate is assured.' },
      { name: 'PAN and account numbers stay masked', metric: 'faithfulness', description: 'No unmasked identifier reaches a customer-facing answer.' },
    ],
    policies: [
      { name: 'No customer data to cloud models', description: 'Customer records stay on-prem regardless of which model is routed to.', attribute: 'data_class', value: 'customer', effect: 'deny' },
      { name: 'Loan decisions need a human', description: 'A credit decision above the threshold always pauses for an officer.', attribute: 'action', value: 'credit_decision', effect: 'review' },
      { name: 'Mask PAN in every output', description: 'PAN is masked before an answer leaves the pipeline.', attribute: 'pii_type', value: 'PAN', effect: 'mask' },
    ],
  },
  {
    orgId: 'org_suraksha',
    slug: 'suraksha',
    viewer: 'demo-insurer@getoffgridai.co',
    prompts: [
      { name: 'Explain a claim decision to a nominee', description: 'Why a claim was settled at that amount, in language a grieving family can follow.' },
      { name: 'Summarise a policy proposal', description: 'Sum assured, medical risk and income multiple in six lines for an underwriter.' },
      { name: 'Draft a renewal reminder', description: 'Warm reminder naming the lapse date and what cover is lost.' },
      { name: 'Acknowledge a grievance', description: 'Acknowledge, state the resolution timeline, never pre-judge the outcome.' },
      { name: 'Explain an early-claim review', description: 'Why a claim within the contestability window needs extra checks.' },
    ],
    projects: [
      { name: 'Claims desk queries', description: 'Questions from claims assessors.', systemPrompt: 'Answer only from the policy wording and claim documents provided. Never state a settlement decision — surface the criteria and the gaps.' },
      { name: 'Underwriting guidance', description: 'Risk questions from underwriters.', systemPrompt: 'Cite the rate card or underwriting manual you relied on. If it does not cover the case, say so.' },
      { name: 'Policyholder service', description: 'Front-line service language.', systemPrompt: 'Be warm and precise. Never imply a claim outcome that has not been decided.' },
    ],
    templates: [
      { title: 'Persistency watchlist', summary: 'Policies approaching lapse with the value at risk and a suggested nudge.', prompt: 'Each week, list policies within 30 days of lapse, show the premium at risk, and draft a nudge for each.' },
      { title: 'Early-claim review pack', summary: 'Assemble the checks a claim inside the contestability window needs.', prompt: 'For a claim within the contestability window, list the checks required, gather what is on file, and flag what is missing.' },
    ],
    evals: [
      { name: 'Answers cite the policy wording', metric: 'faithfulness', description: 'A claims answer must be traceable to the policy document.' },
      { name: 'No settlement promised', metric: 'answer_relevancy', description: 'Never implies a claim will be paid before it is decided.' },
      { name: 'Nominee details stay masked', metric: 'faithfulness', description: 'No unmasked identifier reaches an outbound message.' },
    ],
    policies: [
      { name: 'No claim documents to cloud models', description: 'Claim documents stay on-prem regardless of routing.', attribute: 'data_class', value: 'claim_documents', effect: 'deny' },
      { name: 'Death claims need a human', description: 'A death-claim assessment always pauses for an assessor.', attribute: 'action', value: 'death_claim', effect: 'review' },
      { name: 'Mask Aadhaar in every output', description: 'Aadhaar is masked before an answer leaves the pipeline.', attribute: 'pii_type', value: 'AADHAAR', effect: 'mask' },
    ],
  },
];

/** Deterministic short id, so a re-run collides with itself instead of duplicating. */
function sid(prefix: string, key: string): string {
  let h = 2166136261;
  for (const ch of key) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${prefix}_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

for (const t of TENANTS) {
  let counts = { prompts: 0, projects: 0, templates: 0, evals: 0, policies: 0 };

  for (const p of t.prompts) {
    await db.execute(sql`
      INSERT INTO prompts (id, name, description, org_id)
      VALUES (${sid('prm', t.orgId + p.name)}, ${p.name}, ${p.description}, ${t.orgId})
      ON CONFLICT (id) DO NOTHING`);
    counts.prompts += 1;
  }

  for (const p of t.projects) {
    await db.execute(sql`
      INSERT INTO chat_projects (id, user_id, name, description, system_prompt, org_id)
      VALUES (${sid('cpj', t.orgId + p.name)}, ${t.viewer}, ${p.name}, ${p.description}, ${p.systemPrompt}, ${t.orgId})
      ON CONFLICT (id) DO NOTHING`);
    counts.projects += 1;
  }

  for (const s of t.templates) {
    await db.execute(sql`
      INSERT INTO studio_templates (id, org_id, owner_id, title, summary, prompt, workflow)
      VALUES (${sid('stpl', t.orgId + s.title)}, ${t.orgId}, ${t.viewer}, ${s.title}, ${s.summary}, ${s.prompt}, ${JSON.stringify({ steps: [] })}::jsonb)
      ON CONFLICT (id) DO NOTHING`);
    counts.templates += 1;
  }

  for (const e of t.evals) {
    await db.execute(sql`
      INSERT INTO eval_definitions (id, name, metric, engine, description, org_id, threshold)
      VALUES (${sid('evd', t.orgId + e.name)}, ${e.name}, ${e.metric}, ${'ragas'}, ${e.description}, ${t.orgId}, ${0.8})
      ON CONFLICT (id) DO NOTHING`);
    counts.evals += 1;
  }

  for (const r of t.policies) {
    await db.execute(sql`
      INSERT INTO policy_rules (id, org_id, name, description, attribute, value, effect)
      VALUES (${sid('pol', t.orgId + r.name)}, ${t.orgId}, ${r.name}, ${r.description}, ${r.attribute}, ${r.value}, ${r.effect})
      ON CONFLICT (id) DO NOTHING`);
    counts.policies += 1;
  }

  console.log(
    `${t.orgId}: ${counts.prompts} prompts · ${counts.projects} chat projects · ${counts.templates} studio templates · ${counts.evals} evals · ${counts.policies} policy rules`,
  );
}
