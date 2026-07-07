import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { generateReport } from '@/lib/reports';
import { currentOrgId } from '@/lib/tenancy';

// Run a report now and return the rendered Markdown inline (for in-console preview), as opposed to
// /export which streams it as a signed download. Works for both built-in and custom templates.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const report = await generateReport(id, await currentOrgId());
  if (!report) return NextResponse.json({ error: 'unknown report' }, { status: 404 });
  return NextResponse.json({ filename: report.filename, body: report.body });
}
