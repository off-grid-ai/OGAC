import { type CustomAgent, getCustomAgent, listAudit, listCustomAgents } from '@/lib/store';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Pre-built agent use cases. These are the "democratized intelligence at the frontline" and
// "SOPs from observed work" cases the product ships with — adoptable standalone, with or
// without the rest of the stack. Each declares the planes it needs so the console can show
// whether a tenant has them provisioned. Definitions are static; activity is derived live.
export type AgentTrigger = 'on-call' | 'on-message' | 'observed' | 'scheduled' | 'on-demand';

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  description: string;
  planes: string[];
  tools: string[];
  grounded: boolean;
  trigger: AgentTrigger;
  // Set on user-authored agents created from text in the console. `systemPrompt` is the
  // natural-language instruction that steers the answer; the rest of the pipeline (policy,
  // guardrails, routing, grounding, provenance) is identical to the built-ins.
  custom?: boolean;
  systemPrompt?: string;
  model?: string;
  // Management flag: whether a custom agent is currently enabled (runnable). Built-ins are always
  // enabled. Set only by the management listing so the console can show + re-enable disabled agents;
  // the runtime catalog (listAllAgents) excludes disabled agents entirely.
  enabled?: boolean;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'sop-synth',
    name: 'SOP Synthesizer',
    role: 'Operations',
    description:
      'Watches how top performers actually work — captured screens, messages, calls — and drafts a citable standard operating procedure for review. Turns tacit know-how into shared process.',
    planes: ['data', 'brain'],
    tools: ['capture', 'retrieval', 'summarize'],
    grounded: true,
    trigger: 'observed',
  },
  {
    id: 'fnol-intake',
    name: 'FNOL Intake Assistant',
    role: 'Claims',
    description:
      'Guides a claims handler through first-notice-of-loss: captures the required fields, checks the policy is in force and past contestability, and flags investigation cases — grounded in the claims SOP.',
    planes: ['brain'],
    tools: ['retrieval', 'forms'],
    grounded: true,
    trigger: 'on-demand',
  },
  {
    id: 'sales-coach',
    name: 'Sales Coach',
    role: 'Distribution',
    description:
      'Listens on advisor calls and surfaces the right objection-handling playbook in the moment — premium-vs-protection reframes, return-of-premium variants — cited to the distribution playbook.',
    planes: ['brain'],
    tools: ['transcribe', 'retrieval'],
    grounded: true,
    trigger: 'on-call',
  },
  {
    id: 'kyc-checker',
    name: 'KYC Verifier',
    role: 'Onboarding',
    description:
      'Walks the onboarding team through identity checks, matches name/DOB across documents, and escalates mismatches — never storing raw Aadhaar in plain text. Masking enforced by the data plane.',
    planes: ['data', 'brain'],
    tools: ['retrieval', 'ocr', 'masking'],
    grounded: true,
    trigger: 'on-demand',
  },
  {
    id: 'audit-watch',
    name: 'Audit Watch',
    role: 'Compliance',
    description:
      'Reviews the fleet audit for policy violations, egress spikes, and blocked/redacted patterns, then drafts a daily compliance note for the DPO — grounded in the live control-plane state.',
    planes: ['control', 'analytics'],
    tools: ['audit', 'summarize'],
    grounded: false,
    trigger: 'scheduled',
  },
];

// Map a DB-stored custom agent to the same AgentDef shape the built-ins use, so the rest of the
// app treats both identically. Planes are derived: a grounded agent needs the Brain.
function toDef(c: CustomAgent): AgentDef {
  const trigger = (
    ['on-call', 'on-message', 'observed', 'scheduled', 'on-demand'] as AgentTrigger[]
  ).includes(c.trigger as AgentTrigger)
    ? (c.trigger as AgentTrigger)
    : 'on-demand';
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    description: c.description,
    planes: c.grounded ? ['brain'] : [],
    tools: c.tools,
    grounded: c.grounded,
    trigger,
    custom: true,
    systemPrompt: c.systemPrompt,
    model: c.model || undefined,
  };
}

// The full catalog the console shows and runs: built-ins + every ENABLED user-authored agent.
// Used by the runtime pipeline and fleet views — disabled agents are intentionally excluded.
export async function listAllAgents(orgId: string = DEFAULT_ORG): Promise<AgentDef[]> {
  const custom = await listCustomAgents(orgId);
  return [...AGENTS, ...custom.filter((c) => c.enabled).map(toDef)];
}

// The management listing for the Agents console: built-ins + ALL custom agents (including
// disabled ones, tagged with `enabled`) so operators can see, edit, and re-enable them. Distinct
// from listAllAgents, which is the runnable catalog.
export async function listManagedAgents(orgId: string = DEFAULT_ORG): Promise<AgentDef[]> {
  const custom = await listCustomAgents(orgId);
  return [
    ...AGENTS.map((a) => ({ ...a, enabled: true })),
    ...custom.map((c) => ({ ...toDef(c), enabled: c.enabled })),
  ];
}

// Resolve a single agent by id — built-in first, then a user-authored one from the DB. Used by
// the interaction pipeline so a custom agent runs through exactly the same governed path.
export async function resolveAgent(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<AgentDef | undefined> {
  const builtin = AGENTS.find((a) => a.id === id);
  if (builtin) return builtin;
  const custom = await getCustomAgent(id, orgId);
  return custom?.enabled ? toDef(custom) : undefined;
}

export interface AgentActivity {
  totalRuns: number;
  groundedShare: number;
}

// Honest, derived activity: the audit store is the only real signal we have today, so we
// report fleet-wide events and the share of agents (built-in + custom) that are grounded.
export async function agentActivity(orgId: string = DEFAULT_ORG): Promise<AgentActivity> {
  const [audit, all] = await Promise.all([listAudit({ limit: 5000 }), listAllAgents(orgId)]);
  const grounded = all.filter((a) => a.grounded).length;
  return {
    totalRuns: audit.length,
    groundedShare: all.length ? Math.round((grounded / all.length) * 100) : 0,
  };
}
