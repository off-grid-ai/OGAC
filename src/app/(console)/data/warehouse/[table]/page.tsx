import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TableQualityCheck } from '@/components/data/TableQualityCheck';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { clickhouseWarehouse } from '@/lib/adapters/warehouse';
import {
  bareTableName,
  deriveResultColumns,
  formatBytes,
  formatCell,
  formatRows,
  freshnessTone,
} from '@/lib/dataplane-ui';
import { requireModuleForUser } from '@/lib/module-access';
import { isSafeIdentifier } from '@/lib/warehouse-model';
import { currentWarehouseDatabase } from '@/lib/warehouse-scope';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Warehouse table DETAIL (list→detail) — the deep, deep-linkable view behind one table: its stats
// band (rows/bytes/freshness/engine-family), its column list, a live sample of rows, and a
// "run data-quality check" action that validates the sample. Consumes the live warehouse adapter
// directly (server component). Deep-linkable: /data/warehouse/[table].
export default async function WarehouseTableDetailPage({
  params,
}: Readonly<{
  params: Promise<{ table: string }>;
}>) {
  await requireModuleForUser('data');
  const { table: raw } = await params;
  const name = decodeURIComponent(raw);
  if (!isSafeIdentifier(name)) notFound();

  // TENANCY: scope the detail read to the viewer's warehouse database. A bare name resolves within
  // it; a cross-tenant `otherdb.table` is denied (both stats + sample return null → notFound).
  const scope = await currentWarehouseDatabase();
  const [stats, sample] = await Promise.all([
    clickhouseWarehouse.tableStats(name, scope),
    clickhouseWarehouse.sample(name, 50, scope),
  ]);

  if (!stats && !sample) notFound();

  const columns = sample?.columns ?? [];
  const rows = sample?.rows ?? [];
  const columnNames = deriveResultColumns(columns, rows);
  const freshness = stats?.freshness;
  const previewSql = `SELECT * FROM ${name} LIMIT 100`;

  return (
    <PageFrame>
      {
        <div className="w-full space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link
                href="/data/warehouse"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" /> Warehouse
              </Link>
              <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-foreground">
                {bareTableName(name)}
                {freshness ? (
                  <Badge className={freshnessTone(freshness.label, freshness.ageMs)}>
                    {freshness.label}
                  </Badge>
                ) : null}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">{name}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/data/query?sql=${encodeURIComponent(previewSql)}`}>
                Query this table
              </Link>
            </Button>
          </div>

          {/* Stats band. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows" value={formatRows(stats?.rows ?? 0)} />
            <Stat label="On disk" value={formatBytes(stats?.bytes ?? 0)} />
            <Stat label="Columns" value={String(columnNames.length)} />
            <Stat label="Last updated" value={freshness?.label ?? 'unknown'} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Columns. */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Columns</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {columns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No column metadata available.</p>
                ) : (
                  columns.map((c) => (
                    <div
                      key={c.name}
                      className="flex items-center justify-between gap-2 border-b border-border/50 pb-1 text-xs last:border-0"
                    >
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="text-muted-foreground">{c.type}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Quality check (action). */}
            <div className="xl:col-span-2">
              <TableQualityCheck table={name} columns={columnNames} sampleRows={rows} />
            </div>
          </div>

          {/* Sample rows. */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Sample rows</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                A live sample of up to 50 rows straight from the warehouse.
              </p>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  This table returned no rows.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {columnNames.map((c) => (
                          <TableHead key={c} className="whitespace-nowrap">
                            {c}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, i) => (
                        <TableRow key={i}>
                          {columnNames.map((c) => (
                            <TableCell key={c} className="whitespace-nowrap font-mono text-xs">
                              {formatCell(row[c])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      }
    </PageFrame>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Card className="shadow-sm">
      <CardContent className="py-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
        <div className="mt-1 truncate text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
