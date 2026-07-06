import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { eraseSubjectScope } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// DSAR / right-to-erasure. Reports the sensitive-dataset scope a subject spans; real
// propagation crosses lake + KB + vector index + memory + audit (Phase A12a).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const subject = body?.subject as string | undefined;
  if (!subject) {
    return NextResponse.json({ error: 'subject (email/id) required' }, { status: 400 });
  }
  const scope = await eraseSubjectScope();
  auditFromSession(gate, await currentOrgId(), {
    action: 'data.erasure',
    resource: `subject:${subject}`,
    outcome: 'ok',
  });
  return NextResponse.json({ subject, status: 'queued', propagatesTo: scope });
}
