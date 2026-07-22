import { queryDomain } from '@/lib/adapters/connector-query';
import type { ConnectorTarget, ConnectorQueryResult } from '@/lib/connector-exec';
import type { DataDomain } from '@/lib/data-domains';
import { resolveDomain } from '@/lib/data-domains';
import { listDomains } from '@/lib/data-domains-store';
import { listConnectors, type Connector } from '@/lib/store';
import type { BankCrossSellSourceSnapshot } from '@/lib/bank-cross-sell-opportunity';

export type BankCrossSellContextFailure =
  'missing-domain' | 'missing-connector' | 'source-unavailable' | 'source-empty';

export class BankCrossSellContextUnavailableError extends Error {
  constructor(
    readonly code: BankCrossSellContextFailure,
    readonly source: 'customer data' | 'pricing rate card',
  ) {
    super(`${source} is ${code.replaceAll('-', ' ')}`);
    this.name = 'BankCrossSellContextUnavailableError';
  }
}

interface DomainRead {
  result: ConnectorQueryResult | null;
}

export interface BankCrossSellContextSources {
  listDomains(orgId: string): Promise<DataDomain[]>;
  listConnectors(orgId: string): Promise<Connector[]>;
  query(domain: DataDomain, connector: ConnectorTarget): Promise<DomainRead>;
  now(): Date;
}

const defaultSources: BankCrossSellContextSources = {
  listDomains,
  listConnectors,
  query: (domain, connector) => queryDomain(domain, connector),
  now: () => new Date(),
};

function binding(
  source: 'customer data' | 'pricing rate card',
  domains: DataDomain[],
  connectors: Connector[],
): { domain: DataDomain; connector: Connector } {
  const domain = resolveDomain(source, domains);
  if (!domain) throw new BankCrossSellContextUnavailableError('missing-domain', source);
  const connector = connectors.find((candidate) => candidate.id === domain.connectorId);
  if (!connector?.endpoint) {
    throw new BankCrossSellContextUnavailableError('missing-connector', source);
  }
  return { domain, connector };
}

async function liveRead(
  source: 'customer data' | 'pricing rate card',
  domain: DataDomain,
  connector: Connector,
  sources: BankCrossSellContextSources,
): Promise<Record<string, unknown>[]> {
  const read = await sources.query(domain, connector).catch(() => ({ result: null }));
  if (!read.result) throw new BankCrossSellContextUnavailableError('source-unavailable', source);
  if (read.result.rows.length === 0) {
    throw new BankCrossSellContextUnavailableError('source-empty', source);
  }
  return read.result.rows;
}

/** Resolve and read both required domains inside the active tenant; either failure stops the journey. */
export async function loadBankCrossSellContext(
  orgId: string,
  sources: BankCrossSellContextSources = defaultSources,
): Promise<BankCrossSellSourceSnapshot> {
  const [domains, connectors] = await Promise.all([
    sources.listDomains(orgId),
    sources.listConnectors(orgId),
  ]);
  const tenantDomains = domains.filter((domain) => domain.orgId === orgId);
  const customer = binding('customer data', tenantDomains, connectors);
  const eligibility = binding('pricing rate card', tenantDomains, connectors);
  const [customerRows, eligibilityRows] = await Promise.all([
    liveRead('customer data', customer.domain, customer.connector, sources),
    liveRead('pricing rate card', eligibility.domain, eligibility.connector, sources),
  ]);
  return {
    customerDomain: customer.domain.label,
    eligibilityDomain: eligibility.domain.label,
    customerResource: customer.domain.resource,
    eligibilityResource: eligibility.domain.resource,
    readAt: sources.now().toISOString(),
    customerRows,
    eligibilityRows,
  };
}
