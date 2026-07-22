import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { queryDomain } from '@/lib/adapters/connector-query';
import {
  BankCrossSellContextUnavailableError,
  loadBankCrossSellContext,
  type BankCrossSellContextSources,
} from '@/lib/adapters/bank-cross-sell-context';
import type { DataDomain } from '@/lib/data-domains';

const DOMAINS: DataDomain[] = [
  {
    id: 'dom_customer',
    orgId: 'org_bank',
    label: 'customer data',
    aliases: [],
    connectorId: 'crm',
    resource: 'accounts',
  },
  {
    id: 'dom_rates',
    orgId: 'org_bank',
    label: 'pricing rate card',
    aliases: [],
    connectorId: 'rates',
    resource: 'pricing_rate_card',
  },
];

test('reads both tenant bindings through the real connector-query adapter', async (t) => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/accounts') return res.end(JSON.stringify([{ id: 1, name: 'Alpha Ltd' }]));
    if (req.url === '/pricing_rate_card')
      return res.end(JSON.stringify([{ scheme_type: 'Group Term', min_group_size: 10 }]));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const sources: BankCrossSellContextSources = {
    listDomains: async () => [...DOMAINS, { ...DOMAINS[0], id: 'foreign', orgId: 'org_other' }],
    listConnectors: async () => [
      {
        id: 'crm',
        name: 'CRM',
        type: 'rest',
        status: 'connected',
        lastSync: null,
        endpoint,
        auth: 'none',
        description: '',
        custom: false,
      },
      {
        id: 'rates',
        name: 'Rates',
        type: 'rest',
        status: 'connected',
        lastSync: null,
        endpoint,
        auth: 'none',
        description: '',
        custom: false,
      },
    ],
    query: (domain, connector) => queryDomain(domain, connector),
    now: () => new Date('2026-07-23T01:00:00.000Z'),
  };
  const snapshot = await loadBankCrossSellContext('org_bank', sources);
  assert.equal(snapshot.customerRows[0].name, 'Alpha Ltd');
  assert.equal(snapshot.eligibilityRows[0].scheme_type, 'Group Term');
  assert.equal(snapshot.readAt, '2026-07-23T01:00:00.000Z');
});

test('fails closed when either required live source is empty', async () => {
  const sources: BankCrossSellContextSources = {
    listDomains: async () => DOMAINS,
    listConnectors: async () => [
      {
        id: 'crm',
        name: 'CRM',
        type: 'rest',
        status: 'connected',
        lastSync: null,
        endpoint: 'http://crm.internal',
        auth: 'none',
        description: '',
        custom: false,
      },
      {
        id: 'rates',
        name: 'Rates',
        type: 'rest',
        status: 'connected',
        lastSync: null,
        endpoint: 'http://rates.internal',
        auth: 'none',
        description: '',
        custom: false,
      },
    ],
    query: async (domain) => ({
      result: { rows: domain.id === 'dom_rates' ? [] : [{ id: 1 }], count: 0, dialect: 'rest' },
    }),
    now: () => new Date(),
  };
  await assert.rejects(
    loadBankCrossSellContext('org_bank', sources),
    (error) =>
      error instanceof BankCrossSellContextUnavailableError &&
      error.code === 'source-empty' &&
      error.source === 'pricing rate card',
  );
});
