import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GoldenCaseActions } from '@/components/evals/QualityEntityActions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getGoldenCase } from '@/lib/evals';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function GoldenCaseDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('evals');
  const { id } = await params;
  const goldenCase = await getGoldenCase(id, await currentOrgId());
  if (!goldenCase) notFound();

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Link href="/solutions/quality/golden-cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Golden cases
          </Link>
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-medium">{goldenCase.name}</h3><Badge variant="secondary">{goldenCase.suite}</Badge></div>
        </div>
        <GoldenCaseActions goldenCase={goldenCase} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-sm">Input</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap font-mono text-sm">{goldenCase.query}</pre></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Expected result</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap font-mono text-sm">{goldenCase.expected}</pre></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Used by</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {goldenCase.pipelineId ? <p>Bound to <Link className="text-primary hover:underline" href={`/runtime/pipelines/${goldenCase.pipelineId}/quality`}>pipeline {goldenCase.pipelineId}</Link>.</p> : <p>Org-wide. Every unscoped evaluator suite can reuse this case.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
