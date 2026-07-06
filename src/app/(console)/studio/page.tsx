import { Plus } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { desc, eq, or } from 'drizzle-orm';
import { auth } from '@/auth';
import { StudioCanvas } from '@/components/studio/StudioCanvas';
import { StudioGallery, type StudioApp } from '@/components/studio/StudioGallery';
import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { requireModuleForUser } from '@/lib/module-access';
import { introspect, type Workflow } from '@/lib/studio';

export const dynamic = 'force-dynamic';

function agentIdOf(workflow: unknown): string | null {
  const nodes = (workflow as Workflow)?.nodeIds ?? [];
  return nodes.find((n) => n.startsWith('agent:'))?.replace(/^agent:/, '') ?? null;
}

export default async function StudioPage() {
  await requireModuleForUser('studio');
  const session = await auth();
  const email = session?.user?.email ?? '';
  const [catalog, templates] = await Promise.all([
    introspect(),
    db
      .select()
      .from(studioTemplates)
      .where(
        or(
          eq(studioTemplates.ownerId, email),
          eq(studioTemplates.visibility, 'org'),
          eq(studioTemplates.published, true),
        ),
      )
      .orderBy(desc(studioTemplates.updatedAt))
      .limit(50)
      .catch(() => []),
  ]);

  const apps: StudioApp[] = templates.map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary,
    visibility: t.visibility,
    slug: t.slug,
    published: t.published,
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt ?? ''),
    agentId: agentIdOf(t.workflow),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Build an assistant by describing it in plain language — no technical setup. Off Grid
            wires the model, policy, guardrails, and grounding for you.
          </p>
        </div>
        <Button asChild>
          <Link href="/studio/new">
            <Plus className="size-4" />
            New assistant
          </Link>
        </Button>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground">Your assistants</h2>
        <StudioGallery apps={apps} />
      </div>

      {/* Advanced: the technical block composer, for power users */}
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-foreground">
          Advanced builder (technical)
        </summary>
        <div className="border-t border-border p-4">
          <StudioCanvas catalog={catalog} userId={email || undefined} />
        </div>
      </details>
    </div>
  );
}
