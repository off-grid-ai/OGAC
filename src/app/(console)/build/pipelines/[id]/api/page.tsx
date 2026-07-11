import { notFound } from 'next/navigation';
import { PipelineApiKeys } from '@/components/pipelines/telemetry/PipelineApiKeys';
import { PipelineEndpoint } from '@/components/pipelines/telemetry/PipelineEndpoint';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listKeys } from '@/lib/pipeline-api-keys';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The API / Integrate tab — the pipeline consumed as its OWN provisioned API. Shows the callable
// endpoint + curl/SDK snippets, and full CRUD over provisioned keys (mint shows the plaintext once,
// revoke with confirm). Every call through a key runs THROUGH this pipeline's governance — no bypass.
export default async function PipelineApiPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPipeline(id, orgId);
  if (!p) notFound();
  const keys = await listKeys(id, orgId);

  return (
    <div className="w-full space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Consume this pipeline</CardTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{p.name}</span> is callable as its own
            provisioned API — by apps, agents, and external third-parties. Calls are governed by the
            pipeline: policy, guardrails, and the routing/egress leash apply on every request.
          </p>
        </CardHeader>
        <CardContent>
          <PipelineEndpoint pipelineId={id} />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">API keys</CardTitle>
          <p className="text-sm text-muted-foreground">
            Mint a key per consumer so you can revoke access independently. The secret is shown once;
            only its hash is stored.
          </p>
        </CardHeader>
        <CardContent>
          <PipelineApiKeys pipelineId={id} keys={keys} />
        </CardContent>
      </Card>
    </div>
  );
}
