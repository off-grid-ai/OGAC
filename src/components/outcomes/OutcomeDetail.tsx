import { ArrowLeft, PencilSimple } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ActionExecutionReceipt } from '@/components/actions/ActionExecutionReceipt';
import { OutcomeWithdrawButton } from '@/components/outcomes/OutcomeWithdrawButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import { presentActionOutcomes, presentOutcomeMeasurement } from '@/lib/action-outcome-presenter';
import { appRunHref, correctActionOutcomeHref } from '@/lib/action-outcome-routes';

interface OutcomeDetailProps {
  appId: string;
  records: ActionOutcomeRecord[];
  observation: ActionOutcomeRecord;
  canManage: boolean;
  withdrawalEventId: string;
  withdrawalObservedAt: string;
}

export function OutcomeDetail({
  appId,
  records,
  observation,
  canManage,
  withdrawalEventId,
  withdrawalObservedAt,
}: Readonly<OutcomeDetailProps>) {
  const view = presentActionOutcomes(records);
  const item = view.history.find((candidate) => candidate.record.id === observation.id);
  const runHref = appRunHref(appId, observation.runId);
  const measurement = observation.measurement
    ? presentOutcomeMeasurement(observation.measurement)
    : null;

  return (
    <div className="w-full space-y-5">
      <Link
        href={runHref}
        className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden /> Run
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-primary">Business result</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            {item?.label ?? 'Business result'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{item?.detail ?? observation.note}</p>
        </div>
        {canManage && item?.canCorrect ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline" className="min-h-11">
              <Link
                href={correctActionOutcomeHref(
                  appId,
                  observation.runId,
                  observation.stepId,
                  observation.id,
                )}
              >
                <PencilSimple aria-hidden /> Correct this record
              </Link>
            </Button>
            <OutcomeWithdrawButton
              appId={appId}
              runId={observation.runId}
              stepId={observation.stepId}
              outcomeId={observation.id}
              eventId={withdrawalEventId}
              observedAt={withdrawalObservedAt}
            />
          </div>
        ) : null}
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            System change completed
          </p>
          <ActionExecutionReceipt receipt={observation.actionReceipt} />
        </div>
        <Card className="min-w-0 lg:mt-6">
          <CardHeader>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Business result observed
            </p>
            <CardTitle className="text-base">{item?.label ?? 'Business result'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Observed" value={new Date(observation.observedAt).toLocaleString()} />
              <Fact label="Recorded by" value={observation.recordedBy} />
              <Fact label="Record state" value={item?.stateLabel ?? 'Current'} />
              <Fact label="Target" value={observation.target} />
            </dl>
            <div className="border-t border-border pt-3">
              <h2 className="text-[10px] uppercase tracking-wide text-muted-foreground">
                What confirms this result
              </h2>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{observation.note}</p>
            </div>
            {measurement ? (
              <div className="border-t border-border pt-3">
                <h2 className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Measured result
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">{measurement.metricName}</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  <MeasurementFact label="Before action" value={measurement.baselineValue} />
                  <MeasurementFact label="After action" value={measurement.resultValue} />
                  <MeasurementFact
                    label="Change"
                    value={measurement.changeValue}
                    detail={measurement.changeDetail}
                  />
                </dl>
              </div>
            ) : null}
            <div className="border-t border-border pt-3">
              <h2 className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Supporting evidence
              </h2>
              <ul className="mt-2 space-y-1">
                {observation.evidenceLinks.map((href) => (
                  <li key={href}>
                    <a href={href} className="break-all text-xs text-primary hover:underline">
                      {href}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {!canManage ? (
        <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          Your role can view business results but cannot record or correct them.
        </p>
      ) : null}
    </div>
  );
}

function MeasurementFact({
  label,
  value,
  detail,
}: Readonly<{ label: string; value: string; detail?: string | null }>) {
  return (
    <div className="min-w-0 border-t border-border pt-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-semibold tabular-nums text-foreground">{value}</dd>
      {detail ? <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0 border-t border-border pt-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-foreground">{value}</dd>
    </div>
  );
}
