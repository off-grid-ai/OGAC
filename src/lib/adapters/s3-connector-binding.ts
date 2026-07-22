import { createS3ObjectStore, type ObjectStorePort } from '@/lib/adapters/s3-object-store';
import { getConnector } from '@/lib/connector-detail';
import { parseObjectStoreCredential } from '@/lib/connector-policy';
import { resolveConnectorSecret } from '@/lib/connector-secrets';
import { listDomains } from '@/lib/data-domains-store';
import { resolveObjectAccessScope, type ObjectAccessScope } from '@/lib/object-store';

export type ConnectorObjectBindingFailure =
  'unknown-source' | 'not-object-store' | 'unapproved-scope' | 'missing-credential';

export class ConnectorObjectBindingError extends Error {
  readonly code: ConnectorObjectBindingFailure;

  constructor(code: ConnectorObjectBindingFailure, message: string) {
    super(message);
    this.code = code;
    this.name = 'ConnectorObjectBindingError';
  }
}

export interface ConnectorObjectBinding {
  connector: { id: string; name: string };
  scope: ObjectAccessScope;
  store: ObjectStorePort;
}

/**
 * Compose the existing org-scoped connector, data-domain and vault owners into one frozen S3 port.
 * No caller can supply an endpoint, bucket, prefix or credential directly.
 */
export async function resolveConnectorObjectBinding(input: {
  orgId: string;
  connectorId: string;
  domainId: string;
}): Promise<ConnectorObjectBinding> {
  const connector = await getConnector(input.connectorId, input.orgId);
  if (!connector) {
    throw new ConnectorObjectBindingError('unknown-source', 'Object source was not found.');
  }
  if (connector.type.toLowerCase() !== 's3') {
    throw new ConnectorObjectBindingError(
      'not-object-store',
      'This source is not an S3 object store.',
    );
  }
  const scope = resolveObjectAccessScope({
    orgId: input.orgId,
    connectorId: connector.id,
    domainId: input.domainId,
    bindings: await listDomains(input.orgId),
  });
  if (!scope.ok) {
    throw new ConnectorObjectBindingError('unapproved-scope', scope.error);
  }
  const credential = parseObjectStoreCredential(
    await resolveConnectorSecret(connector.id, input.orgId),
  );
  if (!credential) {
    throw new ConnectorObjectBindingError(
      'missing-credential',
      'This object source does not have a usable S3 keypair in the secrets vault.',
    );
  }
  return {
    connector: { id: connector.id, name: connector.name },
    scope: scope.scope,
    store: createS3ObjectStore({
      endpoint: connector.endpoint,
      credential: async () => ({ kind: 's3', ...credential }),
    }),
  };
}
