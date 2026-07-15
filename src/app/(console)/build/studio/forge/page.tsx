import { ArrowLeft, Lightning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { StudioForge } from '@/components/studio/StudioForge';
import { requireModuleForUser } from '@/lib/module-access';
import { getOrgContext, summarizeOrgContext } from '@/lib/org-context';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Studio Forge — the conversational (bolt.new / lovable) app builder ───────────────────────────
// A full-screen chat-to-build surface that skins the existing NL→AppSpec engine. Loads the org
// context ONCE (same inheritance the guided builder uses) so the preview can show what every app
// inherits — pipelines, gateway models/routing, data connectors/domains/KB, and regulations
// (guardrails + policy). Client-side StudioForge drives compile → refine → save against the real
// /api/v1/admin/apps endpoints.
export default async function StudioForgePage() {
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();
  const [ctx, pipelines] = await Promise.all([
    getOrgContext(orgId),
    listPipelines(orgId).catch(() => []),
  ]);
  const summary = summarizeOrgContext(ctx);
  const pipelineOptions = pipelines.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/build/studio"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Studio
          </Link>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold">
            <Lightning weight="fill" className="size-5 text-primary" /> Forge
          </h1>
        </div>
      </div>
      <StudioForge summary={summary} pipelineOptions={pipelineOptions} />
    </div>
  );
}
