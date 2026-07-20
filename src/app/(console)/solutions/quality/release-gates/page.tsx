import Link from 'next/link';
import { ThresholdManager } from '@/components/observability/ThresholdManager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listEvalDefs } from '@/lib/eval-defs';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { listPublishJobs } from '@/lib/publish-jobs-store';
import { buildReleaseGatePortfolio, type GatePortfolioStatus } from '@/lib/quality-operator-view';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<GatePortfolioStatus, string> = {
  ungated: 'bg-muted text-muted-foreground',
  'not-run': 'bg-muted text-foreground',
  running: 'bg-primary/10 text-primary',
  passed: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  overridden: 'bg-muted text-foreground',
};

export default async function QualityReleaseGatesPage() {
  await requireModuleForUser('evals');
  const orgId = await currentOrgId();
  const [pipelines, definitions] = await Promise.all([
    listPipelines(orgId).catch(() => []),
    listEvalDefs({ orgId }).catch(() => []),
  ]);
  const jobGroups = await Promise.all(
    pipelines.map((pipeline) => listPublishJobs(pipeline.id, orgId).catch(() => [])),
  );
  const rows = buildReleaseGatePortfolio(
    pipelines,
    definitions,
    jobGroups.flat().map((job) => ({
      jobId: job.jobId,
      pipelineId: job.pipelineId,
      status: job.status,
      createdAt: job.createdAt,
      overridden: job.decision?.overridden ?? false,
      summary: job.decision?.decision.summary ?? null,
    })),
  );
  const gated = rows.filter((row) => row.attachedEvals > 0).length;
  const blocked = rows.filter((row) => row.status === 'blocked').length;
  const unverified = rows.filter(
    (row) => row.status === 'not-run' || row.status === 'ungated',
  ).length;

  return (
    <div className="w-full space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Pipelines">
          <span className="text-2xl">{rows.length}</span>
        </Metric>
        <Metric label="Gated">
          <span className="text-2xl">{gated}</span>
        </Metric>
        <Metric label="Blocked">
          <span className="text-2xl">{blocked}</span>
        </Metric>
        <Metric label="No persisted verdict">
          <span className="text-2xl">{unverified}</span>
        </Metric>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pipeline release gates</CardTitle>
          <CardDescription className="text-xs">
            A publish job runs the evaluators attached to that pipeline. Passing publishes. Failing
            blocks unless an operator uses the audited override on the pipeline Quality view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              No pipelines exist yet. Create a pipeline, attach evaluators, and publish through its
              Quality view to record a gate verdict.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pipeline</TableHead>
                    <TableHead className="text-right">Evaluators</TableHead>
                    <TableHead>Last gate</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.pipelineId}>
                      <TableCell>
                        <div className="font-medium">{row.pipelineName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {row.pipelineStatus}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{row.attachedEvals}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS_CLASS[row.status]}>
                          {row.status}
                        </Badge>
                        {row.lastCheckedAt ? (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {row.lastCheckedAt.slice(0, 16).replace('T', ' ')}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-xl whitespace-normal text-xs text-muted-foreground">
                        {row.summary}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/runtime/pipelines/${row.pipelineId}/quality`}>
                            Open gate
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ThresholdManager />
        </div>
        <Card className="h-fit xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Remediation path</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <p>
              A blocked release stays draft. Open its pipeline gate to inspect failing evaluators,
              re-run, use the audited override, or restore a last-good version.
            </p>
            <p>
              Drift-triggered automatic rollback is deployment-controlled by{' '}
              <span className="font-mono text-foreground">OFFGRID_AUTO_ROLLBACK_ON_DRIFT</span>.
              This console does not claim it is active when that setting is unavailable.
            </p>
            <Button asChild variant="outline">
              <Link href="/solutions/quality/drift">Inspect drift evidence</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
