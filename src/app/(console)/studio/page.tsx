import { ArrowSquareOut, Plus, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { desc, eq, or } from 'drizzle-orm';
import { auth } from '@/auth';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { StudioCanvas } from '@/components/studio/StudioCanvas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { requireModuleForUser } from '@/lib/module-access';
import { introspect, type Workflow } from '@/lib/studio';

export const dynamic = 'force-dynamic';

function agentIdOf(workflow: unknown): string | null {
  const nodes = (workflow as Workflow)?.nodeIds ?? [];
  return nodes.find((n) => n.startsWith('agent:'))?.replace(/^agent:/, '') ?? null;
}

const VIS_LABEL: Record<string, string> = { private: 'Just me', org: 'My org', public: 'Shared link' };

export default async function StudioPage() {
  await requireModuleForUser('studio');
  const session = await auth();
  const email = session?.user?.email ?? '';
  const [catalog, templates] = await Promise.all([
    introspect(),
    db
      .select()
      .from(studioTemplates)
      .where(or(eq(studioTemplates.ownerId, email), eq(studioTemplates.visibility, 'org'), eq(studioTemplates.published, true)))
      .orderBy(desc(studioTemplates.updatedAt))
      .limit(50)
      .catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Studio</h1>
          <p className="text-sm text-muted-foreground">
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

      {/* Gallery of saved assistants */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground">Your assistants</h2>
        {templates.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkle className="size-5" />
              </div>
              <p className="text-sm text-muted-foreground">
                No assistants yet. Describe one in plain language and Studio builds it.
              </p>
              <Button asChild size="sm">
                <Link href="/studio/new">
                  <Plus className="size-4" />
                  Create your first assistant
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {templates.map((t) => {
              const agentId = agentIdOf(t.workflow);
              return (
                <Card key={t.id} className="shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm">{t.title}</CardTitle>
                      <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                        {VIS_LABEL[t.visibility] ?? t.visibility}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="line-clamp-2 text-xs text-muted-foreground">{t.summary || '—'}</p>
                    <div className="flex items-center gap-2">
                      {agentId ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/agents/${agentId}`}>Open &amp; try</Link>
                        </Button>
                      ) : null}
                      {t.slug ? (
                        <a
                          href={`/app/${t.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ArrowSquareOut className="size-3.5" />
                          shared link
                        </a>
                      ) : null}
                      <div className="ml-auto">
                        <DeleteRowButton url={`/api/v1/studio/templates/${t.id}`} label={t.title} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
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
