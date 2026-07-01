import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { executeAction, skillActionTools } from '@/lib/chat-actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET: the callable tools registered from this assistant's Actions OpenAPI schema.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ tools: await skillActionTools(id) });
}

// POST: invoke one registered action by name with arguments.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const { name, args = {} } = await req.json().catch(() => ({}));
  const tools = await skillActionTools(id);
  const tool = tools.find((t) => t.name === name);
  if (!tool) return NextResponse.json({ error: 'unknown action' }, { status: 404 });
  try {
    const res = await executeAction(tool, args ?? {});
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
