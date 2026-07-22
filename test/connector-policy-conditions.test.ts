// CONDITION-COVERAGE tests for connector-policy.ts — hit every arm of the SQL/REST validation
// guards, the endpoint-builder ternaries, the create-gate branches, and spliceCredential's catch +
// early-return arms. Additive; imports existing exports only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSqlEndpoint,
  connectorSecretKey,
  connectorTypeDef,
  isCreatableType,
  spliceCredential,
  validateConnectorCreate,
} from '@/lib/connector-policy';

// ─── connectorTypeDef / isCreatableType — hit + miss + case-fold + nullish ─────────────────────────

test('connectorTypeDef: case-insensitive match on a ready type', () => {
  assert.equal(connectorTypeDef('POSTGRES')?.type, 'postgres');
});

test('connectorTypeDef: null/unknown → null (nullish `?? ""` + not-found arm)', () => {
  // @ts-expect-error runtime nullish coercion
  assert.equal(connectorTypeDef(null), null);
  assert.equal(connectorTypeDef('does-not-exist'), null);
});

test('isCreatableType: ready true, coming-soon false, unknown false', () => {
  assert.equal(isCreatableType('rest'), true);
  assert.equal(isCreatableType('snowflake'), false); // coming-soon
  assert.equal(isCreatableType('nope'), false); // unknown → optional-chain undefined !== ready
});

// ─── buildSqlEndpoint — user present/absent, port present/absent, db present/absent arms ───────────

const PG = connectorTypeDef('postgres')!;

test('buildSqlEndpoint: full authority (user + explicit port + db)', () => {
  const ep = buildSqlEndpoint(PG, { host: 'db.local', port: 6543, database: 'core', user: 'app' });
  assert.equal(ep, 'postgres://app@db.local:6543/core');
});

test('buildSqlEndpoint: no user → bare host authority (user-ternary else arm)', () => {
  const ep = buildSqlEndpoint(PG, { host: 'db.local', port: 5432, database: 'core', user: '' });
  assert.equal(ep, 'postgres://db.local:5432/core');
});

test('buildSqlEndpoint: null port falls back to def.defaultPort (?? chain)', () => {
  const ep = buildSqlEndpoint(PG, { host: 'db.local', port: null, database: 'core', user: 'app' });
  assert.equal(ep, 'postgres://app@db.local:5432/core');
});

test('buildSqlEndpoint: no port at all (def has none) → hostPort skips the :port arm', () => {
  const REST = connectorTypeDef('rest')!; // rest def has no defaultPort
  const ep = buildSqlEndpoint(REST, { host: 'h', port: null, database: 'd', user: 'u' });
  assert.equal(ep, 'https://u@h/d'); // no ":port" segment
});

test('buildSqlEndpoint: empty database → no path segment (path-ternary else arm)', () => {
  const ep = buildSqlEndpoint(PG, { host: 'db.local', port: 5432, database: '', user: 'app' });
  assert.equal(ep, 'postgres://app@db.local:5432');
});

test('buildSqlEndpoint: percent-encodes an "@" in the username', () => {
  const ep = buildSqlEndpoint(PG, { host: 'h', port: 5432, database: 'd', user: 'a@b' });
  assert.match(ep, /a%40b@h/);
});

// ─── validateConnectorCreate — SQL: every required-field error arm ─────────────────────────────────

test('validate SQL: fully valid → ok, credential-free endpoint, secret carried', () => {
  const v = validateConnectorCreate({
    name: 'Core bank',
    type: 'postgres',
    host: 'db.local',
    port: '5432',
    database: 'core',
    user: 'app',
    password: 's3cret',
    description: 'primary',
  });
  assert.equal(v.ok, true);
  assert.equal(v.value?.secret, 's3cret');
  assert.ok(!v.value?.endpoint.includes('s3cret')); // password NEVER in the endpoint
  assert.equal(v.value?.auth, 'api-key');
});

test('validate SQL: bad port → range error; missing host/db/user/password all reported', () => {
  const v = validateConnectorCreate({
    name: 'x',
    type: 'mysql',
    port: '70000', // out of range
    host: '',
    database: '',
    user: '',
    password: '',
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /Port must be/.test(e)));
  assert.ok(v.errors.some((e) => /host is required/.test(e)));
  assert.ok(v.errors.some((e) => /database name is required/.test(e)));
  assert.ok(v.errors.some((e) => /username is required/.test(e)));
  assert.ok(v.errors.some((e) => /password is required/.test(e)));
});

test('validate SQL: non-integer port is rejected (Number.isInteger arm)', () => {
  const v = validateConnectorCreate({
    name: 'x', type: 'postgres', host: 'h', database: 'd', user: 'u', password: 'p', port: '12.5',
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /Port must be/.test(e)));
});

test('validate SQL: invalid host characters rejected (HOST_RE else arm)', () => {
  const v = validateConnectorCreate({
    name: 'x', type: 'postgres', host: 'bad host!', database: 'd', user: 'u', password: 'p',
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /invalid characters/.test(e)));
});

test('validate SQL: valid but no port supplied → default port used (portRaw falsy arm)', () => {
  const v = validateConnectorCreate({
    name: 'x', type: 'postgres', host: 'h', database: 'd', user: 'u', password: 'p',
  });
  assert.equal(v.ok, true);
  assert.match(v.value!.endpoint, /:5432\//);
});

// ─── validateConnectorCreate — REST arms ───────────────────────────────────────────────────────────

test('validate REST: valid https base URL + api key → auth api-key, endpoint trailing slash stripped', () => {
  const v = validateConnectorCreate({
    name: 'API', type: 'rest', baseUrl: 'https://api.example.com/', apiKey: 'tok_123',
  });
  assert.equal(v.ok, true);
  assert.equal(v.value?.endpoint, 'https://api.example.com'); // trailing slash removed
  assert.equal(v.value?.auth, 'api-key');
  assert.equal(v.value?.secret, 'tok_123');
});

test('validate REST: no api key → auth none, secret null (apiKey || null arm)', () => {
  const v = validateConnectorCreate({ name: 'API', type: 'rest', baseUrl: 'https://api.example.com' });
  assert.equal(v.ok, true);
  assert.equal(v.value?.auth, 'none');
  assert.equal(v.value?.secret, null);
});

test('validate REST: missing base URL → required error (the if-arm, not the else)', () => {
  const v = validateConnectorCreate({ name: 'API', type: 'rest', baseUrl: '' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /base URL is required/i.test(e)));
});

test('validate REST: malformed URL → parse error (catch arm)', () => {
  const v = validateConnectorCreate({ name: 'API', type: 'rest', baseUrl: 'not a url' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /valid URL/i.test(e)));
});

test('validate REST: non-http(s) protocol → rejected (protocol-guard arm)', () => {
  const v = validateConnectorCreate({ name: 'API', type: 'rest', baseUrl: 'ftp://host/path' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /http:\/\/ or https/i.test(e)));
});

// ─── validateConnectorCreate — the create-gate branches ────────────────────────────────────────────

test('validate: unknown type → single error, no value', () => {
  const v = validateConnectorCreate({ name: 'x', type: 'mongodb' });
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, ['Unknown connector type.']);
});

test('validate: coming-soon type → not-available error (status !== ready arm)', () => {
  const v = validateConnectorCreate({ name: 'x', type: 'snowflake', host: 'h' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /not available yet/.test(e)));
});

test('validate: missing name prepends a name error onto the type-specific ones (!name arm)', () => {
  const v = validateConnectorCreate({ name: '', type: 'postgres', host: 'h', database: 'd', user: 'u', password: 'p' });
  assert.equal(v.ok, false);
  assert.equal(v.errors[0], 'A connector name is required.');
});

// ─── connectorSecretKey ────────────────────────────────────────────────────────────────────────────

test('connectorSecretKey: canonical per-connector key path', () => {
  assert.equal(connectorSecretKey('c_42', 'default'), 'connectors/c_42/credential');
});

// ─── spliceCredential — sql splice, already-has-creds, non-sql skip, unknown type, catch arm ───────

test('splice: sql endpoint gets the password spliced into the authority', () => {
  const out = spliceCredential('postgres', 'postgres://app@db.local:5432/core', 'pw');
  assert.match(out, /app:pw@db\.local/);
});

test('splice: an endpoint that ALREADY carries a password is left untouched (u.password arm)', () => {
  const ep = 'postgres://app:existing@db.local:5432/core';
  assert.equal(spliceCredential('postgres', ep, 'newpw'), ep);
});

test('splice: a REST (non-sql) type returns the endpoint unchanged (family !== sql arm)', () => {
  assert.equal(spliceCredential('rest', 'https://api.example.com', 'tok'), 'https://api.example.com');
});

test('splice: an unknown type returns the endpoint unchanged (!def arm)', () => {
  assert.equal(spliceCredential('nope', 'postgres://h/d', 'pw'), 'postgres://h/d');
});

test('splice: a malformed endpoint URL falls through the catch and returns as-is', () => {
  assert.equal(spliceCredential('postgres', 'not a url', 'pw'), 'not a url');
});
