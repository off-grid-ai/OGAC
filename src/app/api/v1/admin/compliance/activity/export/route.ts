import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  activityContentType,
  activityFilename,
  buildComplianceActivity,
  parseActivityFormat,
  serializeActivity,
} from '@/lib/compliance-activity';
import { readComplianceActivity } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Data Processing Activity Report (DPIA) export — pulls the REAL canonical audit ledger + provenance
// coverage over a time range and serializes it to CSV / JSON / Markdown. Thin: auth → parse → read →
// pure build → pure serialize → respond.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const org = await currentOrgId();
  const q = {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    org,
  };
  const fmt = parseActivityFormat(url.searchParams.get('format'));

  const { rows, coverage } = await readComplianceActivity(q);
  const report = buildComplianceActivity(rows, coverage, q);
  const body = serializeActivity(report, fmt);

  return new Response(body, {
    headers: {
      'content-type': activityContentType(fmt),
      'content-disposition': `attachment; filename="${activityFilename(report, fmt)}"`,
    },
  });
}
