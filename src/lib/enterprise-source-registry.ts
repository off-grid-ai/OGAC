/**
 * Canonical logical inventory for the six enterprise source fixtures.
 *
 * These entries are deliberately separate from Operations > Services: they are customer data
 * systems owned by Data > Sources, not platform services. Deployment configuration remains owned
 * by the private fleet repository; this pure registry projects the stable product ontology and the
 * canonical Console routes without turning containers into navigation entities.
 */

export type EnterpriseSourceRole =
  | 'core-banking'
  | 'policy-administration'
  | 'finance-erp'
  | 'event-stream'
  | 'object-store'
  | 'crm';

export interface EnterpriseSourceDefinition {
  id: string;
  key: 'corebank' | 'policyadmin' | 'erp' | 'kafka' | 'minio' | 'crm';
  label: string;
  description: string;
  role: EnterpriseSourceRole;
  connectorType: 'postgres' | 'mysql' | 'mssql' | 'kafka' | 's3' | 'rest';
  /** Stable container/process identity; health and placement still come from the fleet registry. */
  process: string;
  version: string;
  mutableVersion: boolean;
  systemOfRecord: string;
  listRoute: '/data/sources';
  detailRoutePattern: '/data/connectors/[id]';
  managementRoute: '/data/sources';
  /** Credential-free local endpoint used by the deterministic bank/insurance seed. */
  seedEndpoint: string;
  seededWorkflowEvidence: readonly string[];
  nextAction: string;
}

const FLEET_SOURCE = '../onprem-fleet-orchestration/deploy/onprem/data-sources.yml' as const;

export const ENTERPRISE_SOURCE_DEFINITIONS: readonly EnterpriseSourceDefinition[] = [
  {
    id: 'enterprise-source-corebank',
    key: 'corebank',
    label: 'Core Banking',
    description: 'Core banking OLTP for customers, policies, claims, and transactions.',
    role: 'core-banking',
    connectorType: 'postgres',
    process: 'offgrid-ds-corebank',
    version: '16-alpine',
    mutableVersion: true,
    systemOfRecord: FLEET_SOURCE,
    listRoute: '/data/sources',
    detailRoutePattern: '/data/connectors/[id]',
    managementRoute: '/data/sources',
    seedEndpoint: 'postgres://corebank@127.0.0.1:5433/corebank',
    seededWorkflowEvidence: ['lender delinquency', 'claims and policy lookup'],
    nextAction:
      'Keep connector health, schema discovery, sync, and governed query evidence current.',
  },
  {
    id: 'enterprise-source-policyadmin',
    key: 'policyadmin',
    label: 'Policy Administration',
    description: 'Policy administration for branches, agents, commissions, and employee quotas.',
    role: 'policy-administration',
    connectorType: 'mysql',
    process: 'offgrid-ds-policyadmin',
    version: '8',
    mutableVersion: true,
    systemOfRecord: FLEET_SOURCE,
    listRoute: '/data/sources',
    detailRoutePattern: '/data/connectors/[id]',
    managementRoute: '/data/sources',
    seedEndpoint: 'mysql://policyadmin@127.0.0.1:3307/policyadmin',
    seededWorkflowEvidence: ['reimbursement approval', 'advisor and policy operations'],
    nextAction:
      'Keep connector health, schema discovery, sync, and governed query evidence current.',
  },
  {
    id: 'enterprise-source-erp',
    key: 'erp',
    label: 'Finance ERP',
    description: 'Finance ERP system of record for general-ledger entries and invoices.',
    role: 'finance-erp',
    connectorType: 'mssql',
    process: 'offgrid-ds-erp',
    version: 'latest',
    mutableVersion: true,
    systemOfRecord: FLEET_SOURCE,
    listRoute: '/data/sources',
    detailRoutePattern: '/data/connectors/[id]',
    managementRoute: '/data/sources',
    seedEndpoint: 'mssql://sa@127.0.0.1:1433/master',
    seededWorkflowEvidence: ['reimbursement invoice validation'],
    nextAction: 'Replace the mutable image tag and preserve real invoice-query evidence.',
  },
  {
    id: 'enterprise-source-kafka',
    key: 'kafka',
    label: 'Kafka-compatible Events',
    description: 'Source event stream for banking transactions, claims, and CRM events.',
    role: 'event-stream',
    connectorType: 'kafka',
    process: 'offgrid-ds-kafka',
    version: '24.2.7',
    mutableVersion: false,
    systemOfRecord: FLEET_SOURCE,
    listRoute: '/data/sources',
    detailRoutePattern: '/data/connectors/[id]',
    managementRoute: '/data/sources',
    seedEndpoint: 'kafka://127.0.0.1:19092',
    seededWorkflowEvidence: [],
    nextAction:
      'Wire a tenant-scoped producer/consumer workflow before claiming product integration.',
  },
  {
    id: 'enterprise-source-minio',
    key: 'minio',
    label: 'S3-compatible Data Lake',
    description: 'S3-compatible landing and archive store for enterprise files and extracts.',
    role: 'object-store',
    connectorType: 's3',
    process: 'offgrid-ds-minio',
    version: 'RELEASE.2025-04-08T15-41-24Z',
    mutableVersion: false,
    systemOfRecord: FLEET_SOURCE,
    listRoute: '/data/sources',
    detailRoutePattern: '/data/connectors/[id]',
    managementRoute: '/data/sources',
    seedEndpoint: 'http://127.0.0.1:9010',
    seededWorkflowEvidence: [],
    nextAction: 'Add governed object read/write evidence before claiming workflow use.',
  },
  {
    id: 'enterprise-source-crm',
    key: 'crm',
    label: 'CRM',
    description: 'Salesforce-style REST source for accounts, opportunities, and contacts.',
    role: 'crm',
    connectorType: 'rest',
    process: 'offgrid-ds-crm',
    version: '20-alpine',
    mutableVersion: true,
    systemOfRecord: FLEET_SOURCE,
    listRoute: '/data/sources',
    detailRoutePattern: '/data/connectors/[id]',
    managementRoute: '/data/sources',
    seedEndpoint: 'http://127.0.0.1:8090',
    seededWorkflowEvidence: ['customer and cross-sell context lookup'],
    nextAction: 'Keep connector health and governed REST-query evidence current.',
  },
];

export function findEnterpriseSource(
  key: EnterpriseSourceDefinition['key'],
): EnterpriseSourceDefinition {
  const source = ENTERPRISE_SOURCE_DEFINITIONS.find((entry) => entry.key === key);
  if (!source) throw new Error(`Unknown enterprise source: ${key}`);
  return source;
}
