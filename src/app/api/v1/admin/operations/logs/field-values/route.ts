import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { victoriaLogs } from '@/lib/adapters/victorialogs';
import { FILTER_FIELDS, type FilterField } from '@/lib/logs-request';
import { parseRange } from '@/lib/victorialogs-query';

export const dynamic = 'force-dynamic';

// GET (admin) — distinct values of a log field (for the filter dropdowns, e.g. service / level).
// `field` is validated against the known filterable set so the endpoint can't be pointed at
// arbitrary fields; the count is scoped to the active `range`.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const params = new URL(req.url).searchParams;
  const field = (params.get('field') ?? '') as FilterField;
  if (!FILTER_FIELDS.includes(field)) {
    return NextResponse.json(
      { error: `unknown field; expected one of ${FILTER_FIELDS.join(', ')}` },
      { status: 400 },
    );
  }
  const range = parseRange(params.get('range'));
  // Field values across everything in the window (`*`), not the current filter, so a dropdown always
  // offers the full option set.
  const result = await victoriaLogs.fieldValues(field, '*', { start: range.start, end: 'now' });
  return NextResponse.json(result);
}
