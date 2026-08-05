import { NextResponse } from 'next/server';
import {
  discoverSourceBuckets,
  discoverSourcePrefixes,
} from '@/lib/adapters/s3-source-discovery';
import { requireAdmin } from '@/lib/authz';
import { validateBucketName } from '@/lib/object-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// What can this object source see? Used when configuring a data domain, so an operator PICKS a bucket
// and prefix instead of typing them from memory — a wrong guess saves cleanly and fails at run time on
// someone else's screen, as "no records".
//
// The connector id is the ONLY caller input. Endpoint and credential come from the stored connector and
// the vault; a route that accepted a URL here would be a request-forgery primitive wearing an admin
// path. Org-scoped through currentOrgId, so one tenant cannot enumerate another's source.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const bucket = new URL(req.url).searchParams.get('bucket');

  if (!bucket) {
    const out = await discoverSourceBuckets(orgId, id);
    return out.ok
      ? NextResponse.json({ buckets: out.result })
      : NextResponse.json({ error: out.error.message, code: out.error.code }, { status: statusFor(out.error.code) });
  }

  if (!validateBucketName(bucket).ok) {
    return NextResponse.json({ error: 'That is not a valid bucket name.' }, { status: 400 });
  }
  const under = new URL(req.url).searchParams.get('prefix') ?? '';
  const out = await discoverSourcePrefixes(orgId, id, bucket, under);
  return out.ok
    ? NextResponse.json(out.result)
    : NextResponse.json({ error: out.error.message, code: out.error.code }, { status: statusFor(out.error.code) });
}

// A source that is not found or not an object store is the CALLER's mistake (404/400); a source that
// cannot be reached is the deployment's (502). Collapsing them would send an operator hunting for a
// typo when the store is simply down.
function statusFor(code: string): number {
  if (code === 'unknown-source') return 404;
  if (code === 'not-object-store') return 400;
  if (code === 'missing-credential') return 409;
  return 502;
}
