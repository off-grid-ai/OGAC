import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? undefined;

  try {
    const clients = await kc.listClients(search);
    return NextResponse.json({ configured: true, clients });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as {
    clientId?: string;
    name?: string;
    description?: string;
    serviceAccountsEnabled?: boolean;
  } | null;

  if (!body?.clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  try {
    const { id } = await kc.createClient({
      clientId: body.clientId,
      name: body.name,
      description: body.description,
      serviceAccountsEnabled: body.serviceAccountsEnabled,
    });

    // Generate initial secret
    const secret = await kc.regenerateClientSecret(id);
    const client = await kc.getClient(id);

    return NextResponse.json({ configured: true, client, secret }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
