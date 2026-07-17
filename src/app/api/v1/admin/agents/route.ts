import { NextResponse } from 'next/server';
import { parseCreateInput } from '@/lib/agent-form';
import { agentActivity, listAllAgents } from '@/lib/agents';
import { requireAdmin } from '@/lib/authz';
import { isAgentPipelineBindingValid } from '@/lib/pipeline-run-glue';
import { createCustomAgent } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// The catalog (built-ins + user-authored) + derived fleet activity. Agents are adoptable
// standalone; the `planes` each declares lets a tenant see what it needs provisioned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({
    object: 'list',
    data: await listAllAgents(orgId),
    activity: await agentActivity(orgId),
  });
}

// POST { name, systemPrompt, pipelineId?, role?, description?, model?, tools?, grounded?, trigger? }
// → create a
// user-authored agent from text. It carries no special powers: every run flows through the same
// governed pipeline (policy → guardrails → routing → grounding → provenance) as the built-ins, so
// it inherits every convention configured on the console.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = parseCreateInput(b);
  if (!input) {
    return NextResponse.json(
      { error: 'name/instructions required; pipelineId must be a string or null' },
      { status: 400 },
    );
  }
  const orgId = await currentOrgId();
  if (!(await isAgentPipelineBindingValid(input.pipelineId, orgId))) {
    return NextResponse.json({ error: 'pipeline not found in this organisation' }, { status: 400 });
  }
  return NextResponse.json(await createCustomAgent(input, orgId), { status: 201 });
}
