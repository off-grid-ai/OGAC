import { NextResponse } from 'next/server';
import { SCIM_CONTENT, scimAuthorized } from '../../auth';

// SCIM 2.0 Group provisioning — STUB. Group sync (SCIM group → console custom-role mapping) is not
// implemented yet. List returns an empty, spec-shaped ListResponse so IdP discovery/validation
// succeeds; create is intentionally not-implemented.
// TODO: map SCIM groups onto custom_roles + reflect membership onto users.role.

export const dynamic = 'force-dynamic';

const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

function scim(body: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { 'content-type': SCIM_CONTENT },
  });
}

export async function GET(req: Request) {
  if (!scimAuthorized(req)) {
    return scim({ schemas: [SCHEMA_ERROR], detail: 'unauthorized', status: '401' }, 401);
  }
  return scim({
    schemas: [SCHEMA_LIST],
    totalResults: 0,
    startIndex: 1,
    itemsPerPage: 0,
    Resources: [],
  });
}

export async function POST(req: Request) {
  if (!scimAuthorized(req)) {
    return scim({ schemas: [SCHEMA_ERROR], detail: 'unauthorized', status: '401' }, 401);
  }
  return scim(
    { schemas: [SCHEMA_ERROR], detail: 'group provisioning not implemented', status: '501' },
    501,
  );
}
