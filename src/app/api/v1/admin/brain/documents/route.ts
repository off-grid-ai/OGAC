import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addDocument, BrainWriteError, listDocuments } from '@/lib/brain';
import { normalizeAcl } from '@/lib/retrieval/acl';
import { currentOrgId } from '@/lib/tenancy';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listDocuments(await currentOrgId()) });
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
  const orgId = await currentOrgId();
  try {
    return NextResponse.json(await addDocument(title, source, text, acl, orgId), { status: 201 });
  } catch (e) {
    if (e instanceof BrainWriteError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
