import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gatewayAttribution } from '@/lib/gateway';

// The aggregator stamps these headers onto the offgrid-gateway observability doc, and the console's
// Insights surfaces filter that index by `term: { org }` for TENANT ISOLATION. So a call that omits
// the org lands as a doc those surfaces can never show (G-GATEWAY-INDEX-ORG). PURE — no I/O.

test('stamps both org and user when supplied', () => {
  assert.deepEqual(gatewayAttribution({ orgId: 'org_bharat', userId: 'rm@bank.test' }), {
    'x-offgrid-org': 'org_bharat',
    'x-offgrid-user': 'rm@bank.test',
  });
});

test('DROPS blank/whitespace/missing values instead of sending empty attribution', () => {
  // An empty header would attribute the call to org "" — worse than honestly unattributed.
  assert.deepEqual(gatewayAttribution({ orgId: '', userId: '   ' }), {});
  assert.deepEqual(gatewayAttribution({}), {});
  assert.deepEqual(gatewayAttribution(), {});
  assert.deepEqual(gatewayAttribution({ orgId: null, userId: null }), {});
});

test('trims surrounding whitespace so the aggregator stores a clean term value', () => {
  assert.deepEqual(gatewayAttribution({ orgId: '  org_suraksha  ' }), {
    'x-offgrid-org': 'org_suraksha',
  });
});

test('either half can stand alone (a system run may have an org but no user)', () => {
  assert.deepEqual(gatewayAttribution({ orgId: 'default' }), { 'x-offgrid-org': 'default' });
  assert.deepEqual(gatewayAttribution({ userId: 'ops@x' }), { 'x-offgrid-user': 'ops@x' });
});
