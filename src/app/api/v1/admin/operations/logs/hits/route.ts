import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { victoriaLogs } from '@/lib/adapters/victorialogs';
import { parseLogsRequest } from '@/lib/logs-request';

export const dynamic = 'force-dynamic';

// GET (admin) — time-bucketed hit counts for the SAME composed query, for the results histogram.
// The bucket width (`step`) comes from the resolved range so the bar count stays sensible.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { query, range } = parseLogsRequest(new URL(req.url).searchParams);
  const result = await victoriaLogs.hits(query, {
    start: range.start,
    end: 'now',
    step: range.step,
  });
  return NextResponse.json({ ...result, range: range.key, step: range.step });
}
