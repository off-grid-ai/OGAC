import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPipeline, listPipelineVersions } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Versions tab — the real, immutable version history. Every publish and edit froze a snapshot;
// this is the audit trail of what the pipeline's governance contract was at each version.
export default async function PipelineVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPipeline(id, orgId);
  if (!p) notFound();
  const versions = await listPipelineVersions(id, orgId);

  return (
    <div className="w-full space-y-4">
      <div>
        <h2 className="text-base font-medium text-foreground">Version history</h2>
        <p className="text-sm text-muted-foreground">
          Immutable snapshots — every publish and edit is frozen here. Current version:
          <span className="font-medium text-foreground"> v{p.version}</span>.
        </p>
      </div>

      {versions.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No versions recorded yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {versions.map((v) => {
            const snap = v.snapshot as {
              status?: string;
              gatewayId?: string | null;
              dataAllowlist?: string[];
            };
            return (
              <Card key={v.id} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">v{v.version}</Badge>
                    <span className="capitalize text-muted-foreground">{v.note}</span>
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {v.createdAt ? new Date(v.createdAt).toLocaleString() : ''}
                    {v.createdBy ? ` · ${v.createdBy}` : ''}
                  </span>
                </CardHeader>
                <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <div>
                    <dt className="uppercase tracking-wide">Status</dt>
                    <dd className="capitalize text-foreground">{snap.status ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide">Gateway</dt>
                    <dd className="text-foreground">{snap.gatewayId ?? 'org default'}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide">Data ceiling</dt>
                    <dd className="text-foreground">
                      {(snap.dataAllowlist ?? []).length} domain(s)
                    </dd>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
