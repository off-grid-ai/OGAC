import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { isObjectStoreConfigured, seaweedfsObjectStore as store } from '@/lib/adapters/s3-object-store';
import { validateBucketName } from '@/lib/object-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Data lake — bucket lifecycle over the SeaweedFS S3 object store. GET lists buckets; POST creates
// one; DELETE removes an (empty) one. Thin over the adapter; honest {configured:false} when the store
// isn't wired.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!isObjectStoreConfigured()) return NextResponse.json({ configured: false, buckets: [] });
  return NextResponse.json({ configured: true, buckets: await store.listBuckets() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  { const v = validateBucketName(name); if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 }); }
  if (!isObjectStoreConfigured()) return NextResponse.json({ error: 'object store not configured' }, { status: 503 });
  try {
    await store.createBucket(name);
    auditFromSession(gate, await currentOrgId(), { action: 'lake.bucket.create', resource: `bucket:${name}`, outcome: 'ok' });
    return NextResponse.json({ ok: true, name }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const name = (new URL(req.url).searchParams.get('name') ?? '').trim();
  { const v = validateBucketName(name); if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 }); }
  try {
    await store.deleteBucket(name);
    auditFromSession(gate, await currentOrgId(), { action: 'lake.bucket.delete', resource: `bucket:${name}`, outcome: 'ok' });
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
