import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteVirtualKeys, updateVirtualKey } from '@/lib/litellm';
import { buildKeyUpdateBody, type KeyInput, validateKeyInput } from '@/lib/litellm-key-policy';

export const dynamic = 'force-dynamic';

// PATCH updates a virtual key's budget/limits; DELETE revokes it. `key` is the key token (URL-encoded).
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const body = (await req.json().catch(() => ({}))) as KeyInput;
  const v = validateKeyInput(body);
  if (!v.ok) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  try {
    await updateVirtualKey(buildKeyUpdateBody(decodeURIComponent(key), body));
    return NextResponse.json({ updated: true, key });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  try {
    await deleteVirtualKeys([decodeURIComponent(key)]);
    return NextResponse.json({ deleted: true, key });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
