import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getAgentRuntime } from '@/lib/adapters/agentruntime';

// Agent-runtime status + durable-submission probe. GET reports the active runtime (sync default,
// or Temporal when OFFGRID_ADAPTER_AGENTRUNTIME=temporal + a submission bridge is configured).
// POST performs a best-effort durable submission dry-run; if the runtime can't accept it, the
// response says so and the synchronous in-process path (runAgent) remains the real executor.
export async function GET() {
  const rt = getAgentRuntime();
  return NextResponse.json({
    active: rt.meta.id,
    vendor: rt.meta.vendor,
    available: rt.available(),
    healthy: await rt.health(),
  });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { agentId?: string; query?: string } | null;
  const rt = getAgentRuntime();
  const handle = await rt.submit({
    agentId: b?.agentId ?? 'probe',
    query: b?.query ?? 'runtime probe',
    runId: `run_${randomUUID().slice(0, 8)}`,
  });
  return NextResponse.json({ runtime: rt.meta.id, handle });
}
