import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { victoriaLogs } from '@/lib/adapters/victorialogs';
import { parseLogsRequest } from '@/lib/logs-request';
import { clampLimit } from '@/lib/victorialogs-query';

export const dynamic = 'force-dynamic';

// GET (admin) — centralized fleet log search. Composes LogsQL from `q` + field filters + `range`,
// runs it against VictoriaLogs, returns the shaped rows. Thin: all logic is in the pure request
// parser + the adapter.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const params = new URL(req.url).searchParams;
  const { query, range, text, filters } = parseLogsRequest(params);
  const limit = clampLimit(params.get('limit'));
  const result = await victoriaLogs.search(query, { start: range.start, end: 'now', limit });
  return NextResponse.json({
    ...result,
    range: range.key,
    text,
    filters,
  });
}
