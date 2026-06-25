import { ArrowLeft, Scroll } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireModule } from '@/lib/modules';
import { listPromptVersions, listPrompts } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function PromptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  requireModule('brain');
  const { id } = await params;
  const [prompts, versions] = await Promise.all([listPrompts(), listPromptVersions(id)]);
  const prompt = prompts.find((p) => p.id === id);
  if (!prompt) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/brain"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Brain
      </Link>

      <div className="flex items-center gap-3">
        <Scroll className="size-6 text-primary" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">{prompt.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{prompt.description}</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Version history ({versions.length})</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every published change is a new immutable version — roll back by publishing an older
            body forward.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {versions.map((v) => {
            const latest = v.version === prompt.latestVersion;
            return (
              <div
                key={v.id}
                className={`rounded-md border p-3 ${latest ? 'border-primary/40 bg-primary/5' : 'border-border'}`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="secondary" className="bg-muted text-muted-foreground">
                    v{v.version}
                  </Badge>
                  {latest ? (
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      latest
                    </Badge>
                  ) : null}
                  {v.label ? <span className="text-xs text-muted-foreground">{v.label}</span> : null}
                  <span className="ml-auto text-[10px] text-muted-foreground/70">
                    {v.createdAt.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-2.5 text-xs text-foreground">
                  {v.body}
                </pre>
              </div>
            );
          })}
          {versions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No versions yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
