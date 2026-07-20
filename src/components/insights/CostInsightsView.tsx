import { Coins, CurrencyDollar, FolderSimple, Users } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  PipelineFacetSelect,
  type PipelineFacetOption,
} from '@/components/pipelines/PipelineFacetSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Accounting, AttributedSpend, ModelSpend, RangePreset } from '@/lib/accounting';
import {
  type InsightsCostDestinationId,
  type InsightsUsageCostSearchParams,
  insightsUsageCostRouteWithSearchParams,
} from '@/lib/insights-usage-cost-routes';
import { modelLabel } from '@/lib/model-catalog';

interface CostInsightsViewProps {
  accounting: Accounting;
  destination: InsightsCostDestinationId;
  facetName: string | null;
  pipelines: PipelineFacetOption[];
  range: RangePreset;
  route: string;
  searchParams: InsightsUsageCostSearchParams;
}

const RANGES: readonly { key: RangePreset; label: string }[] = [
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
];

const usd = (value: number) => `$${value.toFixed(2)}`;
const num = (value: number) => value.toLocaleString();

function FilterBar({
  facetName,
  pipelines,
  range,
  route,
  searchParams,
}: Readonly<Omit<CostInsightsViewProps, 'accounting' | 'destination'>>) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 pb-4 xl:flex-row xl:items-center xl:justify-between">
      <p className="text-xs text-muted-foreground">
        {facetName ? (
          <>
            Showing pipeline <span className="text-foreground">{facetName}</span>.
          </>
        ) : (
          'Showing all pipeline usage.'
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <PipelineFacetSelect pipelines={pipelines} />
        <div className="flex flex-wrap items-center gap-2" aria-label="Usage window">
          {RANGES.map((option) => (
            <Link
              key={option.key}
              href={insightsUsageCostRouteWithSearchParams(route, {
                ...searchParams,
                range: option.key,
              })}
              aria-current={range === option.key ? 'page' : undefined}
              className={`rounded-md border px-2 py-1 ${
                range === option.key
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: Readonly<{
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
}>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="text-2xl font-semibold text-foreground">{value}</CardContent>
    </Card>
  );
}

function CostOverview({ accounting }: Readonly<{ accounting: Accounting }>) {
  return (
    <StatRail>
      <Stat label="Total spend" value={usd(accounting.totals.costUsd)} icon={CurrencyDollar} />
      <Stat label="Total tokens" value={num(accounting.totals.tokens)} icon={Coins} />
      <Stat label="Users" value={num(accounting.byActor.length)} icon={Users} />
      <Stat label="Projects" value={num(accounting.byProject.length)} icon={FolderSimple} />
    </StatRail>
  );
}

function AttributionTable({
  entityLabel,
  rows,
}: Readonly<{ entityLabel: 'User' | 'Project'; rows: AttributedSpend[] }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Spend and tokens by {entityLabel.toLowerCase()}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{entityLabel}</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No usage in this window.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="max-w-[24rem] truncate font-medium text-foreground">
                      {row.label}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(row.requests)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(row.tokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {usd(row.costUsd)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ModelsTable({ rows }: Readonly<{ rows: ModelSpend[] }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Spend by model</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">Local models report $0 spend.</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Prompt</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No usage in this window.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell className="font-medium text-foreground">
                      {modelLabel(row.model)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(row.requests)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(row.promptTokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(row.completionTokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(row.tokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {usd(row.costUsd)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function CostInsightsView({
  accounting,
  destination,
  facetName,
  pipelines,
  range,
  route,
  searchParams,
}: Readonly<CostInsightsViewProps>) {
  let content;
  switch (destination) {
    case 'overview':
      content = <CostOverview accounting={accounting} />;
      break;
    case 'users':
      content = <AttributionTable entityLabel="User" rows={accounting.byActor} />;
      break;
    case 'projects':
      content = <AttributionTable entityLabel="Project" rows={accounting.byProject} />;
      break;
    case 'models':
      content = <ModelsTable rows={accounting.byModel} />;
      break;
  }

  return (
    <div className="w-full space-y-6">
      <FilterBar
        facetName={facetName}
        pipelines={pipelines}
        range={range}
        route={route}
        searchParams={searchParams}
      />
      {content}
    </div>
  );
}
