import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addDocument, listDocuments } from '@/lib/brain';
import { normalizeAcl } from '@/lib/retrieval/acl';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listDocuments() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const title = body?.title as string | undefined;
  const text = body?.text as string | undefined;
  const source = (body?.source as string | undefined) ?? 'KB';
  if (!title || !text) {
    return NextResponse.json({ error: 'title and text are required' }, { status: 400 });
  }
  // Optional per-document ACL for permissions-aware retrieval. Absent/empty → un-ACL'd (visible).
  const acl = normalizeAcl(body?.acl) ?? undefined;
  return NextResponse.json(await addDocument(title, source, text, acl), { status: 201 });
}
