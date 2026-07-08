import { notFound } from 'next/navigation';
import { LensLink } from '@/components/pipelines/telemetry/LensLink';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { normalizeAudit } from '@/lib/audit-log-view';
import { getPipeline } from '@/lib/pipelines';
import { filterAuditForPipeline, pipelineTag } from '@/lib/pipeline-api-key-format';
import { searchAudit } from '@/lib/siem';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const OUTCOME_TONE: Record<string, string> = {
  ok: 'text-primary',
  blocked: 'text-destructive',
  redacted: 'text-amber-600',
  error: 'text-destructive',
};

function fmt(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

// The Audit tab — every governed decision this pipeline made (its invocations, key mint/revoke,
// config changes, egress verdicts) plus who invoked it. A lens over the org-wide audit stream
// (searchAudit → offgrid-audit) narrowed by the pure filterAuditForPipeline to rows whose
// resource/project names this pipeline. Honest: an unconfigured/empty index → an empty table + note.
export default async function PipelineAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();

  // Over-fetch a recent window and narrow purely (searchAudit's free-text `q` doesn't cover
  // resource/project reliably; the pure filter is the exact, unit-tested gate).
  const result = await searchAudit({ size: 200 });
  const view = normalizeAudit(result);
  const rows = filterAuditForPipeline(view.rows, id);

  return (
    <div className="w-full space-y-4">
      <LensLink pipelineName={p.name} surface="Audit" href="/insights/audit" />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Governed events</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every audited action naming <code className="text-xs">{pipelineTag(id)}</code> — its
            invocations, key lifecycle, config changes, and egress verdicts.
          </p>
        </CardHeader>
        <CardContent>
          {!view.configured ? (
            <p className="text-sm text-muted-foreground">
              The audit index isn&apos;t configured on this deployment, so there are no events to
              show yet.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No audited events for this pipeline yet. Minting a key, editing config, or invoking the
              pipeline will record events here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Model</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground">{fmt(r.ts)}</TableCell>
                      <TableCell className="text-xs">{r.actor}</TableCell>
                      <TableCell className="font-medium">{r.action}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={OUTCOME_TONE[r.outcome] ?? 'text-muted-foreground'}
                        >
                          {r.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.model || '—'}
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
