import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  deleteRecognizer,
  setRecognizerEnabled,
  updateRecognizer,
  validateRecognizer,
} from '@/lib/presidio-recognizers';
import { degradeOn503 } from '@/lib/route-degrade';
import { currentOrgId } from '@/lib/tenancy';

// A single custom recognizer. PATCH either flips the enabled toggle ({ enabled }) or edits the
// whole recognizer (a full draft, re-validated); DELETE removes it. Admin-gated, thin, org-scoped.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  // Toggle-only PATCH: just an `enabled` boolean, no other recognizer fields.
  if (body && typeof body.enabled === 'boolean' && body.kind === undefined) {
    return degradeOn503(async () => {
      const updated = await setRecognizerEnabled(id, body.enabled as boolean, orgId);
      if (!updated) return NextResponse.json({ error: 'recognizer not found' }, { status: 404 });
      return NextResponse.json(updated);
    });
  }

  // Full edit: re-validate the whole draft.
  const parsed = validateRecognizer(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return degradeOn503(async () => {
    const updated = await updateRecognizer(id, parsed.value, orgId);
    if (!updated) return NextResponse.json({ error: 'recognizer not found' }, { status: 404 });
    return NextResponse.json(updated);
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  return degradeOn503(async () => {
    const deleted = await deleteRecognizer(id, await currentOrgId());
    if (!deleted) return NextResponse.json({ error: 'recognizer not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  });
}
