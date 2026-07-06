import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Suspense } from 'react';
import { auth } from '@/auth';
import { StudioBuilder } from '@/components/studio/StudioBuilder';
import { requireModuleForUser } from '@/lib/module-access';
import { listCollections } from '@/lib/org-knowledge';
import { getOrgPolicy, listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Non-technical assistant builder (Phase 4.5). Loads the org's enabled tools (skills), the knowledge
// collections the user's role may draw on (data), and the org's allowed models — the guided 4-step
// wizard turns a plain-language goal into a governed agent + template behind the scenes.
export default async function StudioNewPage() {
  await requireModuleForUser('studio');
  const session = await auth();
  const role = session?.user?.role ?? 'viewer';
  const orgId = await currentOrgId();

  const [tools, collections, policy] = await Promise.all([
    listTools(orgId).catch(() => []),
    listCollections(role).catch(() => []),
    getOrgPolicy().catch(() => ({ allowedModels: [] as string[] })),
  ]);

  const toolOptions = tools
    .filter((t) => t.enabled)
    .map((t) => ({ id: t.id, name: t.name, description: t.description }));
  const collectionOptions = collections.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
  }));

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Studio
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-foreground">New assistant</h1>
        <p className="text-sm text-muted-foreground">
          Four plain questions — goal, skills, data, publish. Off Grid wires the model, policy,
          guardrails, and grounding for you, then you test it live before publishing.
        </p>
      </div>
      <Suspense fallback={null}>
        <StudioBuilder
          tools={toolOptions}
          collections={collectionOptions}
          allowedModels={policy.allowedModels ?? []}
        />
      </Suspense>
    </div>
  );
}
