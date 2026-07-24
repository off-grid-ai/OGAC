import { CheckCircle, Database, ShieldCheck, Warning } from '@phosphor-icons/react/dist/ssr';
import { ActionExecutionReceipt } from '@/components/actions/ActionExecutionReceipt';
import { CrossSellDecisionPanel } from '@/components/app-use/CrossSellDecisionPanel';
import { CrossSellOutcomeEntry } from '@/components/app-use/CrossSellOutcomeEntry';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import type {
  CrossSellEvidenceState,
  CrossSellOpportunityView,
} from '@/lib/bank-cross-sell-contract';
import { formatInr } from '@/lib/cockpit-metrics';

const PHASE_COPY: Record<CrossSellEvidenceState['phase'], string> = {
  'needs-context': 'Source context needed',
  'needs-recommendation': 'Ready to prepare',
  'needs-rm-decision': 'Your review is needed',
  'needs-writeback': 'CRM update in progress',
  'needs-outcome': 'Waiting for the customer result',
  measured: 'Business result recorded',
};

export function CrossSellSourceUnavailable() {
  return (
    <Card>
      <CardContent className="py-6">
        <ErrorState
          title="Live opportunity data is unavailable"
          description="No recommendations were generated. Ask an administrator to check this App’s customer and eligibility source bindings, then refresh the page."
        />
      </CardContent>
    </Card>
  );
}

export function CrossSellCustomerJourney({
  slug,
  opportunity,
  evidence,
}: Readonly<{
  slug: string;
  opportunity: CrossSellOpportunityView;
  evidence: CrossSellEvidenceState;
}>) {
  const recommendation = opportunity.recommendation;
  const currentOutcomes = opportunity.outcomes.filter((outcome) => outcome.status !== 'withdrawn');
  const outcomeEntryMode =
    currentOutcomes.length === 0
      ? 'initial'
      : currentOutcomes.some(
            (outcome) => outcome.status === 'converted' || outcome.status === 'rejected',
          )
        ? null
        : currentOutcomes.some((outcome) => outcome.status === 'accepted')
          ? 'conversion'
          : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{opportunity.customerName}</h1>
            <Badge variant="secondary">{PHASE_COPY[evidence.phase]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {opportunity.segment} · {opportunity.region} · managed by{' '}
            {opportunity.relationshipManager}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Potential value
          </p>
          <p className="mt-1 text-xl font-medium tabular-nums">
            {opportunity.opportunityValueInr > 0
              ? formatInr(opportunity.opportunityValueInr)
              : 'Not measured'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.75fr)]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Recommended customer conversation</CardTitle>
                {recommendation ? (
                  <Badge variant={recommendation.eligible ? 'secondary' : 'outline'}>
                    {recommendation.eligible ? 'Eligible' : 'Blocked by policy'}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Generated only from sources approved for this App. Nothing is written to CRM until a
                relationship manager approves.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {recommendation ? (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Product
                    </p>
                    <p className="mt-1 text-lg font-medium">{recommendation.product}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {recommendation.rationale}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact
                      label="Recommendation confidence"
                      value={`${Math.round(recommendation.confidence * 100)}%`}
                    />
                    <Fact label="Customer record" value={opportunity.customerId} mono />
                  </div>
                  {recommendation.constraints.length > 0 ? (
                    <div className="border-l-2 border-destructive pl-3" role="alert">
                      <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                        <Warning className="size-4 text-destructive" aria-hidden /> Why this is blocked
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {recommendation.constraints.map((constraint) => (
                          <li key={constraint}>{constraint}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground" role="status">
                  The governed sources do not contain enough evidence to prepare a recommendation.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Database className="size-4 text-primary" aria-hidden /> Evidence used
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recommendation?.citations.map((citation) => (
                <div key={`${citation.source}:${citation.record}`} className="border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{citation.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{citation.source}</p>
                    </div>
                    <code className="break-all text-[11px] text-muted-foreground">
                      {citation.record}
                    </code>
                  </div>
                </div>
              ))}
              <p className="border-t pt-3 text-[11px] text-muted-foreground">
                Sources read {formatDate(opportunity.source.readAt)}. Raw source data remains in the
                approved enterprise systems.
              </p>
            </CardContent>
          </Card>

          {opportunity.actionReceipt ? (
            <ActionExecutionReceipt receipt={opportunity.actionReceipt} />
          ) : null}

          {opportunity.actionReceipt && outcomeEntryMode ? (
            <CrossSellOutcomeEntry
              slug={slug}
              customerId={opportunity.customerId}
              receipt={opportunity.actionReceipt}
              mode={outcomeEntryMode}
            />
          ) : null}

          {opportunity.actionReceipt ? (
            <Card aria-label="Customer result history">
              <CardHeader className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Result history
                </p>
                <CardTitle className="text-sm font-medium">
                  {opportunity.outcomes.length === 0
                    ? 'Business result not known'
                    : 'Observed customer results'}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  CRM completion confirms the system change. Only these observations describe what
                  happened afterward.
                </p>
              </CardHeader>
              <CardContent>
                {opportunity.outcomes.length === 0 ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    No customer result has been observed yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {opportunity.outcomes.map((outcome) => (
                      <li key={`${outcome.observedAt}:${outcome.evidenceHref}`} className="border-l-2 border-primary pl-3">
                        <p className="flex items-center gap-2 text-sm font-medium capitalize">
                          <CheckCircle className="size-4 text-primary" weight="fill" aria-hidden />
                          {outcome.status}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(outcome.observedAt)}
                          {outcome.value !== null && outcome.currency
                            ? // Pin the grouping locale: this is Indian BFSI money (INR), so it
                              // must read 1,25,000 — and a bare toLocaleString() would otherwise
                              // follow the host's default locale, making the output non-deterministic.
                              ` · ${outcome.currency} ${outcome.value.toLocaleString('en-IN')}`
                            : ''}
                        </p>
                        <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                          Evidence: {outcome.evidenceHref}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4">
          <CrossSellDecisionPanel slug={slug} opportunity={opportunity} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 text-primary" aria-hidden /> Governed journey
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-xs">
                {[
                  ['Live context', true],
                  ['Cited recommendation', Boolean(recommendation && opportunity.runId)],
                  ['RM decision', opportunity.rmDecision.status !== 'pending'],
                  ['CRM execution receipt', Boolean(opportunity.actionReceipt)],
                  ['Customer result', opportunity.outcomes.length > 0],
                ].map(([label, complete]) => (
                  <li key={String(label)} className="flex items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
                    <span>{label}</span>
                    <Badge variant={complete ? 'secondary' : 'outline'}>
                      {complete ? 'Complete' : 'Pending'}
                    </Badge>
                  </li>
                ))}
              </ol>
              {opportunity.rmDecision.status !== 'pending' ? (
                <div className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                  <p className="font-medium capitalize text-foreground">
                    {opportunity.rmDecision.status} by {opportunity.rmDecision.reviewer}
                  </p>
                  <p className="mt-1">{opportunity.rmDecision.reason}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, value, mono = false }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="border-t pt-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? 'mt-1 font-mono text-xs' : 'mt-1 text-sm'}>{value}</p>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toLocaleString('en-IN') : value;
}
