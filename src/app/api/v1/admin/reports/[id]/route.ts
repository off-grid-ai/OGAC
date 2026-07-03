import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteReportTemplate, getReportTemplate, updateReportTemplate } from '@/lib/reports';
import { validateTemplate } from '@/lib/reports-template';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const t = await getReportTemplate(id);
  if (!t) return NextResponse.json({ error: 'unknown template' }, { status: 404 });
  return NextResponse.json(t);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateTemplate(body ?? {}, true);
  if (!v.ok || !v.value) {
    return NextResponse.json({ error: 'invalid patch', details: v.errors }, { status: 400 });
  }
  // Only forward fields the caller actually supplied so partial edits don't clobber other fields.
  const patch: Record<string, unknown> = {};
  const b = body ?? {};
  if (b.name !== undefined) patch.name = v.value.name;
  if (b.description !== undefined) patch.description = v.value.description;
  if (b.source !== undefined) patch.source = v.value.source;
  if (b.sections !== undefined) patch.sections = v.value.sections;
  if (b.frameworks !== undefined) patch.frameworks = v.value.frameworks;
  if (b.schedule !== undefined) patch.schedule = v.value.schedule;
  const updated = await updateReportTemplate(id, patch);
  if (!updated) return NextResponse.json({ error: 'unknown template' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const ok = await deleteReportTemplate(id);
  if (!ok) {
    return NextResponse.json({ error: 'not deletable (unknown or built-in)' }, { status: 400 });
  }
  return NextResponse.json({ deleted: true });
}
