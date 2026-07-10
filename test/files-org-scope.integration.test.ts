import assert from 'node:assert/strict';
import { test } from 'node:test';

// INTEGRATION for Storage org-isolation: the REAL listFiles (prefix query + XML parse + the pure
// isKeyInOrg re-check) wired to a stubbed SeaweedFS S3 that honours the `prefix` param exactly like
// the real engine. Proves the brief's exact requirement — a viewer in org A NEVER sees org B's files
// or global desktop-app junk — without needing a live bucket. We stub only the network boundary
// (global fetch), exercising all of files.ts's listing logic for real.

// The whole shared bucket: two tenants' files + global desktop-app junk at the root.
const BUCKET = [
  'orgs/org_bharat/uuid-a-bank-statement.pdf',
  'orgs/org_bharat/uuid-b-loan.csv',
  'orgs/org_suraksha/uuid-c-policy.pdf',
  'qwythos9b-frame-0001.png', // desktop-app junk at root
  'todo-demo-note.json',
];

function listXml(keys: string[]): string {
  const contents = keys
    .map(
      (k) =>
        `<Contents><Key>${k}</Key><Size>10</Size><LastModified>2026-07-05T00:00:00.000Z</LastModified></Contents>`,
    )
    .join('');
  return `<?xml version="1.0"?><ListBucketResult>${contents}</ListBucketResult>`;
}

const realFetch = globalThis.fetch;

test('listFiles org-scopes: org A sees only its files, never org B or global junk', async (t) => {
  // Stub fetch: a bucket PUT (ensureFileSchema) → ok; a list (?list-type=2) → honour `prefix`.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT') return new Response('', { status: 200 }); // bucket create
    if (url.includes('list-type=2')) {
      const prefix = new URL(url).searchParams.get('prefix') ?? '';
      const matched = prefix ? BUCKET.filter((k) => k.startsWith(prefix)) : BUCKET;
      return new Response(listXml(matched), { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const { listFiles } = await import('@/lib/files');

  // Org A (bharat) — only its two files.
  const bharat = await listFiles('anyone@bharat', { orgId: 'org_bharat' });
  const bharatKeys = bharat.map((f) => f.id).sort();
  assert.deepEqual(bharatKeys, [
    'orgs/org_bharat/uuid-a-bank-statement.pdf',
    'orgs/org_bharat/uuid-b-loan.csv',
  ]);
  assert.ok(!bharat.some((f) => f.id.includes('suraksha')), 'never sees org B');
  assert.ok(!bharat.some((f) => f.id.startsWith('qwythos9b')), 'never sees desktop junk');
  assert.ok(!bharat.some((f) => f.id.startsWith('todo-demo')), 'never sees todo-demo junk');

  // Org B (suraksha) — only its one file, disjoint from A.
  const suraksha = await listFiles('anyone@suraksha', { orgId: 'org_suraksha' });
  assert.deepEqual(suraksha.map((f) => f.id), ['orgs/org_suraksha/uuid-c-policy.pdf']);

  // Default / single-tenant — the whole bucket (unchanged behavior for non-multi-tenant deploys).
  const all = await listFiles('admin', { orgId: 'default' });
  assert.equal(all.length, BUCKET.length);

  // No org opts at all (provit / erasure-lake callers) — also the whole bucket, unchanged.
  const unscoped = await listFiles('legacy-caller');
  assert.equal(unscoped.length, BUCKET.length);
});
