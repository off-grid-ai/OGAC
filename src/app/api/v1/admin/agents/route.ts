import { NextResponse } from 'next/server';
import { AGENTS, agentActivity } from '@/lib/agents';

// The pre-built agent catalog + derived fleet activity. Agents are adoptable standalone; the
// `planes` each declares lets a tenant see what it needs provisioned.
export async function GET() {
  return NextResponse.json({ object: 'list', data: AGENTS, activity: await agentActivity() });
}
