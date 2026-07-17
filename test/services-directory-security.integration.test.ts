import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { toServiceDetailEntry, toServiceDirectoryEntries } from '@/lib/service-directory-view';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('real registry keeps the Postgres probe URL server-side while client props exclude it', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousOverride = process.env.OFFGRID_SERVICES;
  const databaseUrl =
    'postgresql://rsc-db-user:rsc-db-password@postgres.internal:5432/offgrid?sslmode=require&token=rsc-query-secret';

  process.env.DATABASE_URL = databaseUrl;
  delete process.env.OFFGRID_SERVICES;

  try {
    // Import after setting the environment because the canonical registry is constructed once on
    // module load, matching the production server process.
    const { getServices } = await import('../src/lib/services-directory.ts');
    const registry = getServices();
    const postgres = registry.find((entry) => entry.id === 'postgres');

    assert.equal(postgres?.url, databaseUrl, 'server probes retain the real connection target');

    const clientProps = { services: toServiceDirectoryEntries(registry) };
    const detailClientProps = { service: toServiceDetailEntry(postgres!) };
    const serializedProps = JSON.stringify(clientProps);
    const serializedDetailProps = JSON.stringify(detailClientProps);
    const projectedPostgres = clientProps.services.find((entry) => entry.id === 'postgres');

    assert.equal(projectedPostgres?.displayUrl, null);
    assert.doesNotMatch(
      serializedProps,
      /rsc-db-user|rsc-db-password|postgres\.internal|sslmode|rsc-query-secret/,
    );
    assert.doesNotMatch(
      serializedDetailProps,
      /rsc-db-user|rsc-db-password|postgres\.internal|sslmode|rsc-query-secret/,
    );
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousOverride === undefined) delete process.env.OFFGRID_SERVICES;
    else process.env.OFFGRID_SERVICES = previousOverride;
  }
});

test('ServicesPage projects registry entries before passing them across the client boundary', () => {
  const page = readFileSync(`${ROOT}src/app/(console)/gateway/services/page.tsx`, 'utf8');
  const client = readFileSync(`${ROOT}src/components/services/ServicesDirectory.tsx`, 'utf8');
  const detailPage = readFileSync(
    `${ROOT}src/app/(console)/gateway/services/[id]/page.tsx`,
    'utf8',
  );
  const detailClient = readFileSync(`${ROOT}src/components/services/ServiceDetail.tsx`, 'utf8');

  assert.match(page, /services=\{toServiceDirectoryEntries\(getServices\(\)\)\}/);
  assert.doesNotMatch(page, /services=\{getServices\(\)\}/);
  assert.match(client, /services: ServiceDirectoryEntry\[\]/);
  assert.doesNotMatch(client, /services: ServiceEntry\[\]/);
  assert.doesNotMatch(client, /s\.url/);
  assert.match(detailPage, /service=\{toServiceDetailEntry\(service\)\}/);
  assert.doesNotMatch(detailPage, /service=\{service\}/);
  assert.match(detailClient, /service: ServiceDetailEntry/);
  assert.doesNotMatch(detailClient, /service\.(?:url|healthPath)/);
});
