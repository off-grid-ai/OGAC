import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { answerCopilot } from '@/lib/copilot-gateway';
import { gatherCopilotContext } from '@/lib/copilot-gather';

export const dynamic = 'force-dynamic';

// Ops Copilot (M5): answer an operator question over the platform spine. Gathers REAL context from
// the existing reader libs (read-only), then asks the platform's own gateway to synthesise an answer
// WITH citations to the underlying records. Honest — if there are no records, it says "no data" and
// never calls the model.
interface CopilotBody {
  question?: string;
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as CopilotBody | null;
  const question = (body?.question ?? '').trim();
  if (question.length < 3) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const ctx = await gatherCopilotContext(question);
  const result = await answerCopilot(ctx);
  return NextResponse.json(result);
}
