import { ArrowLeft, ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CAPABILITY_GATE_LABELS,
  CAPABILITY_GATES,
  capabilityCoveragePercent,
  summarizeServiceCapabilityAudit,
  type CapabilityGateAssessment,
  type ServiceCapabilityAudit,
} from '@/lib/service-capability-map';

const STATUS_LABEL: Readonly<Record<CapabilityGateAssessment['status'], string>> = {
  yes: 'verified',
  partial: 'partial',
  no: 'gap',
};

const STATUS_VARIANT: Readonly<
  Record<CapabilityGateAssessment['status'], 'default' | 'secondary' | 'outline'>
> = {
  yes: 'default',
  partial: 'secondary',
  no: 'outline',
};

function GateBadge({ assessment }: Readonly<{ assessment: CapabilityGateAssessment }>) {
  return (
    <Badge
      variant={STATUS_VARIANT[assessment.status]}
      className="rounded-md font-mono text-[10px] font-normal uppercase"
      title={assessment.evidence}
      aria-label={`${STATUS_LABEL[assessment.status]}. ${assessment.evidence}`}
    >
      {STATUS_LABEL[assessment.status]}
    </Badge>
  );
}

function AuditSummaryCard({
  audit,
  active,
}: Readonly<{ audit: ServiceCapabilityAudit; active: boolean }>) {
  const summary = summarizeServiceCapabilityAudit(audit.serviceId);
  if (summary.status !== 'audited') return null;
  const coverage = capabilityCoveragePercent(summary);
  return (
    <Card asChild className={active ? 'border-primary' : undefined}>
      <Link
        href={`/operations/services/capability-map?service=${encodeURIComponent(audit.serviceId)}`}
        data-og-interactive
        aria-current={active ? 'page' : undefined}
      >
        <CardHeader className="gap-1.5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-sm">{audit.serviceLabel}</CardTitle>
            <Badge variant="outline" className="rounded-md font-mono text-[10px] font-normal">
              {audit.upstreamVersion}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {summary.productionItems}/{summary.totalItems} capabilities reach a production workflow
          </p>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Progress value={coverage} max={100} aria-label={`${coverage}% verified audit gates`} />
          <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>
              {summary.verifiedGates}/{summary.totalGates} verified gates
            </span>
            <span>{summary.partialGates} partial</span>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

function AuditTable({ audit }: Readonly<{ audit: ServiceCapabilityAudit }>) {
  const summary = summarizeServiceCapabilityAudit(audit.serviceId);
  if (summary.status !== 'audited') return null;

  return (
    <Card id={audit.serviceId} className="scroll-mt-6">
      <CardHeader className="gap-3 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base">{audit.serviceLabel}</CardTitle>
            <p className="max-w-5xl text-xs text-muted-foreground">{audit.summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md font-mono text-[10px] font-normal">
              upstream {audit.upstreamVersion}
            </Badge>
            <Badge variant="outline" className="rounded-md font-mono text-[10px] font-normal">
              audited {audit.auditedAt}
            </Badge>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(12rem,28rem)_auto] sm:items-center">
          <Progress
            value={capabilityCoveragePercent(summary)}
            max={100}
            aria-label={`${audit.serviceLabel}: ${summary.verifiedGates} of ${summary.totalGates} audit gates verified`}
          />
          <p className="font-mono text-[10px] text-muted-foreground sm:text-right">
            {summary.verifiedGates}/{summary.totalGates} verified / {summary.partialGates} partial /{' '}
            {summary.productionItems}/{summary.totalItems} in production workflows
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64 px-4">Capability</TableHead>
              {CAPABILITY_GATES.map((gate) => (
                <TableHead key={gate} className="min-w-32">
                  {CAPABILITY_GATE_LABELS[gate]}
                </TableHead>
              ))}
              <TableHead className="min-w-80">Concrete gap</TableHead>
              <TableHead className="min-w-40 pr-4">Operator route</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <p className="text-xs font-medium text-foreground">{item.name}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {item.summary}
                  </p>
                </TableCell>
                {CAPABILITY_GATES.map((gate) => (
                  <TableCell key={gate} className="py-3 align-top whitespace-normal">
                    <GateBadge assessment={item.gates[gate]} />
                  </TableCell>
                ))}
                <TableCell className="py-3 align-top whitespace-normal">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {item.gap || 'No gap in the audited four-gate path.'}
                  </p>
                </TableCell>
                <TableCell className="py-3 pr-4 align-top whitespace-normal">
                  <Link
                    href={item.uiHref}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    {item.uiLabel}
                    <ArrowSquareOut className="size-3 shrink-0" aria-hidden="true" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function ServiceCapabilityMap({
  audits,
  selectedServiceId,
}: Readonly<{
  audits: readonly ServiceCapabilityAudit[];
  selectedServiceId: string | null;
}>) {
  const visibleAudits = selectedServiceId
    ? audits.filter((audit) => audit.serviceId === selectedServiceId)
    : audits;
  const selectionMissing = selectedServiceId !== null && visibleAudits.length === 0;

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Operations / Services
          </p>
          <h1 className="text-lg font-semibold text-foreground">Service capability map</h1>
          <p className="max-w-4xl text-sm text-muted-foreground">
            See what each audited service offers, what the console actually integrates, what the UI
            exposes, and what a real production workflow uses. Those are four different claims.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedServiceId ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/operations/services/capability-map">Show all audited services</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href="/operations/services">
              <ArrowLeft className="size-4" aria-hidden="true" /> Services directory
            </Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="capability-map-summary" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="capability-map-summary"
              className="text-xs font-semibold uppercase tracking-wide"
            >
              Audited services
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Verified coverage counts only yes gates. Partial work remains visible and is not
              rounded up.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Capability gate legend">
            <GateBadge assessment={{ status: 'yes', evidence: 'Verified by the audit.' }} />
            <GateBadge
              assessment={{ status: 'partial', evidence: 'Only part of the gate is proven.' }}
            />
            <GateBadge
              assessment={{ status: 'no', evidence: 'The gate is not implemented or verified.' }}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {audits.map((audit) => (
            <AuditSummaryCard
              key={audit.serviceId}
              audit={audit}
              active={selectedServiceId === audit.serviceId}
            />
          ))}
        </div>
      </section>

      {selectionMissing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">This service has not been audited</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            No denominator or coverage percentage is assigned. Choose one of the five audited
            services above or return to the full map.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {visibleAudits.map((audit) => (
            <AuditTable key={audit.serviceId} audit={audit} />
          ))}
        </div>
      )}
    </div>
  );
}
