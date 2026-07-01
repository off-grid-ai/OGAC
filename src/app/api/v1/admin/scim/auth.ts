// SCIM bearer-token gate. An IdP (Okta/Entra/etc.) authenticates to the SCIM endpoints with a
// static bearer token provisioned out-of-band. Set OFFGRID_SCIM_TOKEN to enable; when unset the
// endpoints are disabled (return false) so the stub can't be hit unauthenticated.
export function scimAuthorized(req: Request): boolean {
  const expected = process.env.OFFGRID_SCIM_TOKEN;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  return Boolean(token) && token === expected;
}

export const SCIM_CONTENT = 'application/scim+json';
