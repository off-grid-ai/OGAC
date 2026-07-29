// ─── Make the reimbursement apps read the CASE they were given ────────────────────────────────────────
//
// The app was incoherent, and it showed: step 1 read the ERP's vendor invoices (a table with no employee in
// it), step 2 read the employee quota table, and neither read was scoped to anything. The agent got twenty
// unrelated invoices and twenty unrelated employees and — correctly — reported it could not decide. The
// approver then saw "NOT ELIGIBLE" with reasoning about missing data.
//
// This rewires both tenants' Reimbursement Approval apps onto the real entity (an employee expense claim,
// seeded next to the quota it is checked against) and scopes every read to the case with the filter
// placeholders the engine now applies:
//
//   params: { employee_id: '{{case.employee_id}}' }   → WHERE employee_id = <the case's employee>
//
// It also closes the trap that cost a previous session two wrong theories: a step may only read a domain the
// bound pipeline's data_allowlist admits (a HARD ceiling). So the allowlist is widened, in the same script,
// to exactly the domains these apps read — no wider.
//
// Idempotent: re-running rewrites the same spec and re-adds nothing.
//
// RUN (on the server): npx tsx scripts/rewire-reimbursement-apps.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { createDomain, listDomains } from '../src/lib/data-domains-store.ts';
import { getApp, updateApp } from '../src/lib/apps-store.ts';
import type { AppStep } from '../src/lib/app-model.ts';

type Wiring = {
  orgId: string;
  appId: string;
  /** Connector holding both the claims and the quota table. */
  connectorId: string;
  /** Existing quota domain in this tenant. */
  quotaDomainId: string;
  /** Quota is per employee AND category (bank) or one pool per employee (insurer). */
  quotaFilters: Record<string, string>;
  agentPrompt: string;
};

const WIRINGS: Wiring[] = [
  {
    orgId: 'org_bharat',
    appId: 'bhapp_reimb',
    connectorId: 'con_f5c959',
    quotaDomainId: 'dom_11452ea6-53c',
    // The bank's quota is entitlement PER CATEGORY, so a Travel claim must be checked against the
    // Travel line — filtering by employee alone would compare against whichever row came back first.
    quotaFilters: { employee_id: '{{case.employee_id}}', category: '{{case.category}}' },
    agentPrompt: [
      'You are checking one employee expense claim against that employee’s remaining reimbursement quota.',
      '',
      'The first source is the claim: employee, category, purpose and amount. The second is that employee’s',
      'quota line for the same category: annual entitlement, used, and remaining.',
      '',
      'Say whether the claim fits inside the remaining quota. State the claim amount, the remaining quota,',
      'and then EITHER the headroom (if it fits) OR the shortfall (if it does not) — as a positive rupee',
      'figure on one line, never as an arithmetic expression or a negative number. All amounts are in',
      'Indian rupees (₹) — never write $ or USD.',
      '',
      'End with one line: "Recommendation: within quota — approve" or',
      '"Recommendation: exceeds remaining quota by ₹X — reject" (or "partially approve ₹Y" when the policy',
      'allows paying up to the remaining quota). Do not invent a policy rule that is not in the sources.',
    ].join('\n'),
  },
  {
    orgId: 'org_suraksha',
    appId: 'app_bc008a5a',
    connectorId: 'surcon_policyadmin',
    quotaDomainId: 'surdom_reimbursement_quota',
    // The insurer's quota is a single pool per employee — there is no category line to match.
    quotaFilters: { employee_id: '{{case.employee_id}}' },
    agentPrompt: [
      'You are checking one employee expense claim against that employee’s remaining reimbursement pool.',
      '',
      'The first source is the claim: employee, department, category, purpose and amount. The second is that',
      'employee’s quota record: annual pool (reimbursement_quota_inr), used (quota_used_inr) and remaining',
      '(quota_remaining_inr), plus the manager it escalates to.',
      '',
      'Say whether the claim fits inside the remaining pool. State the claim amount, the remaining pool, and',
      'then EITHER the headroom (if it fits) OR the shortfall (if it does not) — as a positive rupee figure',
      'on one line, never as an arithmetic expression or a negative number. All amounts are in Indian',
      'rupees (₹) — never write $ or USD.',
      '',
      'End with one line: "Recommendation: within pool — approve" or',
      '"Recommendation: exceeds remaining pool by ₹X — reject". Do not invent a policy rule that is not in',
      'the sources.',
    ].join('\n'),
  },
];

for (const w of WIRINGS) {
  const app = await getApp(w.appId, w.orgId);
  if (!app) {
    console.log(`${w.orgId}: app ${w.appId} not found — skipped`);
    continue;
  }

  // ── The claims domain, created once per tenant. ──
  const domains = await listDomains(w.orgId);
  let claims = domains.find(
    (d) => d.connectorId === w.connectorId && d.resource === 'expense_claims',
  );
  if (!claims) {
    claims = await createDomain(
      {
        label: 'expense claims',
        aliases: ['employee expense claims', 'reimbursement claims', 'expense claim'],
        connectorId: w.connectorId,
        resource: 'expense_claims',
        opHints: { limit: 20 },
      },
      w.orgId,
    );
    console.log(`${w.orgId}: created data domain ${claims.id} "expense claims"`);
  }

  const priorAgent = app.steps.find((s) => s.kind === 'agent') as { agentId?: string } | undefined;
  const existingAgentId = priorAgent?.agentId;

  // ── The spec: read THIS claim, read THAT employee's quota, decide, approve, report. ──
  const steps: AppStep[] = [
    {
      id: 's0',
      kind: 'connector-query',
      label: 'Read the expense claim',
      domain: claims.id,
      op: 'read',
      params: { id: '{{case.id}}' },
    },
    {
      id: 's1',
      kind: 'connector-query',
      label: "Check the employee's remaining quota",
      domain: w.quotaDomainId,
      op: 'read',
      params: w.quotaFilters,
    },
    {
      id: 's2',
      kind: 'agent',
      label: 'Decide eligibility',
      // Keep whichever governed agent the app already used — the entity-consumption chain
      // (app → pipeline → gateway → model) is established, and this script is not the place to change it.
      ...(existingAgentId ? { agentId: existingAgentId } : {}),
      inlineAgent: { grounded: true, systemPrompt: w.agentPrompt },
    } as AppStep,
    { id: 's3', kind: 'human', label: 'Approve or reject' },
    { id: 's4', kind: 'output', sink: 'report', label: 'Reimbursement decision' },
  ];

  // Write the edges WITH the steps: the two must agree. The insurer's app had four steps and three edges,
  // so writing a five-step spec against its old edge list left the report step with no inbound edge — the
  // validator called it a second entry point, which is exactly what it was.
  const edges = steps.slice(0, -1).map((step, index) => ({ from: step.id, to: steps[index + 1].id }));
  await updateApp(w.appId, w.orgId, { steps, edges });
  console.log(`${w.orgId}: rewired ${w.appId} — claim ${claims.id} + quota ${w.quotaDomainId}, case-scoped`);

  // ── The HARD ceiling: the bound pipeline must admit both domains, or the run is denied before the
  // connector is touched. Widened to exactly what these steps read.
  if (app.pipelineId) {
    const needed = [claims.id, w.quotaDomainId];
    const rows = (await db.execute(sql`
      SELECT data_allowlist FROM pipelines WHERE id = ${app.pipelineId} AND org_id = ${w.orgId}
    `)) as unknown as { rows: { data_allowlist: string[] | null }[] };
    const current = rows.rows?.[0]?.data_allowlist ?? [];
    const merged = Array.from(new Set([...current, ...needed]));
    if (merged.length !== current.length) {
      await db.execute(sql`
        UPDATE pipelines SET data_allowlist = ${JSON.stringify(merged)}::jsonb
        WHERE id = ${app.pipelineId} AND org_id = ${w.orgId}
      `);
      console.log(`${w.orgId}: pipeline ${app.pipelineId} allowlist += ${needed.filter((n) => !current.includes(n)).join(', ')}`);
    }
  } else {
    console.log(`${w.orgId}: ${w.appId} has no bound pipeline — no data ceiling to widen`);
  }
}
