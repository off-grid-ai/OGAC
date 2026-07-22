import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONNECTOR_TYPES,
  CONNECTOR_CATEGORIES,
  getConnectorType,
  connectorCatalogByCategory,
  liveQueryableTypes,
  filterConnectorCatalog,
  isBlankEndpoint,
  isAddable,
  toStoredAuth,
  buildAddPayload,
  type AuthKind,
} from '../src/lib/connector-catalog.ts';
// The live-query dialect detector — the SOURCE OF TRUTH for which types can actually read rows.
// The catalog's `liveQuery` flag must agree with it, so the tests exercise the real function
// (no mocks) against every catalog entry.
import { detectDialect } from '../src/lib/connector-exec.ts';

// PURE unit tests for the curated data-connector catalog + add-payload builder (Task #127). No I/O.
// Grounded in the real, common connector types + what connector-exec.ts can represent.

test('catalog is a non-trivial, curated set (~15-20 real types)', () => {
  assert.ok(CONNECTOR_TYPES.length >= 15, `expected >=15 types, got ${CONNECTOR_TYPES.length}`);
  assert.ok(CONNECTOR_TYPES.length <= 25, `expected <=25 types, got ${CONNECTOR_TYPES.length}`);
});

test('every type carries the full required metadata', () => {
  for (const t of CONNECTOR_TYPES) {
    assert.ok(t.id, 'id');
    assert.ok(t.name, `name for ${t.id}`);
    assert.ok(CONNECTOR_CATEGORIES.includes(t.category), `valid category for ${t.id}`);
    assert.ok(t.connectorType, `connectorType for ${t.id}`);
    assert.ok(t.description.length > 20, `description for ${t.id}`);
    assert.ok(t.endpointHint.length > 0, `endpointHint for ${t.id}`);
    assert.equal(typeof t.liveQuery, 'boolean', `liveQuery for ${t.id}`);
    assert.ok(Array.isArray(t.fields) && t.fields.length > 0, `fields for ${t.id}`);
    for (const f of t.fields) {
      assert.ok(f.key, `field key for ${t.id}`);
      assert.ok(f.label, `field label for ${t.id}`);
      assert.equal(typeof f.required, 'boolean', `field required for ${t.id}`);
    }
    const validAuth: AuthKind[] = ['none', 'password', 'api-key', 'oauth', 's3-keys'];
    assert.ok(validAuth.includes(t.authKind), `valid authKind for ${t.id}`);
  }
});

test('ids are unique', () => {
  const ids = CONNECTOR_TYPES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate connector id');
});

test('grounded: the real seeded connector types are present', () => {
  // From deploy/onprem/data-sources.yml: postgres, mysql, mssql, rest, s3, kafka.
  for (const id of ['postgres', 'mysql', 'mssql', 'rest', 's3', 'kafka']) {
    assert.ok(getConnectorType(id), `missing seeded type ${id}`);
  }
});

test('grounded: the common enterprise sources are present', () => {
  for (const id of [
    'oracle',
    'sqlite',
    'snowflake',
    'bigquery',
    'databricks',
    'mongodb',
    'redis',
    'elasticsearch',
    'salesforce',
    'gsheets',
    'minio',
  ]) {
    assert.ok(getConnectorType(id), `missing type ${id}`);
  }
});

test('connectorCatalogByCategory groups in canonical order, drops empties, loses no type', () => {
  const groups = connectorCatalogByCategory();
  const order = groups.map((g) => g.category);
  const canonicalIdx = order.map((c) => CONNECTOR_CATEGORIES.indexOf(c));
  for (let i = 1; i < canonicalIdx.length; i++) {
    assert.ok(canonicalIdx[i] > canonicalIdx[i - 1], 'categories out of canonical order');
  }
  for (const g of groups) assert.ok(g.types.length > 0, `empty group ${g.category}`);
  const flat = groups.flatMap((g) => g.types.map((t) => t.id)).sort();
  const all = CONNECTOR_TYPES.map((t) => t.id).sort();
  assert.deepEqual(flat, all, 'grouping lost or duplicated a type');
});

test('HONESTY: every liveQuery claim names a real dialect or dedicated governed adapter', () => {
  // For each type, build a representative endpoint from its hint and check the catalog's liveQuery
  // flag matches whether detectDialect resolves a live dialect. This ties the catalog to the REAL
  // exec layer, so a type can never claim to live-query when the backend can't.
  for (const t of CONNECTOR_TYPES) {
    const dialect = detectDialect(t.connectorType, t.endpointHint);
    const canLiveQuery = dialect !== null || t.queryAdapter === 'governed-kafka-source';
    assert.equal(
      t.liveQuery,
      canLiveQuery,
      `${t.id}: liveQuery=${t.liveQuery}, dialect=${dialect}, adapter=${t.queryAdapter ?? 'none'}`,
    );
  }
});

test('HONESTY: only sources with a canonical runtime path are live-queryable', () => {
  const live = liveQueryableTypes()
    .map((t) => t.id)
    .sort();
  assert.deepEqual(
    live,
    ['gsheets', 'kafka', 'mysql', 'mssql', 'postgres', 'rest', 'salesforce'].sort(),
    'live-queryable set must be exactly the SQL/REST dialects plus governed Kafka',
  );
  // Explicitly metadata-only.
  for (const id of [
    'snowflake',
    'bigquery',
    'databricks',
    's3',
    'minio',
    'mongodb',
    'redis',
    'elasticsearch',
    'oracle',
    'sqlite',
  ]) {
    assert.equal(getConnectorType(id)!.liveQuery, false, `${id} must be metadata-only`);
  }
  assert.equal(getConnectorType('kafka')!.queryAdapter, 'governed-kafka-source');
});

test('Kafka cannot silently fall back to the generic connector-exec dialect path', () => {
  const kafka = getConnectorType('kafka')!;
  assert.equal(detectDialect(kafka.connectorType, kafka.endpointHint), null);
  assert.equal(kafka.liveQuery, true);
  assert.equal(kafka.queryAdapter, 'governed-kafka-source');
});

test('filterConnectorCatalog: empty query + null category returns the full set', () => {
  const all = filterConnectorCatalog(CONNECTOR_TYPES, '', null);
  assert.equal(all.length, CONNECTOR_TYPES.length);
});

test('filterConnectorCatalog: text query matches name / type / description', () => {
  assert.ok(
    filterConnectorCatalog(CONNECTOR_TYPES, 'postgres', null).some((t) => t.id === 'postgres'),
  );
  assert.ok(
    filterConnectorCatalog(CONNECTOR_TYPES, 'warehouse', null).some((t) => t.id === 'snowflake'),
  );
  // 'kafka' in description of the kafka entry.
  assert.ok(
    filterConnectorCatalog(CONNECTOR_TYPES, 'redpanda', null).some((t) => t.id === 'kafka'),
  );
  assert.equal(filterConnectorCatalog(CONNECTOR_TYPES, 'zzznotathing', null).length, 0);
});

test('filterConnectorCatalog: category filter narrows to that category and ANDs with the query', () => {
  const rel = filterConnectorCatalog(CONNECTOR_TYPES, '', 'Relational DB');
  assert.ok(rel.length > 0);
  assert.ok(rel.every((t) => t.category === 'Relational DB'));
  // Query for 'sql' within Relational DB — mssql, mysql, sqlite match.
  const relSql = filterConnectorCatalog(CONNECTOR_TYPES, 'sql', 'Relational DB');
  assert.ok(relSql.every((t) => t.category === 'Relational DB'));
  // A category that excludes the match yields nothing.
  assert.equal(filterConnectorCatalog(CONNECTOR_TYPES, 'postgres', 'Warehouse').length, 0);
});

test('isBlankEndpoint detects empty / whitespace / missing', () => {
  assert.equal(isBlankEndpoint(''), true);
  assert.equal(isBlankEndpoint('   '), true);
  assert.equal(isBlankEndpoint(undefined), true);
  assert.equal(isBlankEndpoint(null), true);
  assert.equal(isBlankEndpoint('postgres://x'), false);
});

test('isAddable requires a name AND a real operator-supplied endpoint', () => {
  const pg = getConnectorType('postgres')!;
  assert.equal(
    isAddable(pg, { name: '', endpoint: 'postgres://x' }),
    false,
    'no name → not addable',
  );
  assert.equal(
    isAddable(pg, { name: 'Core bank', endpoint: '' }),
    false,
    'no endpoint → not addable',
  );
  assert.equal(isAddable(pg, { name: 'Core bank', endpoint: '   ' }), false, 'blank endpoint');
  assert.equal(isAddable(pg, { name: 'Core bank', endpoint: 'postgres://host/db' }), true);
  assert.equal(isAddable(null, { name: 'x', endpoint: 'y' }), false, 'no type → not addable');
});

test('toStoredAuth narrows data-plane auth kinds to a route-accepted value', () => {
  assert.equal(toStoredAuth('none'), 'none');
  assert.equal(toStoredAuth('api-key'), 'api-key');
  assert.equal(toStoredAuth('oauth'), 'oauth');
  // password + s3-keys → api-key (a credential is carried, route accepts none|api-key|oauth).
  assert.equal(toStoredAuth('password'), 'api-key');
  assert.equal(toStoredAuth('s3-keys'), 'api-key');
});

test('buildAddPayload yields exactly the connector-create body with a route-valid auth + posture marker', () => {
  const pg = getConnectorType('postgres')!;
  const payload = buildAddPayload(pg, { name: '  Core bank  ', endpoint: '  postgres://h/db  ' });
  assert.equal(payload.name, 'Core bank', 'name trimmed');
  assert.equal(payload.type, 'postgres', 'stores the catalog connectorType');
  assert.equal(payload.endpoint, 'postgres://h/db', 'endpoint trimmed');
  assert.ok(['none', 'api-key', 'oauth'].includes(payload.auth), 'auth is route-accepted');
  assert.equal(payload.auth, 'api-key', 'password kind → api-key');
  assert.ok(payload.description.startsWith('[live-query]'), 'live type gets the live-query marker');
});

test('buildAddPayload marks metadata-only types honestly', () => {
  const snow = getConnectorType('snowflake')!;
  const payload = buildAddPayload(snow, { name: 'Warehouse', endpoint: 'snowflake://acct/db' });
  assert.ok(payload.description.startsWith('[metadata-only]'), 'metadata-only marker prefixed');
  assert.equal(payload.type, 'snowflake');
});

test('every buildAddPayload output uses a route-accepted auth value (contract with the create route)', () => {
  for (const t of CONNECTOR_TYPES) {
    const payload = buildAddPayload(t, { name: t.name, endpoint: t.endpointHint });
    assert.ok(
      ['none', 'api-key', 'oauth'].includes(payload.auth),
      `${t.id} produced non-route auth "${payload.auth}"`,
    );
    // A payload built from the hint + name should be addable.
    assert.equal(isAddable(t, { name: t.name, endpoint: t.endpointHint }), true, `${t.id} addable`);
  }
});
