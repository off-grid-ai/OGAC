import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { PipelineVersionsManager } from '@/components/pipelines/PipelineVersionsManager';
import { resolvePipelineRole } from '@/lib/pipeline-lifecycle';
import { getPipeline, listPipelineVersions } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Versions tab — the real, immutable version history as a full MANAGEMENT surface. Every publish,
// edit, and rollback froze the pipeline's governance contract; here an operator inspects any version's
// full contract, diffs two versions, annotates a version with a label, and rolls a prior version back
// to active. Rollback/annotate are admin-gated (the write routes require admin); the role is resolved
// server-side so the UI never offers an action the API will refuse.
export default async function PipelineVersionsPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPipeline(id, orgId);
  if (!p) notFound();

  const [versions, session] = await Promise.all([
    listPipelineVersions(id, orgId),
    auth() as Promise<{ user?: { email?: string | null; role?: string } } | null>,
  ]);
  const actor = { email: session?.user?.email ?? '', role: session?.user?.role };
  const role = await resolvePipelineRole(actor, { ownerId: p.ownerId, teamId: p.teamId }, orgId);

  return (
    <PipelineVersionsManager
      data={{
        pipelineId: p.id,
        pipelineName: p.name,
        currentVersion: p.version,
        isAdmin: role === 'admin',
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          note: v.note,
          label: v.label,
          createdAt: v.createdAt,
          createdBy: v.createdBy,
          snapshot: v.snapshot,
        })),
      }}
    />
  );
}
