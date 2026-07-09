import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listArtifacts, saveArtifact } from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ artifacts: await listArtifacts(userId, await currentOrgId()) });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.kind || !body.code) {
    return NextResponse.json({ error: 'kind and code required' }, { status: 400 });
  }
  const id = await saveArtifact(userId, await currentOrgId(), {
    kind: String(body.kind),
    code: String(body.code),
    language: body.language ?? null,
    title: body.title ? String(body.title) : 'Untitled artifact',
    conversationId: body.conversationId ?? null,
  });
  return NextResponse.json({ id });
}
