import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { answerCopilot } from '@/lib/copilot-gateway';
import { gatherCopilotContext } from '@/lib/copilot-gather';

export const dynamic = 'force-dynamic';

// Ops Copilot (M5): answer an operator question over the platform spine. Gathers REAL context from
// the existing reader libs (read-only), then asks the platform's own gateway to synthesise an answer
// WITH citations to the underlying records. Honest — if there are no records, it says "no data" and
// never calls the model.
//
// TWO METHODS, ONE PATH, ONE CODE PATH.
//
// LIVE FINDING (2026-08-05): the read-only `viewer` role — the ONLY role the public demo links hand
// out, and the whole audience for the floating guide — got a flat 403 here:
//   {"error":"forbidden","reason":"read-only demo: this account can view everything but cannot make
//    changes"}
// Asking a question changes nothing, but the request was a POST and the edge rule blocks a viewer's
// mutating methods (src/lib/viewer-policy.ts). So the answer half of the copilot was unreachable for
// exactly the people it was built for.
//
// The fix is to let a read BE a read: GET with the question in the query string. That is preferred
// over adding this path to `READ_ONLY_QUERY_PATHS` (the exemption list for POSTs that are really
// reads) because the exemption list should stay reserved for queries whose input genuinely cannot fit
// in a URL — every entry on it is a hole a future sub-route could grow through, and this question is
// one short sentence. POST stays for any caller already using it; both hand off to `answer()`.

interface CopilotBody {
  question?: string;
}

const MIN_QUESTION = 3;

/** The whole handler logic, shared by GET and POST so neither drifts from the other. */
async function answer(question: string): Promise<NextResponse> {
  if (question.length < MIN_QUESTION) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }
  const ctx = await gatherCopilotContext(question);
  return NextResponse.json(await answerCopilot(ctx));
}

export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const question = (new URL(req.url).searchParams.get('q') ?? '').trim();
  return answer(question);
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as CopilotBody | null;
  return answer((body?.question ?? '').trim());
}
