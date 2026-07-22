import { CheckCircle, ClockCounterClockwise } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionReceipt } from '@/lib/action-contract';

const STATUS_COPY: Record<ActionReceipt['status'], string> = {
  executed: 'Completed',
  replayed: 'Completed from the retained receipt',
};

export function ActionExecutionReceipt({ receipt }: Readonly<{ receipt: ActionReceipt }>) {
  const retainedEvidence = [receipt.approval.evidence, 'Signed provider receipt'].filter(Boolean);
  return (
    <Card aria-label="Execution receipt" className="border-border">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Execution receipt
          </p>
          <div
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground"
            role="status"
            aria-live="polite"
          >
            <ReceiptStatusIcon status={receipt.status} />
            {STATUS_COPY[receipt.status]}
          </div>
        </div>
        <CardTitle className="text-base leading-snug text-foreground">{receipt.label}</CardTitle>
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          Receipt {receipt.idempotencyKey}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid min-w-0 gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
          <ReceiptFact label="System" value={receipt.system} />
          <ReceiptFact label="Changed record" value={receipt.target} />
          <ReceiptFact
            label="Approved by"
            value={receipt.approval.reviewer ?? 'Reviewer identity was not recorded'}
          />
          <ReceiptFact label="Completed" value={receipt.executedAt} />
          <ReceiptFact label="Run" value={receipt.runId} />
          <ReceiptFact label="Step" value={receipt.stepId} />
        </dl>

        <section className="border-t border-border pt-3" aria-label="Retained evidence">
          <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Retained evidence
          </h3>
          {retainedEvidence.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {retainedEvidence.map((item) => (
                <li key={item} className="min-w-0 break-words">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              The receipt is retained. No supporting artifacts were attached.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function ReceiptFact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0 border-t border-border pt-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-foreground">{value}</dd>
    </div>
  );
}

function ReceiptStatusIcon({ status }: Readonly<{ status: ActionReceipt['status'] }>) {
  if (status === 'executed') {
    return <CheckCircle className="size-4 text-primary" weight="fill" aria-hidden />;
  }
  return <ClockCounterClockwise className="size-4 text-primary" aria-hidden />;
}
