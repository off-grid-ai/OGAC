import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getServices,
  isHealthy,
  needsNetworkProbe,
  resolveHealth,
  type RawProbe,
  type ServiceEntry,
} from '@/lib/services-directory';

const base = (over: Partial<ServiceEntry>): ServiceEntry => ({
  id: 'x',
  label: 'X',
  description: '',
  url: 'http://offgrid-s1.local:1234',
  auth: 'api-key',
  kind: 'api',
  ...over,
});

const up: RawProbe = { status: 'up', httpStatus: 200, ms: 12 };
const down: RawProbe = {
  status: 'down',
  httpStatus: null,
  ms: null,
  error: 'connect ECONNREFUSED',
};

test('embedded backend is healthy with no network probe', () => {
  const e = base({ id: 'lancedb', probe: 'embedded' });
  assert.equal(needsNetworkProbe(e), false);
  const h = resolveHealth(e); // no raw — embedded is never probed
  assert.equal(h.status, 'embedded');
  assert.equal(h.detail, 'embedded / healthy');
  assert.equal(h.httpStatus, null);
  assert.equal(h.error, undefined);
  assert.equal(isHealthy(h.status), true);
});

test('optional dep that answers is up', () => {
  const e = base({ id: 'redis', probe: 'optional', fallbackLabel: 'in-process cache' });
  const h = resolveHealth(e, up);
  assert.equal(h.status, 'up');
  assert.equal(h.httpStatus, 200);
  assert.equal(isHealthy(h.status), true);
});

test('optional dep that is unreachable reports fallback, NOT down', () => {
  const e = base({ id: 'redis', probe: 'optional', fallbackLabel: 'in-process cache' });
  const h = resolveHealth(e, down);
  assert.equal(h.status, 'optional');
  assert.equal(h.detail, 'in-process cache (optional)');
  assert.equal(h.error, undefined); // no scary error surfaced
  assert.equal(isHealthy(h.status), true);
});

test('optional dep with no probe (non-HTTP url skipped) reports fallback', () => {
  const e = base({
    id: 'redis',
    probe: 'optional',
    fallbackLabel: 'in-process cache',
    url: 'redis://x:6379',
  });
  const h = resolveHealth(e); // no raw — non-HTTP optional isn't network-probed
  assert.equal(h.status, 'optional');
  assert.equal(h.detail, 'in-process cache (optional)');
  assert.equal(isHealthy(h.status), true);
});

test('optional dep falls back to a generic label when none is given', () => {
  const e = base({ id: 'redis', probe: 'optional' });
  const h = resolveHealth(e, down);
  assert.equal(h.detail, 'fallback (optional)');
});

test('canonical-but-not-deployed plane reports its reason as an optional fallback, NOT down', () => {
  // Modelled as an 'optional' service with a non-http URL → never network-probed, always reports
  // the fallbackLabel reason. This keeps it non-alarming (never a red outage).
  const e = base({
    id: 'victoriametrics',
    probe: 'optional',
    fallbackLabel: 'not deployed here — this fleet uses OpenSearch + Langfuse for logs/traces',
    url: 'not-deployed://victoriametrics',
  });
  const h = resolveHealth(e); // no raw — non-http optional isn't network-probed
  assert.equal(h.status, 'optional');
  assert.equal(
    h.detail,
    'not deployed here — this fleet uses OpenSearch + Langfuse for logs/traces (optional)',
  );
  assert.equal(h.error, undefined); // no scary error surfaced
  assert.equal(isHealthy(h.status), true); // NOT an outage
});

test('network service passes raw up/down through', () => {
  const e = base({ id: 'qdrant' }); // probe defaults to 'network'
  assert.equal(needsNetworkProbe(e), true);
  assert.equal(resolveHealth(e, up).status, 'up');
  const d = resolveHealth(e, down);
  assert.equal(d.status, 'down');
  assert.equal(d.error, 'connect ECONNREFUSED');
  assert.equal(isHealthy(d.status), false);
});

test('network service with a missing raw defensively reads down', () => {
  const e = base({ id: 'qdrant' });
  assert.equal(resolveHealth(e).status, 'down');
});

test('isHealthy: only down is unhealthy', () => {
  assert.equal(isHealthy('up'), true);
  assert.equal(isHealthy('embedded'), true);
  assert.equal(isHealthy('optional'), true);
  assert.equal(isHealthy('down'), false);
});

test('data-plane engines are registered on the S1 edge loopbacks (8941–8944)', () => {
  const byId = new Map(getServices().map((s) => [s.id, s]));
  const expected: Record<string, { url: string; healthPath: string }> = {
    warehouse: { url: 'http://127.0.0.1:8941', healthPath: '/ping' },
    airbyte: { url: 'http://127.0.0.1:8942', healthPath: '/api/v1/health' },
    streaming: { url: 'http://127.0.0.1:8943', healthPath: '/v1/cluster/health_overview' },
    'data-quality': { url: 'http://127.0.0.1:8944', healthPath: '/' },
  };
  for (const [id, want] of Object.entries(expected)) {
    const e = byId.get(id);
    assert.ok(e, `data-plane service '${id}' must be registered`);
    assert.equal(e!.url, want.url, `${id} url`);
    assert.equal(e!.healthPath, want.healthPath, `${id} healthPath`);
    // Real engines — honestly network-probed (never masked as 'optional'): a genuine outage shows.
    assert.equal(needsNetworkProbe(e!), true, `${id} must be network-probed`);
  }
});

test('OTel directory uses the stable collector config rather than a second endpoint contract', () => {
  const otel = getServices().find((service) => service.id === 'otel-collector');
  assert.ok(otel);
  assert.equal(otel.probe, 'optional');
  assert.match(otel.fallbackLabel ?? '', /OTLP ingest not configured/);
});
