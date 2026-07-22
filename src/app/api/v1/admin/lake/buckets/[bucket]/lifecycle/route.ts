import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { seaweedfsObjectStore as store } from '@/lib/adapters/s3-object-store';
import type { LifecycleRule } from '@/lib/storage-lifecycle';
import { validateBucketName } from '@/lib/object-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Bucket lifecycle/retention policy over the S3 API. GET returns the current rules (+ whether the
// deployed store supports them — honest: SeaweedFS may not); PUT sets them.
export async function GET(req: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { bucket } = await params;
  if (!validateBucketName(bucket).ok) return NextResponse.json({ error: 'bad bucket' }, { status: 400 });
  return NextResponse.json(await store.getLifecycle(bucket));
}

export async function PUT(req: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { bucket } = await params;
  if (!validateBucketName(bucket).ok) return NextResponse.json({ error: 'bad bucket' }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { rules?: LifecycleRule[] } | null;
  if (!b || !Array.isArray(b.rules)) return NextResponse.json({ error: 'rules[] required' }, { status: 400 });
  try {
    const state = await store.setLifecycle(bucket, b.rules);
    auditFromSession(gate, await currentOrgId(), { action: 'lake.lifecycle.set', resource: `bucket:${bucket}`, outcome: 'ok' });
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
