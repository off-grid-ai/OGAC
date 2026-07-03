import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readRetrieval } from '@/lib/retrieval-view';

export const dynamic = 'force-dynamic';

// Vector-store / retrieval read-back: active adapter, reachability, and the collections
// (name / vector count / status) reported by the Qdrant backend at OFFGRID_QDRANT_URL.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { data, error } = await readRetrieval();
  return NextResponse.json({ object: 'retrieval', data, error });
}
