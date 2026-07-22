import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  CrossSellEvidenceState,
  CrossSellOpportunityView,
} from '@/lib/bank-cross-sell-contract';
import { formatInr } from '@/lib/cockpit-metrics';

export interface CrossSellQueueRow {
  opportunity: CrossSellOpportunityView;
  evidence: CrossSellEvidenceState;
}

function phaseLabel(phase: CrossSellEvidenceState['phase']): string {
  switch (phase) {
    case 'needs-context':
      return 'Context unavailable';
    case 'needs-recommendation':
      return 'Recommendation needed';
    case 'needs-rm-decision':
      return 'Ready for review';
    case 'needs-writeback':
      return 'CRM update pending';
    case 'needs-outcome':
      return 'Waiting for customer result';
    case 'measured':
      return 'Result recorded';
  }
}

export function CrossSellOpportunityQueue({
  rows,
  customerHrefBase,
}: Readonly<{ rows: CrossSellQueueRow[]; customerHrefBase: string }>) {
  const live = rows.filter((row) => row.opportunity.source.kind === 'live').length;
  const ready = rows.filter((row) => row.evidence.phase === 'needs-rm-decision').length;
  const waiting = rows.filter((row) => row.evidence.phase === 'needs-outcome').length;
  const measured = rows.filter((row) => row.evidence.phase === 'measured').length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Live customer records', live],
          ['Ready for your review', ready],
          ['Waiting for a result', waiting],
          ['Results recorded', measured],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-medium tabular-nums">{value}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm font-medium">Customer opportunities</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Ranked from the customer and eligibility sources approved for this App.
            </p>
          </div>
          <Badge variant="outline">Live sources only</Badge>
        </CardHeader>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <div className="border-t px-5 py-10 text-sm text-muted-foreground" role="status">
              No live customer opportunities are available. Check the App&apos;s customer and
              eligibility source bindings, then try again.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-y text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 font-normal">Customer</th>
                    <th className="px-3 py-3 font-normal">Recommended action</th>
                    <th className="px-3 py-3 font-normal">Evidence state</th>
                    <th className="px-3 py-3 text-right font-normal">Potential value</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ opportunity, evidence }) => (
                    <tr key={opportunity.opportunityId} className="border-b last:border-b-0">
                      <td className="px-5 py-4">
                        <p className="font-medium">{opportunity.customerName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {opportunity.segment} · {opportunity.region} ·{' '}
                          {opportunity.relationshipManager}
                        </p>
                      </td>
                      <td className="max-w-md px-3 py-4">
                        <p>{opportunity.recommendation?.product || 'Recommendation unavailable'}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {opportunity.recommendation?.rationale || evidence.missing.join(' · ')}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <Badge variant="secondary">{phaseLabel(evidence.phase)}</Badge>
                      </td>
                      <td className="px-3 py-4 text-right tabular-nums">
                        {opportunity.opportunityValueInr > 0
                          ? formatInr(opportunity.opportunityValueInr)
                          : 'Not measured'}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`${customerHrefBase}${encodeURIComponent(opportunity.customerId)}`}
                          className="inline-flex min-h-11 items-center gap-2 text-xs text-primary hover:underline"
                        >
                          Review <ArrowRight aria-hidden className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
