import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { scanWithPresidio } from '@/lib/adapters/presidio';

test('Presidio data adapter calls real analyzer and anonymizer HTTP boundaries', async (t) => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({ url: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/analyze') {
        res.end(JSON.stringify([{ entity_type: 'EMAIL_ADDRESS', start: 8, end: 25, score: 0.98 }]));
      } else if (req.url === '/anonymize') {
        res.end(JSON.stringify({ text: 'contact [EMAIL_ADDRESS] now' }));
      } else {
        res.writeHead(404);
        res.end('{}');
      }
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
  const base = `http://127.0.0.1:${address.port}`;

  const result = await scanWithPresidio('contact a@example.com now', {
    analyzerUrl: base,
    anonymizerUrl: base,
    timeoutMs: 1000,
  });

  assert.equal(result.engine, 'presidio');
  assert.equal(result.status, 'applied');
  assert.equal(result.redacted, 'contact [EMAIL_ADDRESS] now');
  assert.deepEqual(
    requests.map((request) => request.url),
    ['/analyze', '/anonymize'],
  );
  const recognizers = requests[0].body.ad_hoc_recognizers as Array<{ supported_entity: string }>;
  assert.ok(recognizers.some((recognizer) => recognizer.supported_entity === 'IN_PAN'));
  assert.deepEqual(requests[1].body.analyzer_results, [
    { entity_type: 'EMAIL_ADDRESS', start: 8, end: 25, score: 0.98 },
  ]);
});

test('Presidio analyzer outage is visible while regex safely handles the row', async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(503);
    res.end('analyzer unavailable');
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

  const result = await scanWithPresidio('contact a@example.com', {
    analyzerUrl: `http://127.0.0.1:${address.port}`,
    anonymizerUrl: null,
    timeoutMs: 1000,
  });
  assert.equal(result.engine, 'regex');
  assert.equal(result.requestedEngine, 'presidio');
  assert.equal(result.configured, true);
  assert.equal(result.status, 'fallback');
  assert.match(result.reason ?? '', /503/);
});
