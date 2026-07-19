import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageFrame } from '@/components/PageFrame';
import { PipelineDetailNav } from '@/components/pipelines/PipelineDetailNav';
import { requireModuleForUser } from '@/lib/module-access';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-pipeline detail shell (Gateways × Pipelines, the PIPELINE tier) ──────────────────────────
// Opening a pipeline gives its own surface with an entity-local lifecycle rail. This layout wraps
// every /pipelines/<id>/* page with the scoped PipelineDetailNav and resolves the pipeline once here
// (name + 404) so child pages continue to own their headings and only fetch what they render.
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
    <PageFrame>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <PipelineDetailNav pipelineId={pipeline.id} name={pipeline.name} />
        <div className="min-w-0">{children}</div>
      </div>
    </PageFrame>
  );
}
