import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readRetrieval } from '@/lib/retrieval-view';
import { createCollection, recreateCollection } from '@/lib/retrieval-writer';

export const dynamic = 'force-dynamic';

// Vector-store / retrieval read-back: active adapter, reachability, and the collections
// (name / vector count / status) reported by the Qdrant backend at OFFGRID_QDRANT_URL.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { data, error } = await readRetrieval();
  return NextResponse.json({ object: 'retrieval', data, error });
}

// Create (or, with { recreate: true }, clear-and-recreate) a Qdrant collection. All validation
// and payload shaping is delegated to the pure helpers; a bad body is a clean 400, an upstream
// failure a 502 with a message — never a bare 500.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });

  const input = { name: body.name, vectorSize: body.vectorSize, distance: body.distance };
  const out = body.recreate === true ? await recreateCollection(input) : await createCollection(input);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.httpStatus });
  return NextResponse.json({ object: 'collection', name: out.name, ok: true }, { status: 201 });
}
