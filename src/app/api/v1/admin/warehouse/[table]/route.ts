import { NextResponse } from 'next/server';
import { clickhouseWarehouse } from '@/lib/adapters/warehouse';
import { requireAdmin } from '@/lib/authz';
import { clampLimit, isSafeIdentifier } from '@/lib/warehouse-model';

export const dynamic = 'force-dynamic';

// Table detail (the list→detail backend): stats (rows/bytes/engine/freshness) + a sample of rows.
// `?limit=` clamps to the model's bounds. Admin-gated; thin — the adapter does the I/O.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { table } = await params;
  const name = decodeURIComponent(table);
  if (!isSafeIdentifier(name)) {
    return NextResponse.json({ error: 'invalid table identifier' }, { status: 400 });
  }

  const url = new URL(req.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? undefined));

  const [stats, sample] = await Promise.all([
    clickhouseWarehouse.tableStats(name),
    clickhouseWarehouse.sample(name, limit),
  ]);

  if (!stats && !sample) {
    // Both null → the warehouse is unreachable or the table doesn't exist.
    return NextResponse.json({ error: 'table not found or warehouse unreachable' }, { status: 404 });
  }

  return NextResponse.json({
    table: name,
    stats,
    columns: sample?.columns ?? [],
    rows: sample?.rows ?? [],
    count: sample?.count ?? 0,
  });
}
