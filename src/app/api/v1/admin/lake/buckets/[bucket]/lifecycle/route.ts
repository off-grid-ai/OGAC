import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { seaweedfsObjectStore as store } from '@/lib/adapters/s3-object-store';
import { normalizeLifecycleRule, type LifecycleRule } from '@/lib/storage-lifecycle';
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
  // Versioning rides along: "how long are files kept" and "are previous versions kept" are one
  // question for whoever answers for the data, and two round trips would let the surface show one
  // without the other.
  const [lifecycle, versioning] = await Promise.all([
    store.getLifecycle(bucket),
    store.getVersioning(bucket).catch(() => null),
  ]);
  return NextResponse.json({ ...lifecycle, versioning });
}

export async function PUT(req: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { bucket } = await params;
  if (!validateBucketName(bucket).ok) return NextResponse.json({ error: 'bad bucket' }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { rules?: unknown[] } | null;
  if (!b || !Array.isArray(b.rules)) return NextResponse.json({ error: 'rules[] required' }, { status: 400 });
  // NORMALISE BEFORE SENDING. The pure guard existed and this route was not calling it, so a rule
  // missing `expireDays` reached the XML builder and became `<Days>undefined</Days>` — the store
  // answered `MalformedXML`, which tells the operator nothing about which rule or which field.
  // Rejecting here names the problem while we still know what it is.
  const rules: LifecycleRule[] = [];
  const rejected: number[] = [];
  b.rules.forEach((raw, i) => {
    const rule = normalizeLifecycleRule((raw ?? {}) as Record<string, unknown>);
    if (rule) rules.push(rule);
    else rejected.push(i + 1);
  });
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        error: `rule ${rejected.join(', ')} needs a whole number of days to keep objects for, of at least 1`,
      },
      { status: 400 },
    );
  }
  try {
    const state = await store.setLifecycle(bucket, rules);
    auditFromSession(gate, await currentOrgId(), { action: 'lake.lifecycle.set', resource: `bucket:${bucket}`, outcome: 'ok' });
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
