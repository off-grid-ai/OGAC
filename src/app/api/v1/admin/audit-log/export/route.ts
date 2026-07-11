import { NextResponse } from 'next/server';
import { readAuditForExport } from '@/lib/audit-log-reader';
import {
  auditRowsToCsv,
  auditRowsToJson,
  parseAuditFilters,
} from '@/lib/audit-log-view';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Compliance export of the CURRENT filtered audit-log result set. Thin I/O shell: authz → parse the
// SAME filter contract the page uses → read the filtered set → serialize (pure). Admin-only.
//
//   GET /api/v1/admin/audit-log/export?format=csv&actor=...&action=...&project=...&outcome=...&from=...&to=...&q=...
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') ?? 'csv').toLowerCase();
  const filters = parseAuditFilters((k) => url.searchParams.get(k));

  const { rows, configured, error } = await readAuditForExport(filters, await currentOrgId());
  if (!configured) {
    return NextResponse.json({ error: 'audit search not configured (OFFGRID_OPENSEARCH_URL)' }, {
      status: 503,
    });
  }
  if (error) {
    return NextResponse.json({ error }, { status: 502 });
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (format === 'json') {
    return new NextResponse(auditRowsToJson(rows), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="audit-log-${stamp}.json"`,
      },
    });
  }
  // Default: CSV.
  return new NextResponse(auditRowsToCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-log-${stamp}.csv"`,
    },
  });
}
