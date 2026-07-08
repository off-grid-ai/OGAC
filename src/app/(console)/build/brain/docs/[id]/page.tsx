import { ArrowLeft, FileText } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDocument, searchDocuments } from '@/lib/brain';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function DocInspectorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('brain');
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) notFound();
  // Retrieval preview: run the doc's own title through the retriever to show where it ranks and
  // what it competes with — the closest thing to a "chunk/embedding inspector" for whole-doc RAG.
  const hits = await searchDocuments(doc.title, 5);
  const words = doc.text.split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <Link
        href="/build/brain"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Brain
      </Link>

      <div className="flex items-center gap-3">
        <FileText className="size-6 text-primary" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">{doc.title}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {doc.source}
            </Badge>
            <span className="text-xs text-muted-foreground">{words} words</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">{doc.id}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Content</CardTitle>
            <p className="text-xs text-muted-foreground">
              The indexed text — embedded and retrievable through the Brain.
            </p>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{doc.text}</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Retrieval preview</CardTitle>
            <p className="text-xs text-muted-foreground">
              Ranked results for this doc&apos;s title — where it surfaces vs neighbours.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {hits.map((h, i) => {
              const isSelf = h.id === doc.id;
              return (
                <div
                  key={h.id}
                  className={`rounded-md border p-2 ${isSelf ? 'border-primary/40 bg-primary/5' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-foreground">
                      {i + 1}. {h.title}
                    </span>
                    <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                      {h.score.toFixed(3)}
                    </Badge>
                  </div>
                  {isSelf ? (
                    <span className="text-[10px] uppercase tracking-wide text-primary">this document</span>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
