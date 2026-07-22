import { ArrowRight, ClockCounterClockwise } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import { presentActionOutcomes } from '@/lib/action-outcome-presenter';
import { actionOutcomeDetailHref, newActionOutcomeHref } from '@/lib/action-outcome-routes';

interface OutcomeTimelineProps {
  appId: string;
  runId: string;
  stepId: string;
  records: ActionOutcomeRecord[];
  canManage: boolean;
}

export function OutcomeTimeline({
  appId,
  runId,
  stepId,
  records,
  canManage,
}: OutcomeTimelineProps) {
  const view = presentActionOutcomes(records);
  const createHref = newActionOutcomeHref(
    appId,
    runId,
    stepId,
    view.nextAction?.kind === 'record-conversion' ? 'converted' : undefined,
  );

  return (
    <Card className="h-full border-border" aria-label="Business result">
      <CardHeader className="space-y-2 pb-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Business result</p>
        <CardTitle className="text-base">
          {view.currentCopy?.label ?? 'Business result not known'}
        </CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {view.currentCopy?.detail ??
            'The system change is complete. What happened afterward has not been recorded.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.nextAction && canManage ? (
          <Button asChild className="min-h-11 w-full sm:w-auto">
            <Link href={createHref}>
              {view.nextAction.label} <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : !canManage ? (
          <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Your role can view business results but cannot record or correct them.
          </p>
        ) : null}

        <section
          className="border-t border-border pt-3"
          aria-labelledby={`outcome-history-${stepId}`}
        >
          <h3
            id={`outcome-history-${stepId}`}
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Result history
          </h3>
          {view.history.length ? (
            <ol className="mt-3 space-y-3">
              {view.history.map((item) => (
                <li key={item.record.id} className="border-l border-border pl-3">
                  <Link
                    href={actionOutcomeDetailHref(appId, runId, stepId, item.record.id)}
                    className="group block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground group-hover:text-primary">
                        {item.label}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {item.stateLabel}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {new Date(item.record.observedAt).toLocaleString()} · recorded by{' '}
                      {item.record.recordedBy}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              <ClockCounterClockwise className="mt-0.5 size-4 shrink-0" aria-hidden />
              No business result has been recorded for this action.
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
