import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { renderReportWithProvenance } from '@/lib/reports/build';
import { incompleteReport, pdfResponse } from '@/lib/reports/http';
import { validateReportDoc } from '@/lib/reports/validate';
import { currentOrgId } from '@/lib/tenancy';

// react-pdf renders on Node (yoga/wasm + disk read of public/logo.png).
export const runtime = 'nodejs';

// One-click compliance evidence pack the DPO hands to a regulator — a branded, regulator-grade PDF
// built from a validated ReportDoc (an incomplete document is refused with 422, never shipped).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const built = await renderReportWithProvenance(
    'compliance',
    await currentOrgId(),
    new Date().toISOString(),
  );
  if (!built) return NextResponse.json({ error: 'unknown report' }, { status: 404 });
  const refuse = incompleteReport(validateReportDoc(built.doc));
  if (refuse) return refuse;
  return pdfResponse(built.bytes, built.filename, built.manifest);
}
