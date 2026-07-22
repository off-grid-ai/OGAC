import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import {
  isGovernedKafkaConnector,
  isGovernedKafkaDomain,
} from '@/lib/adapters/kafka-source-onboarding';
import { requireAdmin } from '@/lib/authz';
import { getConnector } from '@/lib/connector-detail';
import { deleteDomain, getDomain, updateDomain } from '@/lib/data-domains-store';
import { parseAliases } from '@/lib/data-domains-ui';
import { currentOrgId } from '@/lib/tenancy';

function governedKafkaConflict(): NextResponse {
  return NextResponse.json(
    {
      error: 'Manage this governed event source from its source page.',
      manageAt: '/api/v1/admin/kafka-sources',
    },
    { status: 409 },
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const domain = await getDomain(id, await currentOrgId());
  if (!domain) return NextResponse.json({ error: 'unknown data domain' }, { status: 404 });
  return NextResponse.json(domain);
}

interface DomainPatch {
  label?: string;
  connectorId?: string;
  resource?: string;
  aliases?: string[];
  opHints?: Record<string, unknown> | null;
}

// Pure: validate + build the partial-update patch from the request body. Field-level validation on
// the fields actually present; empty required fields are rejected (rather than clearing a live
// binding) via an error result the handler surfaces as a 400 — behavior-identical to the previous
// inline validation.
function buildDomainPatch(
  body: Record<string, unknown>,
): { ok: true; patch: DomainPatch } | { ok: false; error: string } {
  const patch: DomainPatch = {};
  if (body.label !== undefined) {
    const label = String(body.label).trim();
    if (!label) return { ok: false, error: 'label cannot be empty' };
    patch.label = label;
  }
  if (body.connectorId !== undefined) {
    const c = String(body.connectorId).trim();
    if (!c) return { ok: false, error: 'connectorId cannot be empty' };
    patch.connectorId = c;
  }
  if (body.resource !== undefined) {
    const r = String(body.resource).trim();
    if (!r) return { ok: false, error: 'resource cannot be empty' };
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
  return { ok: true, patch };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const built = buildDomainPatch(body);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
  const patch = built.patch;

  const orgId = await currentOrgId();
  if (!(await getDomain(id, orgId))) {
    return NextResponse.json({ error: 'unknown data domain' }, { status: 404 });
  }
  if (await isGovernedKafkaDomain(id, orgId)) {
    return governedKafkaConflict();
  }
  if (patch.connectorId) {
    if (!(await getConnector(patch.connectorId, orgId))) {
      return NextResponse.json(
        { error: 'The selected data source was not found.' },
        { status: 404 },
      );
    }
    if (await isGovernedKafkaConnector(patch.connectorId, orgId)) {
      return governedKafkaConflict();
    }
  }
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
  if (!(await getDomain(id, orgId))) {
    return NextResponse.json({ error: 'unknown data domain' }, { status: 404 });
  }
  if (await isGovernedKafkaDomain(id, orgId)) {
    return governedKafkaConflict();
  }
  const removed = await deleteDomain(id, orgId);
  if (!removed) return NextResponse.json({ error: 'unknown data domain' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'data-domain.delete',
    resource: `data-domain:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
