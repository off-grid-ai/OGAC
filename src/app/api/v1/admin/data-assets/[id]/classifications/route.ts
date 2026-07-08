import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { CLASSIFICATION_LEVELS } from '@/lib/data-classification';
import {
  assetPosture,
  getAsset,
  listClassifications,
  setClassification,
} from '@/lib/data-catalog-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Per-asset classification (M4). GET → the asset's classification rows + derived posture. POST →
// upsert a classification for a column (null column = asset-level default). Drives policy.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const asset = await getAsset(id, org);
  if (!asset) return NextResponse.json({ error: 'unknown data asset' }, { status: 404 });
  const [classifications, posture] = await Promise.all([
    listClassifications(id, org),
    assetPosture(id, org),
  ]);
  return NextResponse.json({ object: 'list', data: classifications, posture });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const asset = await getAsset(id, org);
  if (!asset) return NextResponse.json({ error: 'unknown data asset' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const level = String(body?.level ?? '').trim().toLowerCase();
  if (!(CLASSIFICATION_LEVELS as readonly string[]).includes(level)) {
    return NextResponse.json(
      { error: `level must be one of ${CLASSIFICATION_LEVELS.join(', ')}` },
      { status: 400 },
    );
  }
  const piiTags = Array.isArray(body?.piiTags) ? (body!.piiTags as unknown[]).map(String) : [];
  const column = body?.column ? String(body.column).trim() : null;

  const row = await setClassification(id, { level, piiTags, column }, org);
  auditFromSession(gate, org, {
    action: 'data-classification.set',
    resource: `data-asset:${id}${column ? `#${column}` : ''}`,
    outcome: 'ok',
  });
  return NextResponse.json(row, { status: 201 });
}
