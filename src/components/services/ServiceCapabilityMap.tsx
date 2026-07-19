import { ArrowLeft, ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import {
  filterServiceInventory,
  SERVICE_INVENTORY_FAMILIES,
  SERVICE_INVENTORY_OWNERS,
  serviceCapabilityMapHref,
  type LogicalServiceInventoryEntry,
  type ServiceInventoryFilter,
  type ServiceInventoryReconciliation,
} from '@/lib/service-inventory';

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

const FAMILY_LABELS: Readonly<Record<(typeof SERVICE_INVENTORY_FAMILIES)[number], string>> = {
  data: 'Data',
  runtime: 'AI runtime',
  governance: 'Governance',
  observability: 'Observability',
  operations: 'Operations',
  'enterprise-source': 'Enterprise source',
};

const OWNER_LABELS: Readonly<Record<(typeof SERVICE_INVENTORY_OWNERS)[number], string>> = {
  'operations-services': 'Operations / Services',
  'data-sources': 'Data / Sources',
};

function operationalState(entry: LogicalServiceInventoryEntry): {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
} {
  const states = Object.values(entry.readiness);
  if (states.includes('fail')) return { label: 'attention', variant: 'destructive' };
  const passing = states.filter((state) => state === 'pass').length;
  const unknown = states.filter((state) => state === 'unknown').length;
  if (passing > 0 && unknown === 0) return { label: 'verified', variant: 'default' };
  if (passing > 0) return { label: 'partial evidence', variant: 'secondary' };
  return { label: 'not verified', variant: 'outline' };
}

function inventoryRouteLabel(entry: LogicalServiceInventoryEntry): string {
  return entry.owner === 'operations-services' ? 'Service detail' : 'Data sources';
}

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
  inventoryFilter,
}: Readonly<{
  audit: ServiceCapabilityAudit;
  active: boolean;
  inventoryFilter: ServiceInventoryFilter;
}>) {
  const summary = summarizeServiceCapabilityAudit(audit.serviceId);
  if (summary.status !== 'audited') return null;
  const coverage = capabilityCoveragePercent(summary);
  return (
    <Card
      asChild
      className={
        active ? 'h-full min-w-0 overflow-hidden border-primary' : 'h-full min-w-0 overflow-hidden'
      }
    >
      <Link
        href={serviceCapabilityMapHref({ ...inventoryFilter, serviceId: audit.serviceId })}
        data-og-interactive
        data-capability-summary-card={audit.serviceId}
        aria-current={active ? 'page' : undefined}
      >
        <CardHeader className="pb-3">
          <div className="col-span-full min-w-0 space-y-2">
            <div
              className="flex min-w-0 items-start justify-between gap-2"
              data-capability-summary-identity={audit.serviceId}
            >
              <CardTitle className="min-w-0 break-words text-sm leading-snug">
                {audit.serviceLabel}
              </CardTitle>
            </div>
            <div
              className="flex min-w-0 flex-wrap items-start gap-1.5"
              data-capability-summary-metadata={audit.serviceId}
              aria-label={`${audit.serviceLabel} audit metadata`}
            >
              <Badge
                variant="outline"
                className="max-w-full min-w-0 shrink whitespace-normal break-all rounded-md text-left font-mono text-[10px] leading-tight font-normal"
              >
                version {audit.upstreamVersion}
              </Badge>
              <Badge
                variant="outline"
                className="max-w-full min-w-0 shrink whitespace-normal break-all rounded-md text-left font-mono text-[10px] leading-tight font-normal"
                title={audit.versionSource}
              >
                source {audit.versionSource}
              </Badge>
            </div>
            <CardDescription
              className="min-w-0 text-[11px] leading-relaxed"
              data-capability-summary-description={audit.serviceId}
            >
              {summary.productionItems}/{summary.totalItems} capabilities reach a production
              workflow
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="mt-auto min-w-0 space-y-2 pt-0">
          <Progress value={coverage} max={100} aria-label={`${coverage}% verified audit gates`} />
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
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

function InventoryStats({ inventory }: Readonly<{ inventory: ServiceInventoryReconciliation }>) {
  const audited = inventory.entries.filter(
    (entry) => entry.capabilityAudit.status === 'audited',
  ).length;
  const pending = inventory.totalCount - audited;

  return (
    <Card>
      <CardContent className="grid grid-cols-1 divide-y divide-border p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          { label: 'Total inventory', value: inventory.totalCount },
          { label: 'Capability audited', value: audited },
          { label: 'Audit pending', value: pending },
        ].map((stat) => (
          <div key={stat.label} className="min-w-0 px-4 py-3" data-inventory-stat={stat.label}>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 text-xl font-medium text-foreground">{stat.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FullServiceInventory({
  inventory,
  filter,
  selectedServiceId,
}: Readonly<{
  inventory: ServiceInventoryReconciliation;
  filter: ServiceInventoryFilter;
  selectedServiceId: string | null;
}>) {
  const visibleEntries = filterServiceInventory(inventory.entries, filter);
  const hasFilter = Boolean(filter.query?.trim() || filter.family || filter.owner);

  return (
    <section aria-labelledby="full-service-inventory" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="full-service-inventory" className="text-xs font-semibold uppercase tracking-wide">
            Full service inventory
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            43 platform entries live in Operations / Services. Six enterprise systems live in Data /
            Sources. Pending means no versioned capability denominator has been audited yet.
          </p>
        </div>
        <Badge variant={inventory.exactContract ? 'default' : 'destructive'} className="rounded-md">
          {inventory.exactContract
            ? '49-entry contract matched'
            : 'inventory reconciliation failed'}
        </Badge>
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <form
            action="/operations/services/capability-map"
            method="get"
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_minmax(10rem,14rem)_minmax(10rem,14rem)_auto_auto]"
            role="search"
          >
            {selectedServiceId ? (
              <input type="hidden" name="service" value={selectedServiceId} />
            ) : null}
            <Input
              type="search"
              name="q"
              defaultValue={filter.query}
              placeholder="Search service, role, gap, or next action"
              aria-label="Search full service inventory"
              className="sm:col-span-2 xl:col-span-1"
            />
            <NativeSelect
              name="family"
              defaultValue={filter.family}
              aria-label="Filter inventory by family"
            >
              <option value="">All families</option>
              {SERVICE_INVENTORY_FAMILIES.map((family) => (
                <option key={family} value={family}>
                  {FAMILY_LABELS[family]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              name="owner"
              defaultValue={filter.owner}
              aria-label="Filter inventory by IA owner"
            >
              <option value="">Both IA owners</option>
              {SERVICE_INVENTORY_OWNERS.map((owner) => (
                <option key={owner} value={owner}>
                  {OWNER_LABELS[owner]}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {hasFilter ? (
              <Button asChild variant="outline" size="sm">
                <Link href={serviceCapabilityMapHref({ serviceId: selectedServiceId })}>Clear</Link>
              </Button>
            ) : null}
          </form>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 font-mono text-[10px] text-muted-foreground">
            <span>
              {visibleEntries.length}/{inventory.totalCount} entries
            </span>
            <span>{inventory.enterpriseSourceCount} enterprise sources</span>
          </div>
          {visibleEntries.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-foreground">No inventory entry matches these filters.</p>
              <Button asChild variant="link" size="sm" className="mt-1">
                <Link href={serviceCapabilityMapHref({ serviceId: selectedServiceId })}>
                  Clear filters
                </Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56 px-4">Service</TableHead>
                  <TableHead className="min-w-36">Family / role</TableHead>
                  <TableHead className="min-w-40">IA owner</TableHead>
                  <TableHead className="min-w-36">Operational</TableHead>
                  <TableHead className="min-w-32">Capability audit</TableHead>
                  <TableHead className="min-w-72">Next action</TableHead>
                  <TableHead className="min-w-32 pr-4">Canonical route</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEntries.map((entry) => {
                  const operational = operationalState(entry);
                  return (
                    <TableRow key={entry.id} data-service-inventory-row={entry.id}>
                      <TableCell className="px-4 py-3 align-top whitespace-normal">
                        <p className="text-xs font-medium text-foreground">{entry.label}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {entry.id}
                        </p>
                      </TableCell>
                      <TableCell className="py-3 align-top whitespace-normal">
                        <Badge variant="outline" className="rounded-md font-normal">
                          {entry.family === 'unclassified'
                            ? 'Unclassified'
                            : FAMILY_LABELS[entry.family]}
                        </Badge>
                        <p className="mt-1 text-[10px] text-muted-foreground">{entry.role}</p>
                      </TableCell>
                      <TableCell className="py-3 align-top whitespace-normal text-[11px] text-muted-foreground">
                        {OWNER_LABELS[entry.owner]}
                      </TableCell>
                      <TableCell className="py-3 align-top whitespace-normal">
                        <Badge variant={operational.variant} className="rounded-md font-normal">
                          {operational.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 align-top whitespace-normal">
                        <Badge
                          variant={
                            entry.capabilityAudit.status === 'audited' ? 'default' : 'outline'
                          }
                          className="rounded-md font-normal"
                        >
                          {entry.capabilityAudit.status === 'audited' ? 'audited' : 'pending'}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 align-top whitespace-normal">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {entry.nextAction}
                        </p>
                      </TableCell>
                      <TableCell className="py-3 pr-4 align-top whitespace-normal">
                        <Link
                          href={entry.routes.management}
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          {inventoryRouteLabel(entry)}
                          <ArrowSquareOut className="size-3 shrink-0" aria-hidden="true" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function ServiceCapabilityMap({
  audits,
  inventory,
  inventoryFilter,
  selectedServiceId,
}: Readonly<{
  audits: readonly ServiceCapabilityAudit[];
  inventory: ServiceInventoryReconciliation;
  inventoryFilter: ServiceInventoryFilter;
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
              <Link href={serviceCapabilityMapHref(inventoryFilter)}>
                Show all audited services
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href="/operations/services">
              <ArrowLeft className="size-4" aria-hidden="true" /> Services directory
            </Link>
          </Button>
        </div>
      </header>

      <InventoryStats inventory={inventory} />

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
              These {audits.length} services have versioned denominators. Verified coverage counts
              only yes gates. Partial work stays visible and is not rounded up.
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {audits.map((audit) => (
            <AuditSummaryCard
              key={audit.serviceId}
              audit={audit}
              active={selectedServiceId === audit.serviceId}
              inventoryFilter={inventoryFilter}
            />
          ))}
        </div>
      </section>

      {selectedServiceId && selectionMissing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">This service has not been audited</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            No denominator or coverage percentage is assigned. Choose an audited service above or
            use the full inventory to open its canonical owner.
          </CardContent>
        </Card>
      ) : selectedServiceId ? (
        <div className="space-y-6">
          {visibleAudits.map((audit) => (
            <AuditTable key={audit.serviceId} audit={audit} />
          ))}
        </div>
      ) : null}

      <FullServiceInventory
        inventory={inventory}
        filter={inventoryFilter}
        selectedServiceId={selectedServiceId}
      />

      {selectedServiceId === null ? (
        <div className="space-y-6">
          {visibleAudits.map((audit) => (
            <AuditTable key={audit.serviceId} audit={audit} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
