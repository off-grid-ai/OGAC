import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatAliases,
  parseAliases,
  validateDomainForm,
} from '../src/lib/data-domains-ui.ts';
import { proposeStarterDomains, type SeedConnector } from '../src/lib/data-domains-seed.ts';
import { resolveDomain, type DataDomain } from '../src/lib/data-domains.ts';

// PURE unit tests for the data-domains management surface: alias parsing, form validation, and the
// starter-rule proposer. These are the input side of the connector rule engine — turning operator
// keystrokes into valid, unambiguous bindings — and (crucially) proving the proposer NEVER invents
// a connector that isn't there.

// ─── parseAliases ────────────────────────────────────────────────────────────────
test('parseAliases splits on commas and newlines, trims, drops empties', () => {
  assert.deepEqual(parseAliases('customers, accounts\ncontacts ,, '), [
    'customers',
    'accounts',
    'contacts',
  ]);
});

test('parseAliases de-dupes case-insensitively, keeping the first spelling', () => {
  assert.deepEqual(parseAliases('Accounts, accounts, ACCOUNTS'), ['Accounts']);
});

test('parseAliases on empty / whitespace yields []', () => {
  assert.deepEqual(parseAliases('   '), []);
  assert.deepEqual(parseAliases(''), []);
});

test('formatAliases is the inverse render for editing', () => {
  assert.equal(formatAliases(['customers', 'accounts']), 'customers, accounts');
  assert.equal(formatAliases(undefined), '');
});

// ─── validateDomainForm ──────────────────────────────────────────────────────────
test('validateDomainForm rejects missing required fields with field errors', () => {
  const r = validateDomainForm({ label: '', connectorId: '', resource: '', aliasesRaw: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.label);
  assert.ok(r.errors.connectorId);
  assert.ok(r.errors.resource);
  assert.equal(r.value, undefined);
});

test('validateDomainForm trims and returns a clean, POST-ready value on success', () => {
  const r = validateDomainForm({
    label: '  customer data ',
    connectorId: ' con_sf ',
    resource: ' Account ',
    aliasesRaw: 'customers, accounts',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    label: 'customer data',
    connectorId: 'con_sf',
    resource: 'Account',
    aliases: ['customers', 'accounts'],
  });
});

test('validateDomainForm rejects an over-long label', () => {
  const r = validateDomainForm({
    label: 'x'.repeat(121),
    connectorId: 'con_sf',
    resource: 'Account',
    aliasesRaw: '',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.label);
});

// ─── proposeStarterDomains — never invent a connector ─────────────────────────────
const CONNECTORS: SeedConnector[] = [
  { id: 'con_sf', name: 'Salesforce Prod', type: 'salesforce' },
  { id: 'con_pg', name: 'Core Bank DB', type: 'postgres' },
  { id: 'con_hr', name: 'HR System', type: 'mysql' },
  { id: 'con_s3', name: 'Invoice Archive', type: 's3' },
];

test('proposeStarterDomains maps each archetype to a REAL connector by type', () => {
  const props = proposeStarterDomains(CONNECTORS);
  const byLabel = Object.fromEntries(props.map((p) => [p.label, p]));
  assert.equal(byLabel['customer data'].connectorId, 'con_sf');
  assert.equal(byLabel['transactions'].connectorId, 'con_pg');
  assert.equal(byLabel['reimbursement quota'].connectorId, 'con_hr');
  assert.equal(byLabel['invoices'].connectorId, 'con_s3');
  // every proposed connectorId is one we actually passed in — nothing invented
  const ids = new Set(CONNECTORS.map((c) => c.id));
  for (const p of props) assert.ok(ids.has(p.connectorId), `${p.connectorId} is real`);
});

test('proposeStarterDomains skips archetypes with no matching connector', () => {
  // Only a Postgres connector exists → only "transactions" can be proposed.
  const props = proposeStarterDomains([{ id: 'con_pg', name: 'DB', type: 'postgres' }]);
  const labels = props.map((p) => p.label);
  assert.deepEqual(labels, ['transactions']);
});

test('proposeStarterDomains returns [] when there are no connectors', () => {
  assert.deepEqual(proposeStarterDomains([]), []);
});

test('proposeStarterDomains excludes already-declared labels', () => {
  const props = proposeStarterDomains(CONNECTORS, ['Customer Data']);
  assert.equal(
    props.find((p) => p.label === 'customer data'),
    undefined,
  );
});

// ─── end-to-end: a proposed rule actually resolves via the pure resolver ──────────
test('a proposed starter rule resolves the phrase it was meant for', () => {
  const props = proposeStarterDomains(CONNECTORS);
  const domains: DataDomain[] = props.map((p, i) => ({
    id: `dom_${i}`,
    orgId: 'default',
    label: p.label,
    aliases: p.aliases,
    connectorId: p.connectorId,
    resource: p.resource,
  }));
  const hit = resolveDomain('check the reimbursement quota', domains);
  assert.ok(hit);
  assert.equal(hit!.connectorId, 'con_hr');
});
