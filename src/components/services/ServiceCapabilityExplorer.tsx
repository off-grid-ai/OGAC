import { ArrowLeft, ArrowSquareOut, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  type ServiceInventoryFamily,
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

const FAMILY_LABELS: Readonly<Record<Exclude<ServiceInventoryFamily, 'unclassified'>, string>> = {
  data: 'Data',
  runtime: 'AI runtime',
  governance: 'Governance',
  observability: 'Observability',
  operations: 'Operations',
  'enterprise-source': 'Enterprise sources',
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

function OverviewRail({ inventory }: Readonly<{ inventory: ServiceInventoryReconciliation }>) {
  const audited = inventory.entries.filter(
    (entry) => entry.capabilityAudit.status === 'audited',
  ).length;
  const operational = inventory.entries.filter((entry) => {
    const readiness = Object.values(entry.readiness);
    return readiness.some((state) => state === 'pass') && !readiness.includes('fail');
  }).length;

  return (
    <div
      className="grid min-w-full grid-cols-2 divide-x divide-border border-y border-border md:min-w-0 md:grid-cols-4 md:border md:bg-card"
      aria-label="Capability map overview"
    >
      {[
        { label: 'Inventory', value: inventory.totalCount },
        { label: 'Audited', value: audited },
        { label: 'Operational evidence', value: operational },
        { label: 'Pending audit', value: inventory.totalCount - audited },
      ].map((stat) => (
        <div key={stat.label} className="min-w-0 px-3 py-2">
          <p className="truncate font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            {stat.label}
          </p>
          <p className="mt-0.5 text-base text-foreground">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function FamilyNavigation({
  filter,
  selectedServiceId,
  inventory,
}: Readonly<{
  filter: ServiceInventoryFilter;
  selectedServiceId: string | null;
  inventory: ServiceInventoryReconciliation;
}>) {
  const counts = new Map<ServiceInventoryFamily, number>();
  for (const entry of inventory.entries) {
    counts.set(entry.family, (counts.get(entry.family) ?? 0) + 1);
  }

  return (
    <nav aria-label="Service families" className="flex min-w-0 gap-1 overflow-x-auto pb-1">
      <Button
        asChild
        variant={!filter.family ? 'secondary' : 'ghost'}
        size="sm"
        className="shrink-0"
      >
        <Link
          href={serviceCapabilityMapHref({
            query: filter.query,
            owner: filter.owner,
            serviceId: selectedServiceId,
          })}
          aria-current={!filter.family ? 'page' : undefined}
        >
          All <span className="text-muted-foreground">{inventory.totalCount}</span>
        </Link>
      </Button>
      {SERVICE_INVENTORY_FAMILIES.map((family) => (
        <Button
          key={family}
          asChild
          variant={filter.family === family ? 'secondary' : 'ghost'}
          size="sm"
          className="shrink-0"
        >
          <Link
            href={serviceCapabilityMapHref({
              query: filter.query,
              family,
              owner: filter.owner,
              serviceId: selectedServiceId,
            })}
            aria-current={filter.family === family ? 'page' : undefined}
          >
            {FAMILY_LABELS[family]}{' '}
            <span className="text-muted-foreground">{counts.get(family) ?? 0}</span>
          </Link>
        </Button>
      ))}
    </nav>
  );
}

function InventoryFilters({
  filter,
  selectedServiceId,
}: Readonly<{ filter: ServiceInventoryFilter; selectedServiceId: string | null }>) {
  const hasFilter = Boolean(filter.query?.trim() || filter.family || filter.owner);

  return (
    <form
      action="/operations/services/capability-map"
      method="get"
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
      role="search"
    >
      {selectedServiceId ? <input type="hidden" name="service" value={selectedServiceId} /> : null}
      {filter.family ? <input type="hidden" name="family" value={filter.family} /> : null}
      <div className="relative min-w-0">
        <MagnifyingGlass
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          name="q"
          defaultValue={filter.query}
          placeholder="Search services"
          aria-label="Search service inventory"
          className="pl-8"
        />
      </div>
      <Button type="submit" size="sm">
        Search
      </Button>
      <NativeSelect
        name="owner"
        defaultValue={filter.owner}
        aria-label="Filter services by IA owner"
        className="col-span-1"
      >
        <option value="">Both IA owners</option>
        {SERVICE_INVENTORY_OWNERS.map((owner) => (
          <option key={owner} value={owner}>
            {OWNER_LABELS[owner]}
          </option>
        ))}
      </NativeSelect>
      <div className="flex items-center justify-end">
        {hasFilter ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={serviceCapabilityMapHref({ serviceId: selectedServiceId })}>Clear</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ServiceMasterList({
  entries,
  filter,
  selectedServiceId,
}: Readonly<{
  entries: readonly LogicalServiceInventoryEntry[];
  filter: ServiceInventoryFilter;
  selectedServiceId: string | null;
}>) {
  if (entries.length === 0) {
    return (
      <div className="grid min-h-48 place-items-center px-4 text-center">
        <div>
          <p className="text-sm text-foreground">No services match these filters.</p>
          <Button asChild variant="link" size="sm" className="mt-1">
            <Link href={serviceCapabilityMapHref({ serviceId: selectedServiceId })}>
              Clear filters
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ol className="divide-y divide-border" aria-label="Filtered service inventory">
      {entries.map((entry) => {
        const selected = entry.id === selectedServiceId;
        const operational = operationalState(entry);
        return (
          <li key={entry.id}>
            <Link
              href={serviceCapabilityMapHref({ ...filter, serviceId: entry.id })}
              className="group block border-l-2 border-transparent px-3 py-2.5 outline-none hover:bg-muted/50 focus-visible:border-primary focus-visible:bg-muted/50 aria-[current=page]:border-primary aria-[current=page]:bg-primary/5"
              aria-current={selected ? 'page' : undefined}
              data-service-inventory-row={entry.id}
            >
              <span className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-foreground">{entry.label}</span>
                <Badge
                  variant={entry.capabilityAudit.status === 'audited' ? 'default' : 'outline'}
                  className="rounded-md px-1.5 py-0 font-mono text-[9px] font-normal"
                >
                  {entry.capabilityAudit.status === 'audited' ? 'audited' : 'pending'}
                </Badge>
              </span>
              <span className="mt-1 flex min-w-0 items-center justify-between gap-2 font-mono text-[9px] text-muted-foreground">
                <span className="truncate">
                  {entry.family === 'unclassified' ? 'Unclassified' : FAMILY_LABELS[entry.family]}
                </span>
                <span className="shrink-0">{operational.label}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function PendingAuditDetail({ entry }: Readonly<{ entry: LogicalServiceInventoryEntry }>) {
  const operational = operationalState(entry);
  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            {entry.family === 'unclassified' ? 'Unclassified' : FAMILY_LABELS[entry.family]} /{' '}
            {entry.role}
          </p>
          <h2 className="text-base text-foreground">{entry.label}</h2>
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
            {entry.description}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={entry.routes.management}>
            Open management
            <ArrowSquareOut className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Operational evidence', value: operational.label },
          { label: 'Capability audit', value: 'Pending' },
          { label: 'Deployed nodes', value: entry.deployment.nodes.join(', ') || 'Not recorded' },
          { label: 'Version', value: entry.deployment.version ?? 'Not audited' },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-3">
              <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 break-words text-xs text-foreground">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="text-xs">Next evidence step</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 text-xs text-muted-foreground">
          <p>{entry.nextAction}</p>
          <p>
            No denominator or percentage is assigned until upstream availability, production
            integration, UI exposure, and workflow use are independently verified.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AuditedServiceDetail({ audit }: Readonly<{ audit: ServiceCapabilityAudit }>) {
  const summary = summarizeServiceCapabilityAudit(audit.serviceId);
  if (summary.status !== 'audited') return null;
  const coverage = capabilityCoveragePercent(summary);

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="grid gap-4 border-b border-border pb-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,32rem)] xl:items-end">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            Version {audit.upstreamVersion} / audited {audit.auditedAt}
          </p>
          <h2 className="text-base text-foreground">{audit.serviceLabel}</h2>
          <p className="max-w-5xl text-xs leading-relaxed text-muted-foreground">{audit.summary}</p>
        </div>
        <div className="space-y-2">
          <Progress
            value={coverage}
            max={100}
            aria-label={`${audit.serviceLabel}: ${summary.verifiedGates} of ${summary.totalGates} gates verified`}
          />
          <p className="font-mono text-[9px] text-muted-foreground xl:text-right">
            {summary.verifiedGates}/{summary.totalGates} verified / {summary.partialGates} partial /{' '}
            {summary.productionItems}/{summary.totalItems} in production workflows
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">Audited capabilities</h3>
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56 px-4">Capability</TableHead>
                {CAPABILITY_GATES.map((gate) => (
                  <TableHead key={gate} className="min-w-28">
                    {CAPABILITY_GATE_LABELS[gate]}
                  </TableHead>
                ))}
                <TableHead className="min-w-64">Concrete gap</TableHead>
                <TableHead className="min-w-36 pr-4">Operator route</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="px-4 py-3 align-top whitespace-normal">
                    <p className="text-xs text-foreground">{item.name}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {item.summary}
                    </p>
                  </TableCell>
                  {CAPABILITY_GATES.map((gate) => (
                    <TableCell key={gate} className="py-3 align-top whitespace-normal">
                      <GateBadge assessment={item.gates[gate]} />
                    </TableCell>
                  ))}
                  <TableCell className="py-3 align-top whitespace-normal">
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {item.gap || 'No gap in the audited four-gate path.'}
                    </p>
                  </TableCell>
                  <TableCell className="py-3 pr-4 align-top whitespace-normal">
                    <Link
                      href={item.uiHref}
                      className="inline-flex items-center gap-1 text-[10px] text-primary outline-none hover:underline focus-visible:underline"
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
    </div>
  );
}

function ExplorerWelcome({ inventory }: Readonly<{ inventory: ServiceInventoryReconciliation }>) {
  return (
    <div className="grid min-h-80 place-items-center p-6 text-center">
      <div className="max-w-xl space-y-3">
        <p className="text-sm text-foreground">Choose a service to inspect its evidence.</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The detail view separates upstream availability, production integration, UI exposure, and
          seeded workflow use. Pending audits stay unscored instead of being rounded down to zero.
        </p>
        <Badge variant={inventory.exactContract ? 'default' : 'destructive'} className="rounded-md">
          {inventory.exactContract
            ? '49-entry contract matched'
            : 'Inventory reconciliation failed'}
        </Badge>
      </div>
    </div>
  );
}

function UnknownServiceDetail({ serviceId }: Readonly<{ serviceId: string }>) {
  return (
    <div className="grid min-h-80 place-items-center p-6 text-center">
      <div className="max-w-xl space-y-3">
        <p className="text-sm text-foreground">Service not found</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {serviceId} is not part of the reconciled service inventory. Choose a service from the
          list, or clear the selection.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/operations/services/capability-map">Clear selection</Link>
        </Button>
      </div>
    </div>
  );
}

export function ServiceCapabilityExplorer({
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
  const visibleEntries = filterServiceInventory(inventory.entries, inventoryFilter);
  const selectedEntry = selectedServiceId
    ? (inventory.entries.find((entry) => entry.id === selectedServiceId) ?? null)
    : null;
  const selectedAudit = selectedServiceId
    ? (audits.find((audit) => audit.serviceId === selectedServiceId) ?? null)
    : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-background">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
          <div className="min-w-0 space-y-1">
            <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              Operations / Services
            </p>
            <h1 className="text-base text-foreground">Service capability map</h1>
            <p className="max-w-4xl text-xs text-muted-foreground">
              See exactly what each service provides and where work remains. Availability,
              integration, UI exposure, and production use are verified separately.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/operations/services">
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Services directory
            </Link>
          </Button>
        </div>
        <div className="grid gap-3 pb-3 xl:grid-cols-[minmax(28rem,40rem)_minmax(0,1fr)] xl:items-center">
          <OverviewRail inventory={inventory} />
          <FamilyNavigation
            filter={inventoryFilter}
            selectedServiceId={selectedServiceId}
            inventory={inventory}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)] lg:overflow-hidden">
        <aside
          className="flex min-h-72 flex-col border-b border-border bg-card/30 lg:h-full lg:min-h-0 lg:border-r lg:border-b-0"
          aria-label="Service capability inventory"
        >
          <div className="sticky top-0 z-10 border-b border-border bg-background p-3">
            <InventoryFilters filter={inventoryFilter} selectedServiceId={selectedServiceId} />
            <p className="mt-2 font-mono text-[9px] text-muted-foreground" aria-live="polite">
              {visibleEntries.length}/{inventory.totalCount} services shown
            </p>
          </div>
          <div className="min-h-0 flex-1 lg:overflow-y-auto">
            <ServiceMasterList
              entries={visibleEntries}
              filter={inventoryFilter}
              selectedServiceId={selectedServiceId}
            />
          </div>
        </aside>

        <main className="min-h-0 min-w-0 lg:overflow-y-auto" aria-label="Selected service detail">
          {selectedAudit ? (
            <AuditedServiceDetail audit={selectedAudit} />
          ) : selectedEntry ? (
            <PendingAuditDetail entry={selectedEntry} />
          ) : selectedServiceId ? (
            <UnknownServiceDetail serviceId={selectedServiceId} />
          ) : (
            <ExplorerWelcome inventory={inventory} />
          )}
        </main>
      </div>
    </div>
  );
}
