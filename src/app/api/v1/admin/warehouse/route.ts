import { NextResponse } from 'next/server';
import { clickhouseWarehouse } from '@/lib/adapters/warehouse';
import { requireAdmin } from '@/lib/authz';
import { currentWarehouseDatabase } from '@/lib/warehouse-scope';

export const dynamic = 'force-dynamic';

// Warehouse overview: health + the table list with row count, bytes, and freshness. Thin — all the
// work is in the adapter (I/O) + warehouse-model (pure). Admin-gated like the connectors routes.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // TENANCY: scope to the caller's own warehouse database, exactly as the /data/warehouse PAGE already
  // did. This route did not, so it handed the insurer's read-only demo account the bank tenant's table
  // names and row counts — the page was safe and the API beside it was not, which is why a UI-only
  // review missed it. The helper fails closed (an org whose slug cannot be resolved sees nothing).
  const scope = await currentWarehouseDatabase();
  const [healthy, tables] = await Promise.all([
    clickhouseWarehouse.health(),
    clickhouseWarehouse.listTables(scope),
  ]);

  return NextResponse.json({
    healthy,
    engine: clickhouseWarehouse.meta.vendor,
    tables: tables.map((t) => ({
      name: t.name,
      database: t.database,
      rows: t.rows,
      bytes: t.bytes,
      freshness: t.freshness,
    })),
  });
}
