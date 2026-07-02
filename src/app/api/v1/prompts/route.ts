import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import { createPrompt, listPrompts } from '@/lib/prompts';

export const dynamic = 'force-dynamic';

// Prompt library — a personal/org library of reusable prompt texts. Listing is scoped to the caller
// (their private prompts + every org-visible prompt); creation is available to any authenticated
// user. Distinct from skills, which are reusable assistants.
export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const owner = gate.user.email ?? '';
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const tag = req.nextUrl.searchParams.get('tag') ?? undefined;
  return NextResponse.json({ prompts: await listPrompts(owner, { q, tag }) });
}

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const owner = gate.user.email ?? '';
  const body = await req.json().catch(() => ({}));
  const id = await createPrompt(owner, {
    title: typeof body.title === 'string' ? body.title : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    tags: body.tags,
    visibility: body.visibility,
  });
  return NextResponse.json({ id });
}
