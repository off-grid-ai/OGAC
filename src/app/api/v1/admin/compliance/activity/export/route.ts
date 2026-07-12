import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  activityContentType,
  activityFilename,
  buildComplianceActivity,
  parseActivityFormat,
  serializeActivity,
} from '@/lib/compliance-activity';
import { buildManifest } from '@/lib/provenance';
import { buildActivityDoc, type DocMetaInput } from '@/lib/reports/build-doc';
import { tenantNameFor } from '@/lib/reports/build';
import { incompleteReport, pdfResponse } from '@/lib/reports/http';
import { renderReportDoc } from '@/lib/reports/render';
import { validateReportDoc } from '@/lib/reports/validate';
import { readComplianceActivity } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// react-pdf renders on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Data Processing Activity Report (DPIA) export. PDF is the DEFAULT document format — a branded,
// regulator-grade artifact built from a validated ReportDoc. CSV / JSON remain as raw DATA formats
// (?format=csv|json) for downstream ingestion — they are datasets, not documents, and stay untouched.
// Thin: auth → parse → read real audit ledger → pure build → render/serialize → respond.
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
  const rawFormat = url.searchParams.get('format');
  const now = new Date().toISOString();

  const { rows, coverage } = await readComplianceActivity(q);
  const report = buildComplianceActivity(rows, coverage, q);

  // Data formats: keep the CSV/JSON dataset serializers exactly as-is.
  if (rawFormat === 'csv' || rawFormat === 'json') {
    const fmt = parseActivityFormat(rawFormat);
    const body = serializeActivity(report, fmt);
    return new Response(body, {
      headers: {
        'content-type': activityContentType(fmt),
        'content-disposition': `attachment; filename="${activityFilename(report, fmt)}"`,
      },
    });
  }

  // Document format (default): branded PDF from a validated ReportDoc.
  const tenantName = await tenantNameFor(org);
  const meta: DocMetaInput = {
    title: 'Data Processing Activity Report',
    subtitle: 'DPIA — audit ledger + provenance coverage',
    tenantName,
    framework: 'DPDP Act 2023',
    recipient: { role: 'dpo', name: `${tenantName} Data Protection Officer` },
    classification: 'Confidential',
    now,
    filenameBase: 'offgrid-processing-activity',
  };
  const doc = buildActivityDoc(report, meta);
  const refuse = incompleteReport(validateReportDoc(doc));
  if (refuse) return refuse;
  const bytes = await renderReportDoc(doc);
  const filename = `${doc.filenameBase}.pdf`;
  const manifest = buildManifest(bytes, filename, 'application/pdf', now);
  return pdfResponse(bytes, filename, manifest);
}
