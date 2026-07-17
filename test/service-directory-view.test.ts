import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  toSafeServiceDisplayUrl,
  toServiceDirectoryEntries,
  toServiceDirectoryEntry,
  toServiceDetailEntry,
  toServiceTopologyDetailEntry,
  toServiceTopologyDirectoryEntries,
} from '@/lib/service-directory-view';
import type { ServiceEntry } from '@/lib/service-entry';

const service = (url: string): ServiceEntry => ({
  id: 'service-id',
  label: 'Service label',
  description: 'Service description',
  url,
  healthPath: '/health?probe-token=server-only',
  auth: 'api-key',
  kind: 'api',
  probe: 'optional',
  fallbackLabel: 'fallback',
  management: 'redpanda',
});

test('safe display URL allow-lists the HTTP origin and removes every secret-bearing component', () => {
  const raw =
    'https://alice:p%40ssword@api.example.com:8443/private/health?api_key=query-secret&unknown=new-secret#fragment-secret';

  const displayUrl = toSafeServiceDisplayUrl(raw);

  assert.equal(displayUrl, 'https://api.example.com:8443');
  assert.doesNotMatch(displayUrl ?? '', /alice|ssword|private|query-secret|new-secret|fragment/i);
});

test('safe display URL maps an internal probe target only after credentials are removed', () => {
  const displayUrl = toSafeServiceDisplayUrl(
    'http://internal-user:internal-password@127.0.0.1:9200/_cluster/health?token=secret',
  );

  assert.equal(displayUrl, 'http://offgrid-s1.local:9200/');
  assert.doesNotMatch(displayUrl ?? '', /internal-user|internal-password|token|secret/i);
});

test('non-browser connection strings and malformed values are never serialized as links', () => {
  for (const raw of [
    'postgresql://db-user:db-password@postgres.internal:5432/offgrid?sslmode=require',
    'redis://cache-user:cache-password@redis.internal:6379/0',
    'embedded://lancedb',
    'not a url',
  ]) {
    assert.equal(toSafeServiceDisplayUrl(raw), null, raw);
  }
});

test('directory projection allow-lists browser fields and excludes raw probe/control metadata', () => {
  const raw = service(
    'https://operator:password@service.example.com/private?token=directory-secret',
  );

  const projected = toServiceDirectoryEntry(raw);

  assert.deepEqual(Object.keys(projected).sort(), [
    'auth',
    'description',
    'displayUrl',
    'id',
    'kind',
    'label',
  ]);
  assert.deepEqual(projected, {
    id: raw.id,
    label: raw.label,
    description: raw.description,
    displayUrl: 'https://service.example.com',
    auth: raw.auth,
    kind: raw.kind,
  });

  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(
    serialized,
    /operator|password|private|directory-secret|healthPath|probe|fallbackLabel|management/,
  );
});

test('directory collection projection applies the boundary to every entry without mutation', () => {
  const entries = [service('https://user:password@one.example.com/x?token=one')];
  const original = structuredClone(entries);

  assert.deepEqual(toServiceDirectoryEntries(entries), [
    {
      id: 'service-id',
      label: 'Service label',
      description: 'Service description',
      displayUrl: 'https://one.example.com',
      auth: 'api-key',
      kind: 'api',
    },
  ]);
  assert.deepEqual(entries, original);
});

test('detail projection exposes only the allow-listed management capability', () => {
  const raw = service(
    'https://detail-user:detail-password@detail.example.com/private?token=detail-secret',
  );

  const projected = toServiceDetailEntry(raw);

  assert.deepEqual(projected, {
    id: 'service-id',
    label: 'Service label',
    description: 'Service description',
    displayUrl: 'https://detail.example.com',
    auth: 'api-key',
    kind: 'api',
    management: 'redpanda',
  });
  assert.doesNotMatch(
    JSON.stringify(projected),
    /detail-user|detail-password|private|detail-secret|healthPath/,
  );

  assert.equal(toServiceDetailEntry({ ...raw, management: undefined }).management, undefined);
});

test('topology projection preserves hierarchy and counts while stripping endpoint credentials', () => {
  const raw = service('https://service.example.com');
  const topology = {
    service: raw,
    dependencies: [{ serviceId: 'postgres', purpose: 'state', required: true }],
    readiness: [
      { gate: 'console-used' as const, state: 'pass' as const, summary: 'used', source: 'test' },
    ],
    components: [
      {
        id: 'api',
        label: 'API',
        role: 'control',
        readiness: [],
        instances: [
          {
            id: 'api-g6',
            label: 'API on g6',
            nodeId: 'g6',
            readiness: [],
            endpoints: [
              {
                id: 'private',
                label: 'Private API',
                purpose: 'Control',
                scope: 'lan' as const,
                url: 'https://endpoint-user:endpoint-password@offgrid-g6.local:8443/private?token=endpoint-secret',
              },
            ],
          },
        ],
      },
    ],
  };

  const list = toServiceTopologyDirectoryEntries([topology]);
  const detail = toServiceTopologyDetailEntry(topology);

  assert.equal(list[0]?.componentCount, 1);
  assert.equal(list[0]?.instanceCount, 1);
  assert.equal(list[0]?.readiness['console-used'], 'pass');
  assert.equal(detail.components[0]?.instances[0]?.nodeId, 'g6');
  assert.equal(
    detail.components[0]?.instances[0]?.endpoints[0]?.displayUrl,
    'https://offgrid-g6.local:8443',
  );
  assert.deepEqual(detail.dependencies, topology.dependencies);
  assert.doesNotMatch(
    JSON.stringify({ list, detail }),
    /endpoint-user|endpoint-password|private\?|endpoint-secret/,
  );
});
