import { CopilotConsole } from '@/components/copilot/CopilotConsole';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { deriveAnomalies } from '@/lib/copilot-gather';
import { computeFinOps } from '@/lib/finops';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function InsightsAiCopilotPage() {
  await requireModuleForUser('observability');
  const orgId = await currentOrgId();
  const anomalies = await computeFinOps(null, orgId)
    .then(deriveAnomalies)
    .catch(() => [] as ReturnType<typeof deriveAnomalies>);
  const flagged = anomalies.flatMap((anomaly) =>
    anomaly.scan.anomalies.map((item) => ({ metric: anomaly.metric, ...item })),
  );

  return (
    <div className="w-full space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Answers cite your platform records</CardTitle>
          <p className="text-xs text-muted-foreground">
            Ask why a run failed, why cost changed, or what is drifting. Copilot returns cited
            records or states that it has no supporting data.
          </p>
        </CardHeader>
      </Card>
      <CopilotConsole anomalies={flagged} />
    </div>
  );
}
