import { listAudit } from '@/lib/store';

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

export interface AgentActivity {
  totalRuns: number;
  groundedShare: number;
}

// Honest, derived activity: the audit store is the only real signal we have today, so we
// report fleet-wide events and the share of agents that are retrieval-grounded.
export async function agentActivity(): Promise<AgentActivity> {
  const audit = await listAudit({ limit: 5000 });
  const grounded = AGENTS.filter((a) => a.grounded).length;
  return {
    totalRuns: audit.length,
    groundedShare: Math.round((grounded / AGENTS.length) * 100),
  };
}
