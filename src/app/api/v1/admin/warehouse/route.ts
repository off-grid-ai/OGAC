import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { clickhouseWarehouse } from '@/lib/adapters/warehouse';

export const dynamic = 'force-dynamic';

// Warehouse overview: health + the table list with row count, bytes, and freshness. Thin — all the
// work is in the adapter (I/O) + warehouse-model (pure). Admin-gated like the connectors routes.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const [healthy, tables] = await Promise.all([
    clickhouseWarehouse.health(),
    clickhouseWarehouse.listTables(),
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
