import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import {
  getBucketLifecycle,
  getBucketPolicy,
  setBucketLifecycle,
  setBucketPolicy,
} from '@/lib/files';
import { normalizeLifecycleRule } from '@/lib/storage-lifecycle';

export const dynamic = 'force-dynamic';

// Bucket-level administration: object-expiry lifecycle + public/private policy. Admin-only — these
// affect the whole shared media store. Where SeaweedFS's S3 impl doesn't support a call, the lib
// returns { supported:false, note } and we relay it (no faked success).

// GET /api/v1/storage/bucket — { lifecycle, policy } current state.
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  if (gate.user.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });
  const [lifecycle, policy] = await Promise.all([getBucketLifecycle(), getBucketPolicy()]);
  return NextResponse.json({ lifecycle, policy });
}

// PUT /api/v1/storage/bucket — { rules?: LifecycleRule[], access?: 'public' | 'private' }.
// Applies whichever fields are present; returns the resulting state for each.
export async function PUT(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  if (gate.user.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    rules?: unknown;
    access?: unknown;
  };

  const out: Record<string, unknown> = {};

  if (Array.isArray(body.rules)) {
    const rules = body.rules
      .map((r) => normalizeLifecycleRule(r as Record<string, unknown>))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    out.lifecycle = await setBucketLifecycle(rules);
  }

  if (body.access === 'public' || body.access === 'private') {
    out.policy = await setBucketPolicy(body.access);
  }

  if (Object.keys(out).length === 0) {
    return NextResponse.json({ error: 'nothing to update — provide rules and/or access' }, { status: 400 });
  }
  return NextResponse.json(out);
}
