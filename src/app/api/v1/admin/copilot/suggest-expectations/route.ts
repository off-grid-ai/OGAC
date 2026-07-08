import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import {
  generateExpectations,
  type TableSchemaDescriptor,
  type ColumnDescriptor,
} from '@/lib/suggest-expectations';

export const dynamic = 'force-dynamic';

// Auto-generate data-quality expectations from a table schema (M5). Given a schema descriptor
// (columns + types + optional profiled stats), propose Great-Expectations-style checks (not-null,
// ranges, uniqueness, allowed-values, format). Pure generator — a proposal the operator confirms.
interface Body {
  table?: string;
  columns?: unknown;
  rowCount?: number;
}

function toColumns(raw: unknown): ColumnDescriptor[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      name: String(c.name ?? ''),
      type: typeof c.type === 'string' ? c.type : undefined,
      nullCount: typeof c.nullCount === 'number' ? c.nullCount : undefined,
      distinctCount: typeof c.distinctCount === 'number' ? c.distinctCount : undefined,
      rowCount: typeof c.rowCount === 'number' ? c.rowCount : undefined,
      min: typeof c.min === 'number' ? c.min : undefined,
      max: typeof c.max === 'number' ? c.max : undefined,
      sampleValues: Array.isArray(c.sampleValues)
        ? (c.sampleValues.filter(
            (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
          ) as (string | number | boolean)[])
        : undefined,
    }))
    .filter((c) => c.name.length > 0);
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as Body | null;
  const table = (body?.table ?? '').trim() || 'dataset';
  const columns = toColumns(body?.columns);
  if (columns.length === 0) {
    return NextResponse.json({ error: 'at least one column is required' }, { status: 400 });
  }

  const schema: TableSchemaDescriptor = {
    table,
    columns,
    rowCount: typeof body?.rowCount === 'number' ? body.rowCount : undefined,
  };
  return NextResponse.json(generateExpectations(schema));
}
