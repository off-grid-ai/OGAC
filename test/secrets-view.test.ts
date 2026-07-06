import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSecretsView,
  readSecretsView,
  type SecretsViewInput,
} from '../src/lib/secrets-view.ts';

// Unit tests for the PURE secrets STATUS display-model builder — NO mocks, no I/O.
// The builder must NEVER surface a secret value; it only normalizes sys health/seal/mounts metadata.

function baseInput(overrides: Partial<SecretsViewInput> = {}): SecretsViewInput {
  return {
    activeAdapterId: 'openbao',
    activeAdapterVendor: 'OpenBao',
    configured: true,
    baoUrl: 'http://127.0.0.1:8200',
    mount: 'secret',
    health: null,
    sealStatus: null,
    mounts: null,
    ...overrides,
  };
}

test('unsealed, reachable store with mounts', () => {
  const view = buildSecretsView(
    baseInput({
      health: {
        initialized: true,
        sealed: false,
        standby: false,
        version: '1.15.0',
        cluster_name: 'offgrid-bao',
      },
      sealStatus: { sealed: false, t: 3, n: 5, progress: 0, version: '1.15.0' },
      mounts: {
        'secret/': { type: 'kv', description: 'KV v2 store' },
        'cubbyhole/': { type: 'cubbyhole', description: 'per-token cubbyhole' },
        'sys/': { type: 'system' },
      },
    }),
  );

  assert.equal(view.reachable, true);
  assert.equal(view.sealed, false);
  assert.equal(view.initialized, true);
  assert.equal(view.standby, false);
  assert.equal(view.version, '1.15.0');
  assert.equal(view.clusterName, 'offgrid-bao');
  assert.equal(view.unsealThreshold, 3);
  assert.equal(view.unsealShares, 5);
  assert.equal(view.activeAdapterId, 'openbao');
  // Mounts are path-sorted; type/description carried through; missing description → ''.
  assert.deepEqual(
    view.mounts.map((m) => m.path),
    ['cubbyhole/', 'secret/', 'sys/'],
  );
  const sys = view.mounts.find((m) => m.path === 'sys/');
  assert.equal(sys?.type, 'system');
  assert.equal(sys?.description, '');
});

test('sealed store — seal-status is authoritative and progress reported', () => {
  const view = buildSecretsView(
    baseInput({
      health: { sealed: true, initialized: true },
      sealStatus: { sealed: true, t: 3, n: 5, progress: 1 },
    }),
  );
  assert.equal(view.sealed, true);
  assert.equal(view.reachable, true);
  assert.equal(view.unsealProgress, 1);
  assert.equal(view.unsealThreshold, 3);
});

test('seal-status sealed overrides a stale health.sealed=false', () => {
  const view = buildSecretsView(
    baseInput({
      health: { sealed: false },
      sealStatus: { sealed: true },
    }),
  );
  assert.equal(view.sealed, true);
});

test('mounts wrapped under .data are unwrapped', () => {
  const view = buildSecretsView(
    baseInput({
      health: { sealed: false },
      mounts: { data: { 'secret/': { type: 'kv' } } },
    }),
  );
  assert.equal(view.mounts.length, 1);
  assert.equal(view.mounts[0].path, 'secret/');
  assert.equal(view.mounts[0].type, 'kv');
});

test('not configured — env adapter, unreachable, empty', () => {
  const view = buildSecretsView(
    baseInput({
      activeAdapterId: 'env',
      activeAdapterVendor: 'Process env',
      configured: false,
      baoUrl: null,
      health: null,
      sealStatus: null,
      mounts: null,
    }),
  );
  assert.equal(view.configured, false);
  assert.equal(view.reachable, false);
  assert.equal(view.sealed, null);
  assert.equal(view.initialized, null);
  assert.equal(view.version, null);
  assert.equal(view.baoUrl, null);
  assert.equal(view.activeAdapterId, 'env');
  assert.deepEqual(view.mounts, []);
});

test('malformed / partial inputs degrade to safe defaults, never throws', () => {
  const view = buildSecretsView(
    baseInput({
      // wrong types everywhere
      health: { sealed: 'nope', version: 42, initialized: 1, standby: 'x' } as never,
      sealStatus: { sealed: null, t: -1, n: 'five', progress: NaN } as never,
      mounts: {
        'ok/': { type: 'kv' },
        '': { type: 'kv' }, // empty path dropped
        'bad/': null as never, // non-object dropped
        'weird/': { type: 123 } as never, // non-string type → 'unknown'
      } as never,
    }),
  );
  assert.equal(view.sealed, null); // non-bool → null
  assert.equal(view.version, null); // non-string → null
  assert.equal(view.initialized, null);
  assert.equal(view.standby, null);
  assert.equal(view.unsealThreshold, null); // negative rejected
  assert.equal(view.unsealShares, null); // non-number rejected
  assert.equal(view.unsealProgress, null); // NaN rejected
  // Only the one valid, non-empty, object mount with a bad type survives + the weird one.
  const paths = view.mounts.map((m) => m.path).sort();
  assert.deepEqual(paths, ['ok/', 'weird/']);
  assert.equal(view.mounts.find((m) => m.path === 'weird/')?.type, 'unknown');
});

test('reachable when only mounts came back (partial sys availability)', () => {
  const view = buildSecretsView(
    baseInput({ health: null, sealStatus: null, mounts: { 'secret/': { type: 'kv' } } }),
  );
  assert.equal(view.reachable, true);
  assert.equal(view.sealed, null);
});

test('version falls back to seal-status when health has none', () => {
  const view = buildSecretsView(
    baseInput({ health: { sealed: false }, sealStatus: { sealed: false, version: '1.16.1' } }),
  );
  assert.equal(view.version, '1.16.1');
});

// ── Reader-level: the configured OpenBao URL must be display-mapped (no raw loopback/LAN leaks). ──
// Founder directive: 127.0.0.1 / localhost / raw IPs may never surface in the UI. The reader
// connects to the real URL but exposes only the mDNS host in baoUrl + the error banner.

async function withBaoReader(
  env: { url: string },
  fetchImpl: typeof fetch,
  run: (r: Awaited<ReturnType<typeof readSecretsView>>) => void | Promise<void>,
): Promise<void> {
  const origFetch = globalThis.fetch;
  const origUrl = process.env.OFFGRID_OPENBAO_URL;
  const origAlias = process.env.OFFGRID_BAO_URL;
  process.env.OFFGRID_OPENBAO_URL = env.url;
  delete process.env.OFFGRID_BAO_URL;
  globalThis.fetch = fetchImpl;
  try {
    await run(await readSecretsView());
  } finally {
    globalThis.fetch = origFetch;
    if (origUrl === undefined) delete process.env.OFFGRID_OPENBAO_URL;
    else process.env.OFFGRID_OPENBAO_URL = origUrl;
    if (origAlias !== undefined) process.env.OFFGRID_BAO_URL = origAlias;
  }
}

test('reader display-maps a loopback OpenBao URL to the mDNS host (reachable)', async () => {
  const reachable: typeof fetch = async (input) => {
    const u = String(input);
    const body = u.includes('seal-status')
      ? { sealed: false, t: 1, n: 1, progress: 0, version: '1.15.0' }
      : u.includes('health')
        ? { initialized: true, sealed: false, version: '1.15.0' }
        : { 'secret/': { type: 'kv' } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  await withBaoReader({ url: 'http://127.0.0.1:8200' }, reachable, ({ data, error }) => {
    assert.equal(error, null);
    assert.equal(data.reachable, true);
    // The raw loopback address must NOT appear; it maps to S1's mDNS host.
    assert.equal(data.baoUrl, 'http://offgrid-s1.local:8200/');
    assert.ok(!(data.baoUrl ?? '').includes('127.0.0.1'));
  });
});

test('reader display-maps the URL inside the unreachable error banner', async () => {
  const down: typeof fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  await withBaoReader({ url: 'http://127.0.0.1:8200' }, down, ({ data, error }) => {
    assert.equal(data.reachable, false);
    assert.ok(error);
    assert.ok(!error.includes('127.0.0.1'), `error leaked a raw IP: ${error}`);
    assert.ok(error.includes('offgrid-s1.local'), `error should name the mDNS host: ${error}`);
  });
});
