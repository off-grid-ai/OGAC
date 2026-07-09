import { NextResponse } from 'next/server';
import { createConsoleUser, listUsers, type ConsoleUser } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { SCIM_CONTENT, scimAuthorized } from '../../auth';

// SCIM 2.0 User provisioning (RFC 7644). Minimal but spec-shaped: List + Create are implemented so
// an IdP can push users into the console. Group sync (/Groups) is a documented TODO — SCIM group →
// custom-role mapping is not wired yet.

export const dynamic = 'force-dynamic';

const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

function scimUser(u: ConsoleUser): Record<string, unknown> {
  return {
    schemas: [SCHEMA_USER],
    id: u.id,
    userName: u.email,
    displayName: u.name ?? u.email,
    active: true,
    emails: u.email ? [{ value: u.email, primary: true }] : [],
    // Non-standard extension: surface the console RBAC role.
    'urn:offgrid:params:scim:schemas:extension:2.0:User': { role: u.role },
  };
}

function json(body: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { 'content-type': SCIM_CONTENT },
  });
}

function err(detail: string, status: number): NextResponse {
  return json({ schemas: [SCHEMA_ERROR], detail, status: String(status) }, status);
}

export async function GET(req: Request) {
  if (!scimAuthorized(req)) return err('unauthorized', 401);
  // Tenant-scoped (SECURITY WAVE 1): the SCIM directory returns only the provisioning credential's
  // org — was the WHOLE cross-tenant user directory (P0).
  const users = await listUsers(await currentOrgId());
  return json({
    schemas: [SCHEMA_LIST],
    totalResults: users.length,
    startIndex: 1,
    itemsPerPage: users.length,
    Resources: users.map(scimUser),
  });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  if (!scimAuthorized(req)) return err('unauthorized', 401);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const emails = b?.emails as { value?: string }[] | undefined;
  const email = (b?.userName as string | undefined) ?? emails?.[0]?.value;
  if (!email) return err('userName or emails required', 400);
  // Stamp the provisioning credential's org so the SCIM-created user lands in that tenant.
  const user = await createConsoleUser({
    email,
    name: (b?.displayName as string | undefined) ?? null,
    orgId: await currentOrgId(),
  });
  return json(scimUser(user), 201);
}
