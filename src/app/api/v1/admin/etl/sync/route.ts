import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { airbyteEtl } from '@/lib/adapters/airbyte';

// Trigger an ETL sync for an Airbyte connection. POST { connectionId } → the job that was started.
// Audited like the connectors sync route. 404 when Airbyte is unreachable / rejected the trigger.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => ({}))) as { connectionId?: unknown };
  const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : '';
  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
  }

  const job = await airbyteEtl.triggerSync(connectionId);
  if (!job) {
    return NextResponse.json(
      { error: 'sync could not be started (connection unknown or Airbyte unreachable)' },
      { status: 404 },
    );
  }

  auditFromSession(gate, await currentOrgId(), {
    action: 'etl.sync',
    resource: `etl-connection:${connectionId}`,
    outcome: 'ok',
  });
  return NextResponse.json(job, { status: 202 });
}

// Poll a job's status. GET ?jobId=123 → the normalized job. 400 on a missing/invalid id, 404 when
// Airbyte can't find it or is unreachable.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const raw = new URL(req.url).searchParams.get('jobId');
  const jobId = Number(raw);
  if (!raw || !Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'valid jobId query param required' }, { status: 400 });
  }

  const job = await airbyteEtl.jobStatus(jobId);
  if (!job) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 });
  }
  return NextResponse.json(job);
}
