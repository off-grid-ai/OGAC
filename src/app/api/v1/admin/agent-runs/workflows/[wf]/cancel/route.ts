import { NextResponse } from 'next/server';
import { cancelWorkflow } from '@/lib/adapters/agentruntime';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// POST → cancel (or terminate) a running durable workflow execution by workflowId. Body/query:
// { mode: 'cancel' | 'terminate' } (default 'cancel' — graceful; 'terminate' force-kills). This is
// the Temporal-side control action, distinct from cancelling a recorded DB run. Graceful failures:
// not-found → 404, unconfigured/unreachable → 409/502, never an unhandled 5xx.
export async function POST(req: Request, { params }: { params: Promise<{ wf: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { wf } = await params;
  const workflowId = decodeURIComponent(wf);

  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
  const rawMode = body?.mode ?? url.searchParams.get('mode') ?? 'cancel';
  const mode: 'cancel' | 'terminate' = rawMode === 'terminate' ? 'terminate' : 'cancel';

  const res = await cancelWorkflow(workflowId, mode);
  if (res.ok) {
    return NextResponse.json({ ok: true, workflowId: res.workflowId, mode, by: gate.user.email });
  }
  const status = res.reason === 'not_found' ? 404 : res.reason === 'not_configured' ? 409 : 502;
  return NextResponse.json({ error: res.error }, { status });
}
