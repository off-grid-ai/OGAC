import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DATA_QUALITY_OBSERVABILITY_AUDITS,
} from '../src/lib/service-capabilities/data-quality-observability.ts';
import { CAPABILITY_GATES } from '../src/lib/service-capability-contract.ts';

const DATA_IDS = [
  'postgres',
  'qdrant',
  'marquez',
  'lancedb',
  'seaweedfs',
  'warehouse',
  'airbyte',
  'streaming',
  'data-quality',
  'kestra',
  'organizational-brain',
] as const;

const OBSERVABILITY_IDS = [
  'opensearch',
  'langfuse',
  'evidently',
  'ragas',
  'victoriametrics',
  'victorialogs',
  'otel-collector',
  'jaeger',
] as const;

const ENTERPRISE_SOURCE_IDS = [
  'enterprise-source-corebank',
  'enterprise-source-policyadmin',
  'enterprise-source-erp',
  'enterprise-source-kafka',
  'enterprise-source-minio',
  'enterprise-source-crm',
] as const;

const EXPECTED_IDS = [...DATA_IDS, ...OBSERVABILITY_IDS, ...ENTERPRISE_SOURCE_IDS];

function audit(serviceId: string) {
  const found = DATA_QUALITY_OBSERVABILITY_AUDITS.find((entry) => entry.serviceId === serviceId);
  assert.ok(found, `${serviceId} must have a capability audit`);
  return found;
}

test('the family registry owns exactly its 25 canonical logical inventory ids', () => {
  const actualIds = DATA_QUALITY_OBSERVABILITY_AUDITS.map((entry) => entry.serviceId);
  assert.equal(actualIds.length, 25);
  assert.equal(new Set(actualIds).size, actualIds.length);
  assert.deepEqual(actualIds, EXPECTED_IDS);
  assert.equal(actualIds.includes('presidio'), false, 'Presidio belongs to the governance lane');
});

test('every capability record has exact version provenance and honest four-gate evidence', () => {
  for (const record of DATA_QUALITY_OBSERVABILITY_AUDITS) {
    // The family shares a batch audit date; services re-verified live carry their own later date.
    assert.match(record.auditedAt, /^2026-\d{2}-\d{2}$/, `${record.serviceId} must carry an ISO audit date`);
    assert.ok(
      record.auditedAt >= '2026-07-20',
      `${record.serviceId} audit date must not predate the family batch audit`,
    );
    assert.ok(record.upstreamVersion.trim(), `${record.serviceId} must name the audited version`);
    assert.ok(record.versionSource.trim(), `${record.serviceId} must name its version source`);
    assert.ok(
      record.denominatorSource.trim(),
      `${record.serviceId} must name the primary capability denominator`,
    );
    assert.doesNotMatch(
      record.denominatorSource,
      /^(?:\.\.\/)?deploy\/docker-compose/,
      `${record.serviceId} denominator must not be a generic deployment file`,
    );
    assert.ok(record.summary.trim());
    assert.ok(record.items.length >= 3, `${record.serviceId} must have a meaningful denominator`);
    assert.equal(new Set(record.items.map((item) => item.id)).size, record.items.length);

    if (record.auditState === 'stale') {
      assert.ok(record.auditStateEvidence?.trim(), `${record.serviceId} must explain stale state`);
      assert.ok(
        record.items.every((item) => item.gates.upstream.status === 'no'),
        `${record.serviceId} must not count stale upstream availability`,
      );
    } else {
      assert.equal(record.auditStateEvidence, null);
    }

    for (const item of record.items) {
      assert.match(item.uiHref, /^\//, `${record.serviceId}/${item.id} needs a canonical route`);
      assert.ok(item.uiLabel.trim());
      assert.deepEqual(Object.keys(item.gates), CAPABILITY_GATES);
      for (const gate of CAPABILITY_GATES) {
        assert.match(item.gates[gate].status, /^(yes|partial|no)$/);
        assert.ok(item.gates[gate].evidence.trim(), `${record.serviceId}/${item.id}/${gate}`);
      }
      const incomplete = CAPABILITY_GATES.some((gate) => item.gates[gate].status !== 'yes');
      assert.equal(
        Boolean(item.gap.trim()),
        incomplete,
        `${record.serviceId}/${item.id} gap must match incomplete evidence`,
      );
    }
  }
});

test('migrated detailed denominators are preserved and use current canonical routes', () => {
  assert.equal(audit('evidently').items.length, 7);
  assert.equal(audit('streaming').items.length, 10);
  assert.equal(audit('otel-collector').items.length, 8);

  assert.ok(audit('evidently').items.every((item) => item.uiHref.startsWith('/solutions/quality/')));
  assert.equal(
    audit('streaming').items.find((item) => item.id === 'bfsi-stream-proof')?.gates.workflow.status,
    'yes',
  );
  assert.match(
    audit('streaming').items.find((item) => item.id === 'bfsi-stream-proof')?.gates.workflow.evidence ?? '',
    /authenticated lender and insurance Console round-trips/,
  );
  // otel-collector was re-verified live 2026-07-23 (OTLP receiver 200 on the deployed release):
  // pinned to 0.156.0 and promoted stale→current.
  assert.equal(audit('otel-collector').auditState, 'current');
  assert.equal(audit('otel-collector').auditStateEvidence, null);
  assert.match(audit('otel-collector').upstreamVersion, /0\.156\.0/);
});

test('fleet evidence distinguishes deployed health from production capability use', () => {
  const dataQuality = audit('data-quality');
  assert.match(dataQuality.upstreamVersion, /native compatibility API/);
  assert.match(dataQuality.upstreamVersion, /not installed/);
  assert.equal(
    dataQuality.items.find((item) => item.id === 'checkpoint-rules')?.gates.workflow.status,
    'yes',
  );
  assert.equal(
    dataQuality.items.find((item) => item.id === 'suite-persistence')?.gates.adapter.status,
    'no',
  );

  assert.equal(
    audit('airbyte').items.find((item) => item.id === 'sync-jobs')?.gates.workflow.status,
    'yes',
  );
  assert.match(
    audit('warehouse').items.find((item) => item.id === 'sql-query')?.gates.workflow.evidence ?? '',
    /801,821 BFSI rows/,
  );
  assert.equal(
    audit('victoriametrics').items.find((item) => item.id === 'metrics-query')?.gates.workflow.status,
    'no',
  );
  assert.match(
    audit('victoriametrics').items.find((item) => item.id === 'metrics-query')?.gap ?? '',
    /zero application series/,
  );
});

test('provider-neutral ports do not masquerade as selected backend workflow evidence', () => {
  // qdrant is now the SELECTED backend (OFFGRID_ADAPTER_RETRIEVAL=qdrant), proven live 2026-07-21:
  // collections + points-search are fully attributed (workflow:yes), payload-filtering's tenant/ACL
  // filtering executed on Qdrant (workflow:yes) with payload-INDEX lifecycle still partial.
  const qdrant = audit('qdrant');
  for (const id of ['collections', 'points-search', 'payload-filtering']) {
    const item = qdrant.items.find((entry) => entry.id === id);
    assert.equal(item?.gates.workflow.status, 'yes');
    assert.match(item?.gates.workflow.evidence ?? '', /provider=qdrant|Qdrant/i);
  }

  // lancedb is NOT the selected backend, so its selected-execution evidence stays provider-neutral.
  const lancedb = audit('lancedb');
  for (const id of ['tables-schema', 'vector-search']) {
    const item = lancedb.items.find((entry) => entry.id === id);
    assert.equal(item?.gates.workflow.status, 'partial');
    assert.match(item?.gates.workflow.evidence ?? '', /no retained|not service-attributed/i);
    assert.match(item?.gap ?? '', /LanceDB|selected provider/i);
  }

  const seaweedfs = audit('seaweedfs').items.find((entry) => entry.id === 'object-read-write');
  assert.equal(seaweedfs?.gates.workflow.status, 'partial');
  assert.match(seaweedfs?.gates.workflow.evidence ?? '', /no retained fleet proof/i);
  assert.match(seaweedfs?.gap ?? '', /live put\/get\/delete journey/i);
});

test('version identities are exact or explicitly stale and bounded', () => {
  const postgres = audit('postgres');
  assert.equal(postgres.upstreamVersion, 'pgvector/pgvector:0.8.0-pg16 (PostgreSQL 16 base)');
  assert.match(postgres.versionSource, /postgres image/);
  assert.match(postgres.denominatorSource, /postgresql\.org\/docs\/16/);
  assert.match(postgres.denominatorSource, /pgvector\/pgvector\/blob\/v0\.8\.0/);

  // Warehouse was re-verified live 2026-07-23: the mutable minor tag is now pinned to the exact
  // deployed patch queried from the running ClickHouse, so the identity is current, not stale.
  const warehouse = audit('warehouse');
  assert.equal(warehouse.auditState, 'current');
  assert.equal(warehouse.auditStateEvidence, null);
  assert.match(warehouse.upstreamVersion, /24\.8\.14\.39/);
  assert.match(warehouse.versionSource, /live SELECT version\(\) on g6/);

  for (const id of ENTERPRISE_SOURCE_IDS) {
    assert.match(audit(id).denominatorSource, /enterprise-source-registry\.ts/);
    assert.match(audit(id).denominatorSource, /connector-policy\.ts/);
    assert.match(audit(id).denominatorSource, /connector-exec\.ts/);
  }
});

test('enterprise sources preserve exact fixture versions and connector reality', () => {
  assert.deepEqual(
    ENTERPRISE_SOURCE_IDS.map((id) => audit(id).upstreamVersion),
    [
      '16-alpine (mutable image tag)',
      '8 (mutable image tag)',
      'latest (mutable image tag)',
      '24.2.7',
      'RELEASE.2025-04-08T15-41-24Z',
      '20-alpine (mutable image tag)',
    ],
  );

  for (const id of [
    'enterprise-source-corebank',
    'enterprise-source-policyadmin',
    'enterprise-source-erp',
    'enterprise-source-crm',
  ]) {
    assert.equal(audit(id).auditState, 'stale', `${id} uses a mutable fixture tag`);
  }
  for (const id of ['enterprise-source-kafka', 'enterprise-source-minio']) {
    assert.equal(audit(id).auditState, 'current', `${id} has a pinned fixture version`);
  }

  assert.equal(
    audit('enterprise-source-kafka').items.find((item) => item.id === 'source-produce-consume')
      ?.gates.adapter.status,
    'no',
  );
  assert.equal(
    audit('enterprise-source-minio').items.find((item) => item.id === 'object-read-write')?.gates
      .workflow.status,
    'no',
  );
});

test('the code-wired outcome plane does not inflate the live CRM capability gates', () => {
  const crm = audit('enterprise-source-crm');
  const item = crm.items.find((entry) => entry.id === 'write-sync-webhooks');

  assert.deepEqual(
    CAPABILITY_GATES.map((gate) => item?.gates[gate].status),
    ['no', 'partial', 'partial', 'partial'],
  );
  assert.match(item?.gates.adapter.evidence ?? '', /canonical receipt server-side/);
  assert.match(item?.gates.adapter.evidence ?? '', /migration is not deployed/i);
  assert.match(item?.gates.ui.evidence ?? '', /URL-driven run, result, correction, and withdrawal/);
  assert.match(item?.gates.workflow.evidence ?? '', /no deployed business-result observation/i);
  assert.match(item?.gap ?? '', /receipt → observed result → correction\/withdrawal journey/);
});
