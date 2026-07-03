import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createReportTemplate, listReportTemplates } from '@/lib/reports';
import { validateTemplate } from '@/lib/reports-template';

// The report-template catalog — built-in reports (seeded) + operator-authored custom templates.
// Each is generated live and exported via /reports/{id}/export.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listReportTemplates() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateTemplate(body ?? {});
  if (!v.ok || !v.value) {
    return NextResponse.json({ error: 'invalid template', details: v.errors }, { status: 400 });
  }
  const id = await createReportTemplate(v.value);
  return NextResponse.json({ id }, { status: 201 });
}
