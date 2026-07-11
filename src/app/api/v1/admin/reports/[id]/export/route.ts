import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { markdownToPdf } from '@/lib/pdf';
import { buildManifest } from '@/lib/provenance';
import { renderReportWithProvenance } from '@/lib/reports/build';
import { incompleteReport, pdfResponse, provenanceHeaders } from '@/lib/reports/http';
import { generateReport } from '@/lib/reports';
import { validateReportDoc } from '@/lib/reports/validate';
import { currentOrgId } from '@/lib/tenancy';

// react-pdf renders on Node (yoga/wasm + a disk read of public/logo.png) — never the edge runtime.
export const runtime = 'nodejs';

// Generate one report live and stream it as a branded, regulator-grade PDF (the DEFAULT). Families the
// structured builder owns (regulator packs, compliance, trust, inventory, audit, eval) are rendered
// from a validated ReportDoc — an incomplete document is REFUSED with 422 rather than shipped. Custom
// operator-authored templates (which have no ReportDoc mapping) fall back to the markdown→PDF path.
// Every export carries a detached, signed provenance manifest in X-Provenance-* headers; ?manifest=1
// returns the manifest JSON; ?format=md returns raw markdown for the fallback families.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const url = new URL(req.url);
  const now = new Date().toISOString();

  // Structured PDF path (default) for families the builder owns.
  const built = await renderReportWithProvenance(id, orgId, now);
  if (built) {
    const refuse = incompleteReport(validateReportDoc(built.doc));
    if (refuse) return refuse;
    if (url.searchParams.get('manifest') === '1') return NextResponse.json(built.manifest);
    return pdfResponse(built.bytes, built.filename, built.manifest);
  }

  // Fallback: operator-authored custom templates (markdown, optionally →PDF).
  const report = await generateReport(id, orgId);
  if (!report) return NextResponse.json({ error: 'unknown report' }, { status: 404 });
  const base = report.filename.replace(/\.md$/, '');
  const wantMd = url.searchParams.get('format') === 'md';
  const bytes = wantMd
    ? new TextEncoder().encode(report.body)
    : await markdownToPdf(base, report.body);
  const filename = wantMd ? `${base}.md` : `${base}.pdf`;
  const contentType = wantMd ? 'text/markdown; charset=utf-8' : 'application/pdf';
  const manifest = buildManifest(bytes, filename, contentType.split(';')[0], now);
  if (url.searchParams.get('manifest') === '1') return NextResponse.json(manifest);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      ...provenanceHeaders(manifest),
    },
  });
}
