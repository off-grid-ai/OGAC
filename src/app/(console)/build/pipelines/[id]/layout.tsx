import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PipelineDetailNav } from '@/components/pipelines/PipelineDetailNav';
import { requireModuleForUser } from '@/lib/module-access';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-pipeline detail shell (Gateways × Pipelines, the PIPELINE tier) ──────────────────────────
// Opening a pipeline gives its own surface with the governance + telemetry tabs. This layout wraps
// every /pipelines/<id>/* page with the scoped PipelineDetailNav band. It resolves the pipeline once
// here (name + 404) so child tab pages only fetch what they render.
export default async function PipelineShellLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ id: string }>;
}>) {
  await requireModuleForUser('pipelines');
  const { id } = await params;
  const pipeline = await getPipeline(id, await currentOrgId());
  if (!pipeline) notFound();

  return (
    <div className="w-full space-y-6">
      <PipelineDetailNav pipelineId={pipeline.id} name={pipeline.name} />
      {children}
    </div>
  );
}
