import { notFound } from 'next/navigation';
import { LensLink } from '@/components/pipelines/telemetry/LensLink';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { computeAccounting } from '@/lib/accounting';
import { safeListTraces } from '@/lib/langfuse';
import { getPipeline } from '@/lib/pipelines';
import { pipelineCostSlice, pipelineTag } from '@/lib/pipeline-api-key-format';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </CardContent>
    </Card>
  );
}

// The Observability tab — traces, latency, and tokens for THIS pipeline's runs. Headline volume/token
// metrics come from the pipeline's slice of the org-wide accounting fact table (real, attributed by
// the "pipeline:<id>" run tag). Recent traces are pulled from Langfuse and narrowed to those naming
// the pipeline (trace name / userId). Honest: Langfuse doesn't index by pipeline server-side, so
// trace-level per-pipeline filtering is best-effort over the recent window until traces are stamped
// with the pipeline tag (logged as a gap); an empty match shows an honest note.
export default async function PipelineObservabilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();

  const tag = pipelineTag(id);
  const [accounting, traceResult] = await Promise.all([
    computeAccounting('all'),
    safeListTraces(100),
  ]);
  const slice = pipelineCostSlice(id, accounting);
  const traces = traceResult.traces.filter((t) => {
    const hay = `${t.name ?? ''} ${t.userId ?? ''}`;
    return hay.includes(tag) || hay.includes(id);
  });

  return (
    <div className="w-full space-y-4">
      <LensLink pipelineName={p.name} surface="Observability" href="/observability" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Requests" value={slice.requests.toLocaleString()} />
        <Stat label="Prompt tokens" value={slice.promptTokens.toLocaleString()} />
        <Stat label="Completion tokens" value={slice.completionTokens.toLocaleString()} />
        <Stat label="Matched traces" value={traces.length.toLocaleString()} />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Recent traces</CardTitle>
          <p className="text-sm text-muted-foreground">
            Traces naming <code className="text-xs">{tag}</code> from the recent window.
          </p>
        </CardHeader>
        <CardContent>
          {!traceResult.configured ? (
            <p className="text-sm text-muted-foreground">
              Tracing isn&apos;t configured on this deployment, so there are no traces to show yet.
            </p>
          ) : traces.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No traces tagged to this pipeline in the recent window. Runs invoked through this
              pipeline appear here once traces carry its tag.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trace</TableHead>
                    <TableHead className="text-right">Latency (ms)</TableHead>
                    <TableHead className="text-right">Spans</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {traces.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name ?? t.id}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.latency != null ? Math.round(t.latency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.observations ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.timestamp ? new Date(t.timestamp).toLocaleString() : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
