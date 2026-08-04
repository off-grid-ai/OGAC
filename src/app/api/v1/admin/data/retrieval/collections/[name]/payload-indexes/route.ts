import { NextResponse } from 'next/server';
import { qdrantSnapshots } from '@/lib/adapters/qdrant-snapshots';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  describePayloadIndexes,
  recommendPayloadIndexes,
  validateIndexRequest,
} from '@/lib/qdrant-payload-index';
import { validateCollectionName } from '@/lib/qdrant-snapshots';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Payload indexes on a retrieval collection ─────────────────────────────────────────────────────
//
// Every governed retrieval filters on `org_id` — the tenant isolation boundary — and the deployed
// collection had no payload index at all, so Qdrant answered that filter by scanning. Invisible at three
// points; the first thing to fall over as a corpus grows.
//
// GET    → what is indexed, what we recommend, and one sentence saying which.
// POST   → create an index for a field.
// DELETE → drop one (?field=…), because an index nobody queries is memory and write cost.

async function collectionState(name: string) {
  const [present, info] = await Promise.all([
    qdrantSnapshots.listPayloadIndexes(name),
    qdrantSnapshots.getCollection(name).catch(() => null),
  ]);
  const points =
    (info as { pointsCount?: number | null; points_count?: number | null } | null)?.pointsCount ??
    (info as { points_count?: number | null } | null)?.points_count ??
    null;
  const recommendations = recommendPayloadIndexes(present, points);
  return {
    indexes: present,
    recommendations,
    points,
    summary: describePayloadIndexes(present, recommendations, points),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const v = validateCollectionName(name);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json(await collectionState(name));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const v = validateCollectionName(name);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { field?: string; type?: string } | null;
  // The field name reaches a REST path, so it is validated before it goes anywhere near one.
  const check = validateIndexRequest(body?.field ?? '', body?.type ?? 'keyword');
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    await qdrantSnapshots.createPayloadIndex(name, check.field, check.type);
    auditFromSession(gate, await currentOrgId(), {
      action: 'retrieval.payload-index.create',
      resource: `collection:${name}:${check.field}`,
      outcome: 'ok',
    });
    // Return the re-read state, so the caller sees the index exist rather than trusting the 201.
    return NextResponse.json({ ok: true, ...(await collectionState(name)) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const v = validateCollectionName(name);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const field = new URL(req.url).searchParams.get('field') ?? '';
  const check = validateIndexRequest(field, 'keyword');
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    await qdrantSnapshots.dropPayloadIndex(name, check.field);
    auditFromSession(gate, await currentOrgId(), {
      action: 'retrieval.payload-index.drop',
      resource: `collection:${name}:${check.field}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, ...(await collectionState(name)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
