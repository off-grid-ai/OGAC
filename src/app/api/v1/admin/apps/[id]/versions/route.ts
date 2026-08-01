import { NextResponse } from 'next/server';
import { getApp } from '@/lib/apps-store';
import { diffAppVersions } from '@/lib/app-version-diff';
import { listAppVersions } from '@/lib/app-versions-store';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/apps/[id]/versions — immutable history, newest first, each row carrying WHAT
// CHANGED from the version before it.
//
// ROADMAP §10 Flow 7: "compares with previous versions". A list of version numbers is not a comparison,
// so the diff is computed here (pure `diffAppVersions`) and returned with the row — the operator reads
// "Instructions rewritten on Draft Notice (412 → 690 characters)", not "v4".
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const versions = await listAppVersions(id, orgId);
  // Newest first; each row diffs against its predecessor (the row AFTER it in this ordering).
  const data = versions.map((v, i) => {
    const previous = versions[i + 1];
    return {
      id: v.id,
      version: v.version,
      note: v.note,
      createdAt: v.createdAt,
      createdBy: v.createdBy,
      isFirst: !previous,
      changes: previous ? diffAppVersions(previous.snapshot, v.snapshot) : [],
    };
  });
  return NextResponse.json({ object: 'list', data, currentVersion: versions[0]?.version ?? 0 });
}
