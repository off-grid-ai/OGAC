import { NextResponse } from 'next/server';
import { listAgentRuns, runAgent } from '@/lib/agentrun';

// GET → recent agent run traces (steps + provenance + citations).
export async function GET() {
  return NextResponse.json({ object: 'list', data: await listAgentRuns() });
}

// POST { agentId, query } → execute an agent and record a traced run.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { agentId?: unknown; query?: unknown } | null;
  if (!b || typeof b.agentId !== 'string' || typeof b.query !== 'string' || !b.query.trim()) {
    return NextResponse.json({ error: 'agentId and query required' }, { status: 400 });
  }
  const run = await runAgent(b.agentId, b.query);
  if (!run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  return NextResponse.json(run, { status: 201 });
}
