import { NextResponse } from 'next/server';
import { addPromptVersion, listPromptVersions } from '@/lib/store';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ object: 'list', data: await listPromptVersions(id) });
}

// Publish a new immutable version of the prompt.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { body?: unknown; label?: unknown } | null;
  if (!b || typeof b.body !== 'string' || !b.body.trim()) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }
  const v = await addPromptVersion(id, b.body, (b.label as string | undefined) ?? '');
  if (!v) return NextResponse.json({ error: 'unknown prompt' }, { status: 404 });
  return NextResponse.json(v, { status: 201 });
}
