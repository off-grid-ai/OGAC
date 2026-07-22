import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONNECTOR_TYPES,
  connectorTypeDef,
  isCreatableType,
  buildSqlEndpoint,
  validateConnectorCreate,
  connectorSecretKey,
  parseObjectStoreCredential,
  serializeObjectStoreCredential,
  spliceCredential,
  validateConnectorUpdate,
  validateObjectStoreCredentialPatch,
} from '../src/lib/connector-policy.ts';
// The live-query dialect detector is the SOURCE OF TRUTH for what can be queried. Every `ready`
// connector type MUST resolve to a dialect (else it's a dead connector). Exercise the real function.
import { detectDialect } from '../src/lib/connector-exec.ts';

// PURE unit tests for the connector credential seam. Zero I/O — proves the create form's contract:
// a credential-FREE endpoint is built, the secret is split out, and every creatable type is actually
// queryable. The vault write + secretRef stamping are I/O and covered by the integration test.

test('every ready query connector resolves to a real live-query dialect', () => {
  for (const def of CONNECTOR_TYPES.filter((d) => d.status === 'ready' && d.family !== 's3')) {
    // Build the endpoint the create path would store, then confirm detectDialect can query it.
    const endpoint =
      def.family === 'sql'
        ? buildSqlEndpoint(def, { host: 'h', port: def.defaultPort ?? null, database: 'db', user: 'u' })
        : 'https://api.example.com';
    assert.ok(
      detectDialect(def.type, endpoint) !== null,
      `${def.type} is marked ready but detectDialect() can't query it`,
    );
  }
});

test('coming-soon types are not creatable', () => {
  assert.equal(isCreatableType('snowflake'), false);
  assert.equal(isCreatableType('s3'), true);
  assert.equal(isCreatableType('salesforce'), false);
  assert.equal(isCreatableType('gdrive'), false);
  assert.equal(isCreatableType('kafka'), false);
  assert.equal(isCreatableType('postgres'), true);
  assert.equal(isCreatableType('rest'), true);
});

test('S3-compatible create stores a credential-free endpoint and one opaque vault keypair', () => {
  const result = validateConnectorCreate({
    name: 'Claims evidence',
    type: 's3',
    baseUrl: 'http://minio.internal:9000/',
    accessKey: 'operator',
    secretKey: 'vault-only-secret',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value?.endpoint, 'http://minio.internal:9000');
  assert.ok(!result.value?.endpoint.includes('operator'));
  assert.deepEqual(parseObjectStoreCredential(result.value?.secret ?? null), {
    accessKey: 'operator',
    secretKey: 'vault-only-secret',
  });
});

test('S3-compatible create rejects missing keys and unsafe service endpoints', () => {
  assert.equal(
    validateConnectorCreate({
      name: 'x', type: 's3', baseUrl: 'http://minio.internal:9000', accessKey: '', secretKey: '',
    }).ok,
    false,
  );
  assert.equal(
    validateConnectorCreate({
      name: 'x', type: 's3', baseUrl: 'http://169.254.169.254', accessKey: 'a', secretKey: 's',
    }).ok,
    false,
  );
});

test('S3 credential rotation is all-or-nothing and accepts blank as keep-current', () => {
  assert.deepEqual(validateObjectStoreCredentialPatch({}), { ok: true, secret: null, errors: [] });
  assert.equal(validateObjectStoreCredentialPatch({ accessKey: 'new', secretKey: '' }).ok, false);
  const rotated = validateObjectStoreCredentialPatch({ accessKey: 'new', secretKey: 'secret' });
  assert.equal(rotated.ok, true);
  assert.equal(
    rotated.secret,
    serializeObjectStoreCredential({ accessKey: 'new', secretKey: 'secret' }),
  );
});

test('S3 updates allow approved internal endpoints without weakening REST', () => {
  assert.equal(
    validateConnectorUpdate({ type: 's3', endpoint: 'http://minio.internal:9000' }).ok,
    true,
  );
  assert.equal(
    validateConnectorUpdate({ type: 'rest', endpoint: 'http://10.0.0.5:9000' }).ok,
    false,
  );
  assert.equal(
    validateConnectorUpdate({ type: 's3', endpoint: 'http://169.254.169.254/latest' }).ok,
    false,
  );
});

test('buildSqlEndpoint produces a credential-FREE URL (never the password)', () => {
  const def = connectorTypeDef('postgres')!;
  const ep = buildSqlEndpoint(def, { host: 'db.acme.co', port: 5432, database: 'corebank', user: 'reader' });
  assert.equal(ep, 'postgres://reader@db.acme.co:5432/corebank');
  assert.ok(!ep.includes(':'.concat('secret')), 'no password segment');
});

test('buildSqlEndpoint percent-encodes the username and falls back to the default port', () => {
  const def = connectorTypeDef('mysql')!;
  const ep = buildSqlEndpoint(def, { host: 'h', port: null, database: 'd', user: 'a@b' });
  assert.equal(ep, 'mysql://a%40b@h:3306/d');
});

test('validateConnectorCreate: SQL split — clean endpoint + secret out, never inlined', () => {
  const r = validateConnectorCreate({
    name: 'Core Banking',
    type: 'postgres',
    host: 'db.acme.co',
    port: '5432',
    database: 'corebank',
    user: 'reader',
    password: 'Sup3rSecret!',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value?.endpoint, 'postgres://reader@db.acme.co:5432/corebank');
  assert.ok(!r.value!.endpoint.includes('Sup3rSecret'), 'password is NOT in the endpoint');
  assert.equal(r.value?.secret, 'Sup3rSecret!');
  assert.equal(r.value?.auth, 'api-key');
});

test('validateConnectorCreate: SQL rejects missing fields with clear errors', () => {
  const r = validateConnectorCreate({ name: 'x', type: 'postgres', host: 'h' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /database/i.test(e)));
  assert.ok(r.errors.some((e) => /username/i.test(e)));
  assert.ok(r.errors.some((e) => /password/i.test(e)));
});

test('validateConnectorCreate: SQL rejects a bad port and a bad host', () => {
  const bad = validateConnectorCreate({
    name: 'x', type: 'mysql', host: 'ok', port: '99999', database: 'd', user: 'u', password: 'p',
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /port/i.test(e)));

  const badHost = validateConnectorCreate({
    name: 'x', type: 'mysql', host: 'bad host!', port: '3306', database: 'd', user: 'u', password: 'p',
  });
  assert.equal(badHost.ok, false);
  assert.ok(badHost.errors.some((e) => /host/i.test(e)));
});

test('validateConnectorCreate: REST keeps the base URL as the endpoint, api key becomes the secret', () => {
  const r = validateConnectorCreate({ name: 'CRM', type: 'rest', baseUrl: 'https://api.acme.co/v1/', apiKey: 'tok_123' });
  assert.equal(r.ok, true);
  assert.equal(r.value?.endpoint, 'https://api.acme.co/v1'); // trailing slash trimmed, no creds
  assert.equal(r.value?.secret, 'tok_123');
  assert.equal(r.value?.auth, 'api-key');
});

test('validateConnectorCreate: REST without a key is allowed (public API), auth=none', () => {
  const r = validateConnectorCreate({ name: 'Open API', type: 'rest', baseUrl: 'https://public.example.com' });
  assert.equal(r.ok, true);
  assert.equal(r.value?.secret, null);
  assert.equal(r.value?.auth, 'none');
});

test('validateConnectorCreate: REST rejects a non-URL and a non-http scheme', () => {
  assert.equal(validateConnectorCreate({ name: 'x', type: 'rest', baseUrl: 'not a url' }).ok, false);
  assert.equal(validateConnectorCreate({ name: 'x', type: 'rest', baseUrl: 'ftp://x' }).ok, false);
});

test('validateConnectorCreate: refuses a coming-soon type and an unknown type', () => {
  const soon = validateConnectorCreate({ name: 'x', type: 'snowflake' });
  assert.equal(soon.ok, false);
  assert.ok(soon.errors.some((e) => /not available/i.test(e)));
  assert.equal(validateConnectorCreate({ name: 'x', type: 'bogus' }).ok, false);
});

test('validateConnectorCreate: requires a name', () => {
  const r = validateConnectorCreate({ type: 'rest', baseUrl: 'https://x.co' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /name/i.test(e)));
});

test('connectorSecretKey is a stable, per-connector vault path', () => {
  assert.equal(connectorSecretKey('con_abc123'), 'connectors/con_abc123/credential');
});

test('spliceCredential injects the password into a SQL URL at query time (not persisted)', () => {
  const stored = 'postgres://reader@db.acme.co:5432/corebank';
  const live = spliceCredential('postgres', stored, 'Sup3rSecret!');
  assert.ok(live.includes('reader:'), 'has a user:pass authority now');
  assert.ok(live.includes('db.acme.co'));
  // The stored endpoint itself is untouched (splice returns a new string).
  assert.ok(!stored.includes('Sup3rSecret'));
});

test('spliceCredential leaves an endpoint that already has inline creds untouched (legacy seeded)', () => {
  const legacy = 'postgres://sa:oldpass@host:5432/db';
  assert.equal(spliceCredential('postgres', legacy, 'newpass'), legacy);
});

test('spliceCredential is a no-op for REST (key applied as a header, not in the URL)', () => {
  assert.equal(spliceCredential('rest', 'https://api.acme.co', 'tok'), 'https://api.acme.co');
});
