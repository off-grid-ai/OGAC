import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideEmbed } from '../src/lib/superset-provision.ts';

// Measured on the deployed Superset 2026-08-04: the dashboard EXISTS (id 1, "Off Grid AI — Gateway
// Overview") with NO embedded registration, so the configured embed UUID matched nothing. That rendered
// the same "not provisioned" CTA as a genuinely absent dashboard — and provisioning from the console
// cannot fix it, because registering a dashboard for embedding is a Superset admin action. A CTA that
// cannot succeed is worse than no CTA.

test('a dashboard that exists but is not embed-registered says so', () => {
  const d = decideEmbed({
    configured: true,
    embedUuid: '8cf450b7-3b71-47e8-8c2b-f86bc2a62b45',
    dashboardExists: false,
    dashboardFoundByTitle: true,
  });
  assert.equal(d.state, 'not-provisioned');
  assert.equal(d.reason, 'dashboard-exists-not-embed-registered');
});

test('a genuinely absent dashboard keeps the original reason', () => {
  const d = decideEmbed({ configured: true, embedUuid: 'x', dashboardExists: false, dashboardFoundByTitle: false });
  assert.equal(d.reason, 'dashboard-uuid-not-found');
});

test('an unrun probe is not treated as "exists but unregistered"', () => {
  // dashboardFoundByTitle undefined ⇒ we do not know, so do not claim the more specific cause.
  const d = decideEmbed({ configured: true, embedUuid: 'x', dashboardExists: undefined });
  assert.equal(d.reason, 'dashboard-uuid-not-found');
});

test('a matching embed UUID is ready, and the new input cannot break that', () => {
  for (const found of [true, false, undefined]) {
    const d = decideEmbed({ configured: true, embedUuid: 'x', dashboardExists: true, dashboardFoundByTitle: found });
    assert.equal(d.state, 'ready', `dashboardFoundByTitle=${found} must not affect a ready decision`);
  }
});

test('missing config still short-circuits before any dashboard reasoning', () => {
  assert.equal(decideEmbed({ configured: false, dashboardFoundByTitle: true }).state, 'not-configured');
  assert.equal(decideEmbed({ configured: true, embedUuid: '', dashboardFoundByTitle: true }).state, 'not-configured');
});
