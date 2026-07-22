import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { IMAGE_REDACTION_MAX_REQUEST_BYTES } from '@/lib/image-redaction';

const TOKEN = 'image-redaction-route-token';
const input = Buffer.from('89504e470d0a1a0a01020304', 'hex');
const output = Buffer.from('89504e470d0a1a0affffffff', 'hex');

function request(body: unknown, authenticated = true, headers: HeadersInit = {}): Request {
  return new Request('http://console.local/api/v1/governance/image-redaction', {
    method: 'POST',
    headers: {
      ...(authenticated ? { authorization: `Bearer ${TOKEN}` } : {}),
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify(body),
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('authenticated route redacts through the real HTTP adapter without forwarding tenant identity or raw evidence', async (t) => {
  let providerCalls = 0;
  const provider = createServer(async (req, res) => {
    providerCalls += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.equal(req.url, '/v1/redact');
    assert.equal(req.headers.authorization, 'Bearer provider-private-token');
    assert.equal(req.headers['content-type'], 'image/png');
    assert.equal(req.headers['x-offgrid-entity-types'], 'EMAIL_ADDRESS,PERSON');
    assert.equal(req.headers['x-offgrid-score-threshold'], '0.7');
    assert.equal(req.headers['x-offgrid-tenant-id'], undefined);
    assert.equal(Buffer.concat(chunks).equals(input), true);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        engine: 'presidio-image-redactor',
        engine_version: '0.0.59',
        ocr_engine: 'tesseract',
        media_type: 'image/png',
        redacted_image_base64: output.toString('base64'),
        width: 100,
        height: 50,
        detections: [{ entity_type: 'EMAIL_ADDRESS', score: 0.9 }],
      }),
    );
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => close(provider));
  const address = provider.address();
  assert.ok(address && typeof address === 'object');

  const previous = {
    admin: process.env.OFFGRID_ADMIN_TOKEN,
    authSecret: process.env.AUTH_SECRET,
    org: process.env.OFFGRID_ORG,
    url: process.env.OFFGRID_PRESIDIO_IMAGE_REDACTOR_URL,
    token: process.env.OFFGRID_PRESIDIO_IMAGE_REDACTOR_TOKEN,
  };
  process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
  process.env.AUTH_SECRET = 'image-redaction-route-secret-32-characters';
  process.env.OFFGRID_ORG = 'org_bharat';
  process.env.OFFGRID_PRESIDIO_IMAGE_REDACTOR_URL = `http://127.0.0.1:${address.port}`;
  process.env.OFFGRID_PRESIDIO_IMAGE_REDACTOR_TOKEN = 'provider-private-token';
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      const env = {
        admin: 'OFFGRID_ADMIN_TOKEN',
        authSecret: 'AUTH_SECRET',
        org: 'OFFGRID_ORG',
        url: 'OFFGRID_PRESIDIO_IMAGE_REDACTOR_URL',
        token: 'OFFGRID_PRESIDIO_IMAGE_REDACTOR_TOKEN',
      }[name] as string;
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  });

  const { POST } = await import('../src/app/api/v1/governance/image-redaction/route.ts');
  const response = await POST(
    request({
      imageBase64: input.toString('base64'),
      mediaType: 'image/png',
      purpose: 'Claims intake',
      entityTypes: ['PERSON', 'EMAIL_ADDRESS'],
      scoreThreshold: 0.7,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.redactedImageBase64, output.toString('base64'));
  assert.equal(body.mediaType, 'image/png');
  assert.equal(JSON.stringify(body).includes('raw OCR'), false);
  assert.equal(JSON.stringify(body).includes('left'), false);
  assert.equal(providerCalls, 1);
});

test('route rejects unauthorized, oversized and malformed requests before provider I/O', async () => {
  const previous = {
    admin: process.env.OFFGRID_ADMIN_TOKEN,
    authSecret: process.env.AUTH_SECRET,
  };
  process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
  process.env.AUTH_SECRET = 'image-redaction-route-secret-32-characters';
  const { POST } = await import('../src/app/api/v1/governance/image-redaction/route.ts');
  try {
    const unauthorized = await POST(
      request(
        { imageBase64: input.toString('base64'), mediaType: 'image/png', purpose: 'Claims intake' },
        false,
      ),
    );
    assert.equal(unauthorized.status, 401);

    const oversized = await POST(
      request(
        { imageBase64: input.toString('base64'), mediaType: 'image/png', purpose: 'Claims intake' },
        true,
        { 'content-length': String(IMAGE_REDACTION_MAX_REQUEST_BYTES + 1) },
      ),
    );
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), {
      error: 'request exceeds the image redaction limit',
      code: 'image-too-large',
    });

    const malformed = new Request('http://console.local/api/v1/governance/image-redaction', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{broken',
    });
    const malformedResponse = await POST(malformed);
    assert.equal(malformedResponse.status, 400);
    assert.deepEqual(await malformedResponse.json(), {
      error: 'invalid JSON body',
      code: 'invalid-body',
    });
  } finally {
    if (previous.admin === undefined) delete process.env.OFFGRID_ADMIN_TOKEN;
    else process.env.OFFGRID_ADMIN_TOKEN = previous.admin;
    if (previous.authSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous.authSecret;
  }
});
