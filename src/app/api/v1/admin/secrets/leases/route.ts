import { NextResponse } from 'next/server';
import {
  baoLeaseDetail,
  baoLeaseList,
  baoLeaseRevoke,
  openBaoConfigured,
} from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';
import { type LeaseRow, shouldAutoDescend } from '@/lib/secrets-ops';

export const dynamic = 'force-dynamic';

// Lease inventory. Leases are opaque handles + TTLs (operational metadata, not secret material).
// GET  ?prefix=...          → list lease ids under a prefix (default root)
// GET  ?id=...              → look up one lease's TTL / renewable / expiry
// DELETE ?id=...            → revoke a lease (DESTRUCTIVE — invalidates the underlying credential)
//
// A lease listing routinely bottoms out through several single-child namespaces before it reaches
// an actual lease (the dynamic-DB engine issues at `database/creds/<role>/<id>` — three hops below
// the mount root). Landing on the root and stopping at the first folder read as an empty page even
// with a real, revocable lease two levels down. `listWithAutoDescend` walks that chain — bounded, and
// only while the DECISION (shouldAutoDescend, pure/tested) says the next hop is unambiguous — and
// returns the prefix it actually stopped at, so the UI's search box reflects where it landed.
const MAX_AUTO_DESCEND = 6;

async function listWithAutoDescend(prefix: string): Promise<{ prefix: string; leases: LeaseRow[] }> {
  let current = prefix;
  for (let hop = 0; hop < MAX_AUTO_DESCEND; hop += 1) {
    const rows = await baoLeaseList(current);
    const deeper = shouldAutoDescend(rows);
    if (!deeper) return { prefix: current, leases: rows };
    current = deeper;
  }
  return { prefix: current, leases: await baoLeaseList(current) };
}

// A lease id is a slash path of the same safe charset we allow for secret keys, so validate loosely.
function validLeaseId(raw: string | null): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 512 && !raw.includes('..');
}

function guard(): NextResponse | null {
  if (!openBaoConfigured()) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  return null;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const blocked = guard();
  if (blocked) return blocked;
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  try {
    if (id) {
      if (!validLeaseId(id)) return NextResponse.json({ error: 'invalid lease id' }, { status: 400 });
      const detail = await baoLeaseDetail(id);
      return NextResponse.json({ detail });
    }
    const prefix = params.get('prefix') ?? '';
    const { prefix: landedPrefix, leases } = await listWithAutoDescend(prefix);
    return NextResponse.json({ prefix: landedPrefix, leases });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const blocked = guard();
  if (blocked) return blocked;
  const id = new URL(req.url).searchParams.get('id');
  if (!validLeaseId(id)) return NextResponse.json({ error: 'invalid lease id' }, { status: 400 });
  try {
    await baoLeaseRevoke(id);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
