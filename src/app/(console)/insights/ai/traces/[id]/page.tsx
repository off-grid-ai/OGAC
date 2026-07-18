import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildWaterfall, listObservations } from '@/lib/langfuse';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function TraceDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('observability');
  const { id } = await params;
  const result = await listObservations(id)
    .then((observations) => ({ spans: buildWaterfall(observations), error: null as string | null }))
    .catch((error: Error) => ({ spans: [], error: error.message }));

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/insights/ai/traces"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All traces
        </Link>
        <code className="text-xs text-muted-foreground">{id}</code>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Span waterfall</CardTitle>
          <p className="text-xs text-muted-foreground">
            Recorded spans positioned against the trace wall-clock duration.
          </p>
        </CardHeader>
        <CardContent>
          {result.error ? (
            <p className="text-xs text-destructive">Could not load trace spans: {result.error}</p>
          ) : result.spans.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No spans were recorded for this trace.
            </p>
          ) : (
            <div className="space-y-2">
              {result.spans.map((span) => (
                <div key={span.id} className="flex min-w-0 items-center gap-3 text-xs">
                  <span
                    className="w-52 shrink-0 truncate text-muted-foreground"
                    style={{ paddingLeft: span.depth * 10 }}
                    title={span.name}
                  >
                    {span.name}
                  </span>
                  <div className="relative h-3 min-w-48 flex-1 rounded bg-muted">
                    <div
                      className="absolute h-3 rounded bg-primary/60"
                      style={{ left: `${span.offsetPct}%`, width: `${span.widthPct}%` }}
                      title={span.model ? `${span.type} · ${span.model}` : span.type}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-muted-foreground">
                    {span.durationMs}ms
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
