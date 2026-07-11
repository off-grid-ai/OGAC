import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getPublishJob, listPublishJobs } from '@/lib/publish-jobs-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/pipelines/[id]/publish/status — poll a gating publish job (M1-a async gate).
//
//   ?jobId=<id>  → that specific job's { status: gating|published|blocked, decision }.
//   (no jobId)   → the pipeline's LATEST job (newest first) — convenience for a page that refreshed
//                  and lost the jobId; the Quality tab can resume polling the in-flight gate.
//
// While `gating` the decision is null (evals still running). Once terminal, `decision` carries the
// ReleaseGateDecision + overridden + version so the tab renders the verdict + WHY.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const jobId = new URL(req.url).searchParams.get('jobId');

  if (jobId) {
    const job = await getPublishJob(jobId, orgId);
    if (!job || job.pipelineId !== id) {
      return NextResponse.json({ error: 'unknown job' }, { status: 404 });
    }
    return NextResponse.json(job);
  }

  // No jobId → return the latest job for this pipeline (or null when there was never a gated publish).
  const jobs = await listPublishJobs(id, orgId);
  return NextResponse.json({ job: jobs[0] ?? null });
}
