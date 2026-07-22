import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { seaweedfsObjectStore as store } from '@/lib/adapters/s3-object-store';
import { validateBucketName, validateObjectKey } from '@/lib/object-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Objects within a lake bucket. GET lists (?prefix) OR downloads one (?key + &download); POST puts the
// request body at ?key; DELETE removes ?key. Thin over the SeaweedFS S3 adapter; keys/buckets are
// validated by the pure layer before we touch the wire.
export async function GET(req: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { bucket } = await params;
  if (!validateBucketName(bucket).ok) return NextResponse.json({ error: 'bad bucket' }, { status: 400 });
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (key && url.searchParams.get('download') != null) {
    if (!validateObjectKey(key).ok) return NextResponse.json({ error: 'bad key' }, { status: 400 });
    const obj = await store.getObject(bucket, key);
    if (!obj) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return new Response(new Uint8Array(obj.bytes) as BodyInit, {
      headers: { 'content-type': obj.contentType || 'application/octet-stream' },
    });
  }
  const listing = await store.listObjects(bucket, { prefix: url.searchParams.get('prefix') ?? undefined });
  return NextResponse.json(listing);
}

export async function POST(req: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { bucket } = await params;
  const key = new URL(req.url).searchParams.get('key') ?? '';
  if (!validateBucketName(bucket).ok) return NextResponse.json({ error: 'bad bucket' }, { status: 400 });
  const kv = validateObjectKey(key);
  if (!kv.ok) return NextResponse.json({ error: kv.error }, { status: 400 });
  try {
    const body = Buffer.from(await req.arrayBuffer());
    await store.putObject(bucket, key, body, req.headers.get('content-type') || 'application/octet-stream');
    auditFromSession(gate, await currentOrgId(), { action: 'lake.object.put', resource: `object:${bucket}/${key}`, outcome: 'ok' });
    return NextResponse.json({ ok: true, bucket, key, bytes: body.length }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { bucket } = await params;
  const key = new URL(req.url).searchParams.get('key') ?? '';
  if (!validateBucketName(bucket).ok || !validateObjectKey(key).ok) {
    return NextResponse.json({ error: 'bad bucket/key' }, { status: 400 });
  }
  try {
    const ok = await store.deleteObject(bucket, key);
    auditFromSession(gate, await currentOrgId(), { action: 'lake.object.delete', resource: `object:${bucket}/${key}`, outcome: ok ? 'ok' : 'error' });
    return NextResponse.json({ ok, bucket, key });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
