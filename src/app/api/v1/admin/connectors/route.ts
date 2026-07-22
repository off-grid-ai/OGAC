import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  validateConnectorCreate,
  persistConnectorSecret,
  type ConnectorCreateInput,
} from '@/lib/connector-secrets';
import { createConnector, listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listConnectors(await currentOrgId()) });
}

// Create a connector from the self-serve form. The typed cred fields (SQL host/port/db/user/password
// or REST base URL + api key) are validated + normalized by the PURE validateConnectorCreate into a
// CREDENTIAL-FREE endpoint plus the secret material. We store the connector with that clean endpoint,
// then write the secret to the vault and stamp its secretRef on the row — the password/token never
// lands in the DB. Creds are re-injected from the vault at query time by connector-exec.ts.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as ConnectorCreateInput | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const result = validateConnectorCreate(body);
  if (!result.ok || !result.value) {
    return NextResponse.json({ error: result.errors.join(' ') || 'invalid connector' }, { status: 400 });
  }
  const v = result.value;
  const orgId = await currentOrgId();

  const created = await createConnector({
    name: v.name,
    type: v.type,
    endpoint: v.endpoint, // credential-free
    auth: v.auth,
    description: v.description,
    custom: true,
    orgId,
  });

  // Push the credential to the vault and reference it on the row. If the vault write fails we roll
  // the connector back so a user never ends up with a credential-less, non-connecting connector.
  try {
    await persistConnectorSecret(created.id, orgId, v.secret);
  } catch (e) {
    const { deleteConnector } = await import('@/lib/store');
    await deleteConnector(created.id, orgId).catch(() => undefined);
    console.error('vault write failed on connector create:', e);
    return NextResponse.json(
      { error: 'Could not store the credential securely. Please try again.' },
      { status: 502 },
    );
  }

  auditFromSession(gate, orgId, {
    action: 'connector.create',
    resource: `connector:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
