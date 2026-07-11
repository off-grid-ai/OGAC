import { Database, Table as TableIcon } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { DataPlaneHealthBand } from '@/components/data/DataPlaneHealthBand';
import { WarehouseSearch } from '@/components/data/WarehouseSearch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { clickhouseWarehouse } from '@/lib/adapters/warehouse';
import {
  filterTables,
  formatBytes,
  formatRows,
  freshnessTone,
  groupTablesByDatabase,
  bareTableName,
  tableHref,
  type WarehouseTable,
} from '@/lib/dataplane-ui';
import { requireModuleForUser } from '@/lib/module-access';
import { currentWarehouseDatabase } from '@/lib/warehouse-scope';

export const dynamic = 'force-dynamic';

// Warehouse — the DATA CATALOG (our "Data Catalog / Glue Catalog" parity surface). A full-width,
// grouped-by-database grid of every warehouse table with its row count, size, and freshness. Each
// card is a way IN → the table detail page (list→detail). Search is URL-driven (`?q=`). Consumes the
// live warehouse adapter directly (server component) — no mocked data; an unreachable warehouse
// degrades to an honest empty state, never fabricated rows.
export default async function WarehousePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireModuleForUser('data');
  const { q = '' } = await searchParams;

  // TENANCY: scope the catalog to the viewer's own warehouse database (their tenant slug) so a
  // tenant sees only its tables — never another tenant's (or global desktop-app junk).
  const scope = await currentWarehouseDatabase();
  const [healthy, tablesRaw] = await Promise.all([
    clickhouseWarehouse.health(),
    clickhouseWarehouse.listTables(scope),
  ]);
  const tables = tablesRaw as WarehouseTable[];
  const filtered = filterTables(tables, q);
  const groups = groupTablesByDatabase(filtered);

  const totalRows = tables.reduce((n, t) => n + (t.rows || 0), 0);
  const totalBytes = tables.reduce((n, t) => n + (t.bytes || 0), 0);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Database className="size-4 text-primary" />
            Warehouse
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Every table in your analytics warehouse — its size, row count, and how fresh it is,
            grouped by database. Click a table to inspect its columns, sample its rows, and run a
            data-quality check.
          </p>
        </div>
        <WarehouseSearch initial={q} />
      </div>

      {/* Stat band. */}
      <StatRail at="sm">
        <Stat label="Tables" value={String(tables.length)} />
        <Stat label="Databases" value={String(new Set(tables.map((t) => t.database ?? 'default')).size)} />
        <Stat label="Total rows" value={formatRows(totalRows)} />
        <Stat label="On disk" value={formatBytes(totalBytes)} />
      </StatRail>

      {!healthy && tables.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            The warehouse isn&apos;t reachable right now, so its tables can&apos;t be listed. Check
            the engine-health band below — once the warehouse is back online, your tables appear here
            automatically.
            <div className="mt-4">
              <DataPlaneHealthBand />
            </div>
          </CardContent>
        </Card>
      ) : tables.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            The warehouse is online but holds no tables yet. Run a pipeline to move source data in —
            catalogued tables will show up here.
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tables match &quot;{q}&quot;.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.database} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.database}
                </h3>
                <span className="text-[11px] text-muted-foreground/70">
                  {group.tables.length} table{group.tables.length === 1 ? '' : 's'} ·{' '}
                  {formatRows(group.totalRows)} rows · {formatBytes(group.totalBytes)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {group.tables.map((t) => (
                  <Link key={t.name} href={tableHref(t)} className="group">
                    <Card className="h-full shadow-sm transition-colors group-hover:border-primary/40">
                      <CardHeader className="space-y-0 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="flex items-center gap-1.5 text-sm">
                            <TableIcon className="size-3.5 text-muted-foreground" />
                            {bareTableName(t.name)}
                          </CardTitle>
                          <Badge className={freshnessTone(t.freshness.label, t.freshness.ageMs)}>
                            {t.freshness.label}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{formatRows(t.rows)} rows</span>
                        <span>{formatBytes(t.bytes)}</span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Card className="shadow-sm">
      <CardContent className="py-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
