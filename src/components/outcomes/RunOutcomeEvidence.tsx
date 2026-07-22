import { auth } from '@/auth';
import { ActionExecutionReceipt } from '@/components/actions/ActionExecutionReceipt';
import { OutcomeTimeline } from '@/components/outcomes/OutcomeTimeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listActionOutcomes } from '@/lib/action-outcome-observation-store';
import type { AppRunView } from '@/lib/app-runs-view';
import { currentOrgId } from '@/lib/tenancy';

export async function RunOutcomeEvidence({ run }: Readonly<{ run: AppRunView }>) {
  const actionSteps = run.steps.filter((step) => step.actionReceipt);
  if (!actionSteps.length) return null;
  const [orgId, session] = await Promise.all([currentOrgId(), auth()]);
  const canManage = session?.user?.role === 'admin';

  return (
    <section className="w-full space-y-4" aria-labelledby="action-and-result-heading">
      <div>
        <h2 id="action-and-result-heading" className="text-base font-semibold text-foreground">
          Action and result
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          System completion and business success are recorded separately.
        </p>
      </div>
      {actionSteps.map(async (step) => {
        const receipt = step.actionReceipt!;
        try {
          const records = await listActionOutcomes(run.id, step.id, orgId);
          return (
            <div key={step.id} className="grid min-w-0 gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  System change completed
                </p>
                <ActionExecutionReceipt receipt={receipt} />
              </div>
              <div className="min-w-0 lg:pt-6">
                <OutcomeTimeline
                  appId={run.appId}
                  runId={run.id}
                  stepId={step.id}
                  records={records}
                  canManage={canManage}
                />
              </div>
            </div>
          );
        } catch {
          return (
            <div key={step.id} className="grid min-w-0 gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  System change completed
                </p>
                <ActionExecutionReceipt receipt={receipt} />
              </div>
              <Card className="min-w-0 lg:mt-6" role="alert">
                <CardHeader>
                  <CardTitle className="text-base">Business results could not be loaded</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  The system receipt is still available. Refresh this page to try again.
                </CardContent>
              </Card>
            </div>
          );
        }
      })}
    </section>
  );
}
