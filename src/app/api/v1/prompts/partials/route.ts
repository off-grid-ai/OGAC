import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import { createPartial, listPartials } from '@/lib/prompt-partials';

export const dynamic = 'force-dynamic';

// Prompt PARTIALS — reusable prompt fragments composed into prompts via `{{>name}}`. Listing is scoped
// to the caller (their private partials + every org-visible partial); creation is available to any
// authenticated user.
export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const owner = gate.user.email ?? '';
  return NextResponse.json({ partials: await listPartials(owner) });
}

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const owner = gate.user.email ?? '';
  const body = await req.json().catch(() => ({}));
  const { id, name } = await createPartial(owner, {
    name: typeof body.name === 'string' ? body.name : undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    visibility: body.visibility,
  });
  return NextResponse.json({ id, name });
}
