import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getConversation, getProjectBinding } from '@/lib/chat';
import { captureChatThumb } from '@/lib/feedback-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST /api/v1/chat/conversations/[id]/feedback — capture a 👍/👎 on an assistant answer as labeled
// golden/eval data for the conversation's bound pipeline (M1 close-the-loop, LEARN half).
// Body: { rating:'up'|'down', query:string, answer:string, correction?:string }.
//
//  • 👍 → the answer becomes the expected (a positive golden).
//  • 👎 + correction → the correction becomes the expected.
//  • 👎 with no correction → honestly NOT captured (we have the query but no known-good answer).
//
// The pipeline is resolved from the conversation's project binding; an ad-hoc chat (no project /
// no pipeline) still records the thumb as an org-wide library case (pipelineId null). Thin handler:
// session gate + resolve pipeline + delegate to the pure-backed feedback store.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const convo = await getConversation(userId, await currentOrgId(), id);
  if (!convo) return NextResponse.json({ error: 'conversation not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    rating?: string;
    query?: string;
    answer?: string;
    correction?: string;
  };
  if (body.rating !== 'up' && body.rating !== 'down') {
    return NextResponse.json({ error: 'rating must be up|down' }, { status: 400 });
  }

  const binding = await getProjectBinding(convo.projectId ?? null);
  const pipelineId = binding?.pipelineId ?? null;

  const result = await captureChatThumb(
    { rating: body.rating, query: body.query, answer: body.answer, correction: body.correction },
    pipelineId,
  );
  return NextResponse.json(result);
}
