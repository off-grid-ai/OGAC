import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { pipelineTag, validateKeyName } from '@/lib/pipeline-api-key-format';
import { listKeys, mintKey } from '@/lib/pipeline-api-keys';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// A pipeline's provisioned API keys. Admin-gated, org-scoped, audited. GET lists (never the hash);
// POST mints and returns the plaintext ONCE. Thin handler — all logic in pipeline-api-keys.ts.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  const keys = await listKeys(id, orgId);
  return NextResponse.json({ object: 'list', data: keys });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const check = validateKeyName(body?.name);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const by = gate.user.email ?? 'service@offgrid.local';
  const minted = await mintKey(id, check.name as string, orgId, by);

  auditFromSession(gate, orgId, {
    action: 'pipeline.key.mint',
    resource: pipelineTag(id),
    outcome: 'ok',
  });

  // The plaintext is included ONCE here — the client must capture it now; it is never retrievable
  // again (only its hash is stored).
  return NextResponse.json({ key: minted.view, apiKey: minted.apiKey }, { status: 201 });
}
