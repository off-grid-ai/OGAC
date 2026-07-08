import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteConnector, updateConnector } from '@/lib/store';
import { splitEndpointSecret, persistConnectorSecret } from '@/lib/connector-secrets';

const AUTHS = ['none', 'api-key', 'oauth'];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  if (body.auth !== undefined && !AUTHS.includes(body.auth as string)) {
    return NextResponse.json({ error: 'auth must be none | api-key | oauth' }, { status: 400 });
  }

  // If the edit carries an endpoint, peel any embedded SQL password off it (pure split) so the row
  // NEVER stores `scheme://user:PASS@host` — the sanitized, credential-free endpoint is persisted and
  // the peeled secret is vaulted below, matching the create path. REST base URLs and already-clean
  // endpoints split to secret=null and are stored verbatim.
  const rawEndpoint = body.endpoint as string | undefined;
  const { endpoint: cleanEndpoint, secret: peeledSecret } =
    rawEndpoint !== undefined ? splitEndpointSecret(rawEndpoint) : { endpoint: undefined, secret: null };

  const updated = await updateConnector(id, {
    name: body.name as string | undefined,
    type: body.type as string | undefined,
    endpoint: cleanEndpoint,
    auth: body.auth as string | undefined,
    description: body.description as string | undefined,
  });
  if (!updated) return NextResponse.json({ error: 'unknown connector' }, { status: 404 });

  // Vault the peeled credential (if any) AFTER the row update succeeds, so a rotated password from an
  // edited endpoint lands in OpenBao and the DB stays clean. A vault failure is surfaced (502) — the
  // endpoint is already sanitized, so we never silently keep a plaintext secret around.
  if (peeledSecret) {
    try {
      await persistConnectorSecret(id, peeledSecret);
    } catch (e) {
      return NextResponse.json(
        { error: `Connector updated but the credential could not be vaulted: ${(e as Error).message}` },
        { status: 502 },
      );
    }
  }
  auditFromSession(gate, await currentOrgId(), {
    action: 'connector.update',
    resource: `connector:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteConnector(id);
  auditFromSession(gate, await currentOrgId(), {
    action: 'connector.delete',
    resource: `connector:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
