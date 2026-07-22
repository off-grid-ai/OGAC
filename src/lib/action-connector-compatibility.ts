import { isInternalEnterpriseEndpoint } from '@/lib/connector-endpoint';

// Client-safe compatibility rule shared by the Enterprise Context resolver and Builder UI.
// A generic internal REST endpoint is not automatically a CRM: the connector must also carry an
// explicit CRM/Salesforce identity. Runtime still performs its own final endpoint/action checks.

export interface ActionConnectorIdentity {
  name: string;
  type: string;
  endpoint: string;
}

const CRM_IDENTITY = /(?:^|[^a-z0-9])(crm|salesforce)(?:$|[^a-z0-9])/i;

export function isCompatibleCrmActionConnector(connector: ActionConnectorIdentity): boolean {
  return (
    connector.type.trim().toLowerCase() === 'rest' &&
    CRM_IDENTITY.test(connector.name.trim()) &&
    isInternalEnterpriseEndpoint(connector.endpoint)
  );
}
