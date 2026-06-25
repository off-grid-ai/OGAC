import { NextResponse } from 'next/server';
import { agentActivity, listAllAgents } from '@/lib/agents';
import { createCustomAgent } from '@/lib/store';

const TRIGGERS = ['on-call', 'on-message', 'observed', 'scheduled', 'on-demand'];

// The catalog (built-ins + user-authored) + derived fleet activity. Agents are adoptable
// standalone; the `planes` each declares lets a tenant see what it needs provisioned.
export async function GET() {
  return NextResponse.json({
    object: 'list',
    data: await listAllAgents(),
    activity: await agentActivity(),
  });
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
const oneOf = (v: unknown, allowed: string[], fallback: string): string =>
  allowed.includes(str(v)) ? str(v) : fallback;

// Normalize an untrusted body into create-agent input, or null if the required fields are missing.
function parseBody(b: Record<string, unknown> | null) {
  const o = b ?? {};
  const name = str(o.name);
  const systemPrompt = str(o.systemPrompt);
  if (!name || !systemPrompt) return null;
  return {
    name,
    systemPrompt,
    role: str(o.role) || 'Custom',
    description: str(o.description),
    model: str(o.model),
    tools: strList(o.tools),
    grounded: o.grounded !== false,
    trigger: oneOf(o.trigger, TRIGGERS, 'on-demand'),
  };
}

// POST { name, systemPrompt, role?, description?, model?, tools?, grounded?, trigger? } → create a
// user-authored agent from text. It carries no special powers: every run flows through the same
// governed pipeline (policy → guardrails → routing → grounding → provenance) as the built-ins, so
// it inherits every convention configured on the console.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = parseBody(b);
  if (!input) {
    return NextResponse.json(
      { error: 'name and systemPrompt (instructions) required' },
      { status: 400 },
    );
  }
  return NextResponse.json(await createCustomAgent(input), { status: 201 });
}
