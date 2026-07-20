import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import http, { type Server } from 'node:http';
import { after, before, test } from 'node:test';

interface SeenRequest {
  path: string;
  body: Record<string, unknown>;
}

const seen: SeenRequest[] = [];
let pii: Server;
let classifiers: Server;
let aggregator: ChildProcess;
let aggregatorBase = '';
let malformedRequiredVerdict = false;

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no test port'));
      resolve(address.port);
    });
  });
}

function close(server: Server | undefined): Promise<void> {
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

function shard(name: 'pii' | 'classifiers'): Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
      seen.push({ path: `${name}:${req.url}`, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/healthz') return res.end('{"ok":true}');
      if (req.url === '/analyze/prompt') {
        if (name === 'pii' && malformedRequiredVerdict) return res.end('{"error":"model not loaded"}');
        return res.end(
          JSON.stringify(
            name === 'pii'
              ? {
                  is_valid: false,
                  scanners: { Anonymize: 0.9 },
                  sanitized_prompt: 'Email [REDACTED]',
                }
              : {
                  is_valid: false,
                  scanners: { PromptInjection: 0.98 },
                  sanitized_prompt: body.prompt,
                },
          ),
        );
      }
      if (req.url === '/analyze/output') {
        return res.end(
          JSON.stringify(
            name === 'pii'
              ? {
                  is_valid: false,
                  scanners: { Regex: 1 },
                  sanitized_output: 'Customer PAN [REDACTED]',
                }
              : {
                  is_valid: true,
                  scanners: { Toxicity: -1 },
                  sanitized_output: body.output,
                },
          ),
        );
      }
      res.statusCode = 404;
      res.end('{"error":"not found"}');
    });
  });
}

async function unusedPort(): Promise<number> {
  const candidate = http.createServer();
  const port = await listen(candidate);
  await close(candidate);
  return port;
}

async function waitForAggregator(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${aggregatorBase}/healthz`);
      if (response.ok) return;
    } catch {
      // Process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('guardrail aggregator did not start');
}

before(async () => {
  pii = shard('pii');
  classifiers = shard('classifiers');
  const [piiPort, classifiersPort, aggregatePort] = await Promise.all([
    listen(pii),
    listen(classifiers),
    unusedPort(),
  ]);
  aggregatorBase = `http://127.0.0.1:${aggregatePort}`;
  aggregator = spawn(process.execPath, ['scripts/guardrail-aggregator.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(aggregatePort),
      OFFGRID_GUARD_BIND: '127.0.0.1',
      OFFGRID_GUARD_SHARDS: JSON.stringify([
        { name: 'pii', url: `http://127.0.0.1:${piiPort}`, required: true },
        { name: 'classifiers', url: `http://127.0.0.1:${classifiersPort}`, required: false },
      ]),
    },
    stdio: 'ignore',
  });
  await waitForAggregator();
});

after(async () => {
  aggregator?.kill('SIGTERM');
  await Promise.all([close(pii), close(classifiers)]);
});

test('real aggregator boundary fans prompt and output through their stock phase-specific paths', async () => {
  const promptBody = { prompt: 'Email audit@example.com' };
  const promptResponse = await fetch(`${aggregatorBase}/analyze/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(promptBody),
  });
  assert.equal(promptResponse.status, 200);
  assert.equal(promptResponse.headers.get('x-offgrid-guard-answered'), 'pii,classifiers');
  const promptResult = await promptResponse.json();
  assert.equal(promptResult.sanitized_prompt, 'Email [REDACTED]');

  const outputBody = { prompt: 'Return the identifier', output: 'Customer PAN ABCDE1234F' };
  const outputResponse = await fetch(`${aggregatorBase}/analyze/output`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(outputBody),
  });
  assert.equal(outputResponse.status, 200);
  const outputResult = await outputResponse.json();
  assert.equal(outputResult.sanitized_output, 'Customer PAN [REDACTED]');
  assert.equal('sanitized_prompt' in outputResult, false);

  assert.deepEqual(
    seen.filter((request) => request.path.includes('/analyze/')).map((request) => request.path),
    [
      'pii:/analyze/prompt',
      'classifiers:/analyze/prompt',
      'pii:/analyze/output',
      'classifiers:/analyze/output',
    ],
  );
  assert.deepEqual(seen.find((request) => request.path === 'pii:/analyze/output')?.body, outputBody);
});

test('real aggregator boundary rejects unsupported per-request scanner configuration', async () => {
  const beforeCount = seen.length;
  const response = await fetch(`${aggregatorBase}/analyze/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'hello', scanners: { Toxicity: {} } }),
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /startup-only/);
  assert.equal(seen.length, beforeCount, 'invalid request never reaches a shard');
});

test('real aggregator boundary fails closed when a required shard returns malformed 2xx JSON', async () => {
  malformedRequiredVerdict = true;
  try {
    const response = await fetch(`${aggregatorBase}/analyze/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'customer secret' }),
    });
    assert.equal(response.status, 502);
    assert.match(await response.text(), /guardrail shard unavailable/);
  } finally {
    malformedRequiredVerdict = false;
  }
});
