import { NextResponse } from 'next/server';
import { addDocument, listDocuments } from '@/lib/brain';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listDocuments() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const title = body?.title as string | undefined;
  const text = body?.text as string | undefined;
  const source = (body?.source as string | undefined) ?? 'KB';
  if (!title || !text) {
    return NextResponse.json({ error: 'title and text are required' }, { status: 400 });
  }
  return NextResponse.json(await addDocument(title, source, text), { status: 201 });
}
