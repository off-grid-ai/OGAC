import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const ROOT = new URL('../', import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), 'utf8');
}

test('object source pages are tenant-scoped, S3-only, and provide a catch-all detail route', async () => {
  const [listPage, detailPage] = await Promise.all([
    source('src/app/(console)/data/sources/[id]/objects/page.tsx'),
    source('src/app/(console)/data/sources/[id]/objects/[...key]/page.tsx'),
  ]);
  for (const page of [listPage, detailPage]) {
    assert.match(page, /currentOrgId\(\)/);
    assert.match(page, /getConnector\(id, orgId\)/);
    assert.match(page, /source\.type !== 's3'/);
    assert.match(page, /domain\.connectorId === source\.id/);
    assert.match(page, /<SourceObjectBrowser/);
  }
  assert.match(detailPage, /objectKey=\{key\.join\('\/'\)\}/);
});

test('object browser exposes URL-owned navigation and the complete governed CRUD journey', async () => {
  const browser = await source('src/components/data/SourceObjectBrowser.tsx');
  assert.match(browser, /params\.get\('domain'\)/);
  assert.match(browser, /params\.get\('prefix'\)/);
  assert.match(browser, /router\.push\(`\/data\/sources/);
  assert.match(browser, /objects\/\$\{path\}\?domain=/);
  assert.match(browser, /method: 'POST'/);
  assert.match(browser, /method: 'DELETE'/);
  assert.match(browser, /download: '1'/);
  assert.match(browser, /object-exists/);
  assert.match(browser, /Replace the existing object\?/);
  assert.match(browser, /Delete this object\?/);
  assert.match(browser, /<Skeleton/);
  assert.match(browser, /<EmptyState/);
  assert.match(browser, /<ErrorState/);
  assert.match(browser, /Load more/);
});

test('S3 connector detail is the single discoverability entry into approved objects', async () => {
  const detail = await source('src/app/(console)/data/connectors/[id]/page.tsx');
  assert.match(detail, /c\.type === 's3'/);
  assert.match(detail, /\/data\/sources\/\$\{encodeURIComponent\(c\.id\)\}\/objects/);
  assert.match(detail, /Browse objects/);
});
