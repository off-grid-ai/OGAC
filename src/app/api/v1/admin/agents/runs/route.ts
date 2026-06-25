import { after, NextResponse } from 'next/server';
import { listAgentRuns, runAgent, scoreRun } from '@/lib/agentrun';

// GET → recent agent run traces (steps + checks + provenance + citations).
export async function GET() {
  return NextResponse.json({ object: 'list', data: await listAgentRuns() });
}

// POST { agentId, query } → execute an agent through the full interaction pipeline and record a
// traced run. The online QA score runs AFTER the response is flushed (next/server `after`), so the
// LLM-as-judge call never adds latency to the caller.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { agentId?: unknown; query?: unknown } | null;
  if (!b || typeof b.agentId !== 'string' || typeof b.query !== 'string' || !b.query.trim()) {
    return NextResponse.json({ error: 'agentId and query required' }, { status: 400 });
  }
  const run = await runAgent(b.agentId, b.query);
  if (!run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  after(() => scoreRun(run));
  return NextResponse.json(run, { status: 201 });
}
