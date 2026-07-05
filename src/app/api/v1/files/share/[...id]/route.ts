import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { getFileMeta, presignShareUrl } from '@/lib/files';

export const dynamic = 'force-dynamic';

// POST /api/v1/files/share/:id?ttl=<seconds> — mint a time-limited signed GET URL for the object.
// Owner or admin only (same gate as PATCH/DELETE). ttl is clamped to [60s, 7d]; default 1h.
// Returns { url, signed, expiresAt, ttlSeconds }. `signed:false` means SeaweedFS has no IAM keypair
// so the link can't actually expire — the UI shows this honestly rather than faking an expiry.
export async function POST(req: Request, { params }: { params: Promise<{ id: string[] }> }): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const id = (await params).id.join('/');

  const meta = await getFileMeta(id);
  if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const isAdmin = gate.user.role === 'admin';
  if (!isAdmin && meta.owner && meta.owner !== gate.user.email) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const raw = Number(new URL(req.url).searchParams.get('ttl') ?? '3600');
  const ttl = Number.isFinite(raw) ? Math.max(60, Math.min(604800, Math.floor(raw))) : 3600;

  const link = await presignShareUrl(id, ttl);
  return NextResponse.json(link);
}
