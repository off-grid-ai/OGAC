import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MCP_SERVERS,
  MCP_CATEGORIES,
  getMcpServer,
  mcpCatalogByCategory,
  internetReachingServers,
  isBlankEndpoint,
  isInstallable,
  buildInstallPayload,
} from '../src/lib/mcp-catalog.ts';

// PURE unit tests for the curated MCP-server catalog + install-payload builder + air-gap gating
// (Builder Epic #119). No I/O. Grounded in the real reference/known servers only.

test('catalog is a non-trivial, curated set (~15-25 real servers)', () => {
  assert.ok(MCP_SERVERS.length >= 15, `expected >=15 servers, got ${MCP_SERVERS.length}`);
  assert.ok(MCP_SERVERS.length <= 25, `expected <=25 servers, got ${MCP_SERVERS.length}`);
});

test('every server carries the full required metadata', () => {
  for (const s of MCP_SERVERS) {
    assert.ok(s.id, 'id');
    assert.ok(s.name, `name for ${s.id}`);
    assert.ok(MCP_CATEGORIES.includes(s.category), `valid category for ${s.id}`);
    assert.ok(s.description.length > 10, `description for ${s.id}`);
    assert.ok(s.homepage.startsWith('http'), `homepage url for ${s.id}`);
    assert.ok(s.transport === 'stdio' || s.transport === 'http', `transport for ${s.id}`);
    assert.ok(s.defaultEndpointHint.length > 0, `endpoint hint for ${s.id}`);
    assert.equal(typeof s.reachesInternet, 'boolean', `reachesInternet for ${s.id}`);
    assert.ok(s.airgapNote.length > 0, `airgapNote for ${s.id}`);
    assert.ok(s.install.length > 0, `install for ${s.id}`);
  }
});

test('ids are unique', () => {
  const ids = MCP_SERVERS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate server id');
});

test('grounded: the official reference servers are present', () => {
  // Fetch, Filesystem, Git, Memory, Sequential Thinking, Everything (official reference set).
  for (const id of ['fetch', 'filesystem', 'git', 'memory', 'sequential-thinking', 'everything']) {
    assert.ok(getMcpServer(id), `missing reference server ${id}`);
  }
});

test('grounded: commonly-known servers are present', () => {
  for (const id of ['time', 'postgres', 'sqlite', 'puppeteer', 'brave-search', 'slack', 'github', 'google-drive', 'sentry']) {
    assert.ok(getMcpServer(id), `missing known server ${id}`);
  }
});

test('mcpCatalogByCategory groups in canonical order, drops empties, loses no server', () => {
  const groups = mcpCatalogByCategory();
  // Group order is a subsequence of the canonical category order.
  const order = groups.map((g) => g.category);
  const canonicalIdx = order.map((c) => MCP_CATEGORIES.indexOf(c));
  for (let i = 1; i < canonicalIdx.length; i++) {
    assert.ok(canonicalIdx[i] > canonicalIdx[i - 1], 'categories out of canonical order');
  }
  // No empty groups.
  for (const g of groups) assert.ok(g.servers.length > 0, `empty group ${g.category}`);
  // Every server appears exactly once across groups.
  const flat = groups.flatMap((g) => g.servers.map((s) => s.id)).sort();
  const all = MCP_SERVERS.map((s) => s.id).sort();
  assert.deepEqual(flat, all, 'grouping lost or duplicated a server');
});

test('AIR-GAP: internet-reaching servers are flagged, local ones are not', () => {
  // Local-only servers must NOT be flagged as reaching the internet.
  for (const id of ['filesystem', 'git', 'postgres', 'sqlite', 'memory', 'sequential-thinking', 'time', 'everything']) {
    assert.equal(getMcpServer(id)!.reachesInternet, false, `${id} should be local-only`);
  }
  // Internet-reaching servers must be flagged.
  for (const id of ['fetch', 'brave-search', 'slack', 'github', 'google-drive', 'sentry']) {
    assert.equal(getMcpServer(id)!.reachesInternet, true, `${id} should be flagged internet-reaching`);
  }
});

test('internetReachingServers returns exactly the flagged subset', () => {
  const flagged = internetReachingServers();
  assert.ok(flagged.length > 0);
  assert.ok(flagged.every((s) => s.reachesInternet));
  assert.equal(flagged.length, MCP_SERVERS.filter((s) => s.reachesInternet).length);
});

test('isBlankEndpoint detects empty / whitespace / missing', () => {
  assert.equal(isBlankEndpoint(''), true);
  assert.equal(isBlankEndpoint('   '), true);
  assert.equal(isBlankEndpoint(undefined), true);
  assert.equal(isBlankEndpoint(null), true);
  assert.equal(isBlankEndpoint('http://x'), false);
});

test('isInstallable requires a real operator-supplied endpoint', () => {
  const fs = getMcpServer('filesystem')!;
  assert.equal(isInstallable(fs, ''), false, 'no endpoint → not installable');
  assert.equal(isInstallable(fs, '   '), false, 'blank endpoint → not installable');
  assert.equal(isInstallable(fs, 'http://mcp.internal:8080'), true);
  assert.equal(isInstallable(null, 'http://x'), false, 'no server → not installable');
});

test('buildInstallPayload yields exactly the tool-create body (type=mcp, trimmed endpoint)', () => {
  const fs = getMcpServer('filesystem')!;
  const payload = buildInstallPayload(fs, '  http://mcp-fs.internal:8080  ');
  assert.equal(payload.type, 'mcp');
  assert.equal(payload.endpoint, 'http://mcp-fs.internal:8080', 'endpoint is trimmed');
  assert.equal(payload.name, 'MCP: Filesystem');
  assert.ok(payload.description.includes('Read, write'), 'carries the catalog description');
  assert.ok(!payload.description.startsWith('[reaches internet]'), 'local server has no egress marker');
});

test('buildInstallPayload marks internet-reaching servers in the description (posture carried forward)', () => {
  const brave = getMcpServer('brave-search')!;
  const payload = buildInstallPayload(brave, 'npx -y @modelcontextprotocol/server-brave-search');
  assert.ok(payload.description.startsWith('[reaches internet] '), 'egress marker prefixed');
  assert.equal(payload.type, 'mcp');
});
