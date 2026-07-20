import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyGatewayRedirect } from '../src/modules/runtime-routes.ts';

test('legacy model tabs resolve to durable model destinations', () => {
  assert.equal(legacyGatewayRedirect({}), '/runtime/models/overview');
  assert.equal(legacyGatewayRedirect({ tab: 'router' }), '/runtime/models/routing');
  assert.equal(legacyGatewayRedirect({ tab: 'control' }), '/runtime/models/fleet-control');
  assert.equal(legacyGatewayRedirect({ tab: 'not-real' }), '/runtime/models/overview');
});

test('keys, observed clients, and settings resolve to their canonical owners', () => {
  assert.equal(legacyGatewayRedirect({ tab: 'keys' }), '/runtime/api-budgets/keys');
  assert.equal(legacyGatewayRedirect({ tab: 'tokens' }), '/runtime/api-budgets/clients');
  assert.equal(legacyGatewayRedirect({ tab: 'settings' }), '/operations/configuration');
});

test('legacy local panel state survives while tab state is removed', () => {
  assert.equal(
    legacyGatewayRedirect({
      tab: ['control', 'traffic'],
      panel: 'configure-node',
      node: 'fleet head',
      compare: ['g1', 'g2'],
    }),
    '/runtime/models/fleet-control?panel=configure-node&node=fleet+head&compare=g1&compare=g2',
  );
});
