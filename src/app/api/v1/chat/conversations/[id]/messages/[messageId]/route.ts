import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { editUserMessage } from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Edit a prior user message and re-run from that point (Phase 4.6). Truncates every message after
// the target, then the client re-runs the assistant via the existing stream path. Thin handler:
// same session gate as the sibling chat routes; ownership + validation live in editUserMessage.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id, messageId } = await params;
  const { content } = await req.json().catch(() => ({}));
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }
  const messages = await editUserMessage(userId, await currentOrgId(), id, messageId, content);
  if (!messages) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, messages });
}
