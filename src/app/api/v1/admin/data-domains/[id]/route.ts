import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteDomain, getDomain, updateDomain } from '@/lib/data-domains-store';
import { parseAliases } from '@/lib/data-domains-ui';
import { currentOrgId } from '@/lib/tenancy';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const domain = await getDomain(id, await currentOrgId());
  if (!domain) return NextResponse.json({ error: 'unknown data domain' }, { status: 404 });
  return NextResponse.json(domain);
}

// eslint-disable-next-line complexity
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  // Field-level validation on the fields actually present (partial update). Empty required fields
  // are rejected rather than clearing a live binding.
  const patch: {
    label?: string;
    connectorId?: string;
    resource?: string;
    aliases?: string[];
    opHints?: Record<string, unknown> | null;
  } = {};
  if (body.label !== undefined) {
    const label = String(body.label).trim();
    if (!label) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 });
    patch.label = label;
  }
  if (body.connectorId !== undefined) {
    const c = String(body.connectorId).trim();
    if (!c) return NextResponse.json({ error: 'connectorId cannot be empty' }, { status: 400 });
    patch.connectorId = c;
  }
  if (body.resource !== undefined) {
    const r = String(body.resource).trim();
    if (!r) return NextResponse.json({ error: 'resource cannot be empty' }, { status: 400 });
    patch.resource = r;
  }
  if (body.aliases !== undefined) {
    patch.aliases = Array.isArray(body.aliases)
      ? parseAliases((body.aliases as unknown[]).map(String).join(', '))
      : parseAliases(String(body.aliases));
  } else if (body.aliasesRaw !== undefined) {
    patch.aliases = parseAliases(String(body.aliasesRaw));
  }
  if (body.opHints !== undefined) {
    patch.opHints =
      body.opHints && typeof body.opHints === 'object'
        ? (body.opHints as Record<string, unknown>)
        : null;
  }

  const orgId = await currentOrgId();
  const updated = await updateDomain(id, patch, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown data domain' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'data-domain.update',
    resource: `data-domain:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const removed = await deleteDomain(id, orgId);
  if (!removed) return NextResponse.json({ error: 'unknown data domain' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'data-domain.delete',
    resource: `data-domain:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
