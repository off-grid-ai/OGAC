import { scopeSecretKey } from '@/lib/secret-scope';

const CONNECTOR_ID_RE = /^[A-Za-z0-9._-]+$/;
const CONNECTOR_CREDENTIAL_SUFFIX = /(?:^|\/)connectors\/[A-Za-z0-9._-]+\/credential$/;

/** Tenant-relative connector credential path used by lifecycle APIs and reservation checks. */
export function connectorSecretRelativeKey(connectorId: string): string {
  if (!CONNECTOR_ID_RE.test(connectorId)) throw new Error('invalid connector id');
  return `connectors/${connectorId}/credential`;
}

/** Canonical stored path. Default-org paths remain byte-compatible with legacy single-tenant data. */
export function connectorSecretKey(connectorId: string, orgId: string): string {
  return scopeSecretKey(orgId, connectorSecretRelativeKey(connectorId));
}

/**
 * Reserve connector-owned credential leaves from generic Secrets CRUD. Matching by suffix also
 * catches a default-org caller supplying another tenant's already-prefixed absolute-looking path.
 */
export function isConnectorCredentialPath(key: string): boolean {
  return CONNECTOR_CREDENTIAL_SUFFIX.test(key.trim());
}
