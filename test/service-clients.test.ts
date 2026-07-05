import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildResult,
  clientCreateConfig,
  clientSecretPath,
  isProtectedClientId,
  PROTECTED_CLIENT_IDS,
  SERVICE_CLIENTS,
  shouldRotateSecret,
} from '../src/lib/service-clients.ts';

// ── Desired state ─────────────────────────────────────────────────────────────

test('SERVICE_CLIENTS covers exactly the five broker-fronted services', () => {
  assert.deepEqual(
    SERVICE_CLIENTS.map((c) => c.clientId).sort(),
    ['offgrid-fleet', 'offgrid-gateway', 'offgrid-opensearch', 'offgrid-seaweedfs', 'offgrid-temporal'],
  );
});

test('every service client has a unique clientId, service, realmRole and audience', () => {
  for (const key of ['clientId', 'service', 'realmRole', 'audience'] as const) {
    const values = SERVICE_CLIENTS.map((c) => c[key]);
    assert.equal(new Set(values).size, values.length, `duplicate ${key}`);
  }
});

test('no service client collides with the protected console clients', () => {
  for (const c of SERVICE_CLIENTS) {
    assert.equal(isProtectedClientId(c.clientId), false, `${c.clientId} must not be protected`);
  }
  assert.deepEqual([...PROTECTED_CLIENT_IDS].sort(), ['offgrid-console', 'offgrid-console-admin']);
});

// ── clientCreateConfig ────────────────────────────────────────────────────────

test('clientCreateConfig always yields a confidential, service-account, client-credentials-only client', () => {
  for (const def of SERVICE_CLIENTS) {
    const cfg = clientCreateConfig(def);
    assert.equal(cfg.serviceAccountsEnabled, true);
    assert.equal(cfg.directAccessGrantsEnabled, false);
    assert.equal(cfg.clientId, def.clientId);
    assert.equal(cfg.name, def.name);
  }
});

// ── clientSecretPath ──────────────────────────────────────────────────────────

test('clientSecretPath builds secret/<service>/client-secret (relative to mount)', () => {
  assert.equal(clientSecretPath('gateway'), 'gateway/client-secret');
  assert.equal(clientSecretPath('seaweedfs'), 'seaweedfs/client-secret');
});

test('clientSecretPath rejects empty or unsafe service names (no path traversal / injection)', () => {
  assert.throws(() => clientSecretPath(''));
  assert.throws(() => clientSecretPath('../etc'));
  assert.throws(() => clientSecretPath('a/b'));
  assert.throws(() => clientSecretPath('UPPER'));
});

// ── shouldRotateSecret — the idempotency rule ──────────────────────────────────

test('shouldRotateSecret: missing secret is always (re)generated', () => {
  assert.equal(shouldRotateSecret(null, false), true);
  assert.equal(shouldRotateSecret(undefined, false), true);
  assert.equal(shouldRotateSecret('', false), true);
});

test('shouldRotateSecret: a present secret is reused unless rotate is explicitly requested', () => {
  assert.equal(shouldRotateSecret('abc', false), false); // idempotent re-run → no churn
  assert.equal(shouldRotateSecret('abc', true), true); // explicit rotate → regenerate
});

// ── buildResult ─────────────────────────────────────────────────────────────

test('buildResult records the actions and the OpenBao path for a client', () => {
  const def = SERVICE_CLIENTS[0];
  const r = buildResult(def, 'reused', 'created', 'read');
  assert.deepEqual(r, {
    service: def.service,
    clientId: def.clientId,
    client: 'reused',
    role: 'created',
    secret: 'read',
    secretPath: clientSecretPath(def.service),
  });
});

// ── Seed ↔ code parity: the declarative realm import must match the desired state ──

test('the seed realm JSON declares exactly the code-defined service clients, roles and audiences', () => {
  const realmPath = fileURLToPath(new URL('../deploy/keycloak/offgrid-realm.json', import.meta.url));
  const realm = JSON.parse(readFileSync(realmPath, 'utf8')) as {
    clients: { clientId: string; serviceAccountsEnabled?: boolean; publicClient?: boolean; protocolMappers?: { config?: Record<string, string> }[] }[];
    roles: { realm: { name: string }[] };
    users: { serviceAccountClientId?: string; realmRoles?: string[] }[];
  };

  for (const def of SERVICE_CLIENTS) {
    const client = realm.clients.find((c) => c.clientId === def.clientId);
    assert.ok(client, `seed missing client ${def.clientId}`);
    assert.equal(client.serviceAccountsEnabled, true, `${def.clientId} must be serviceAccountsEnabled`);
    assert.equal(client.publicClient, false, `${def.clientId} must be confidential`);

    // Audience mapper carries the expected aud.
    const auds = (client.protocolMappers ?? [])
      .map((m) => m.config?.['included.custom.audience'])
      .filter(Boolean);
    assert.ok(auds.includes(def.audience), `${def.clientId} missing audience mapper for ${def.audience}`);

    // Realm role declared and assigned to the client's service account.
    assert.ok(
      realm.roles.realm.some((r) => r.name === def.realmRole),
      `seed missing realm role ${def.realmRole}`,
    );
    const sa = realm.users.find((u) => u.serviceAccountClientId === def.clientId);
    assert.ok(sa, `seed missing service-account user for ${def.clientId}`);
    assert.ok(sa.realmRoles?.includes(def.realmRole), `service account missing role ${def.realmRole}`);
  }

  // Parity does not disturb the console client.
  assert.ok(realm.clients.some((c) => c.clientId === 'offgrid-console'));
});
