import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { probeOtelReadiness } from '@/lib/otel-config';

test('OTel readiness exercises a real local OTLP HTTP boundary', async (t) => {
  let received: unknown;
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      received = JSON.parse(raw);
      res.writeHead(req.method === 'POST' && req.url === '/v1/traces' ? 200 : 404);
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const result = await probeOtelReadiness({ OFFGRID_OTEL_URL: `http://127.0.0.1:${address.port}` });
  assert.equal(result.status, 'ready');
  assert.deepEqual(received, { resourceSpans: [] });
});

test('OTel readiness distinguishes receiver rejection from unconfigured', async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(503);
    res.end('pipeline unavailable');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const down = await probeOtelReadiness({ OFFGRID_OTLP_URL: `http://127.0.0.1:${address.port}` });
  assert.equal(down.status, 'down');
  if (down.status === 'down') {
    assert.equal(down.httpStatus, 503);
    assert.match(down.error, /pipeline unavailable/);
    assert.equal(down.source, 'OFFGRID_OTLP_URL');
  }
  assert.equal((await probeOtelReadiness({})).status, 'unconfigured');
});
