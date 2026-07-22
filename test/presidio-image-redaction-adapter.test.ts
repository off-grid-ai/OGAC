import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRESIDIO_IMAGE_REDACTOR_VERSION,
  createPresidioImageRedactor,
  resolvePresidioImageRedactorConfig,
} from '@/lib/adapters/presidio-image-redaction';
import { ImageRedactionError, type ImageRedactionCommand } from '@/lib/image-redaction';

const input = Buffer.from('89504e470d0a1a0a01020304', 'hex');
const output = Buffer.from('89504e470d0a1a0affffffff', 'hex');
const command: ImageRedactionCommand = {
  bytes: input,
  mediaType: 'image/png',
  authorization: {
    tenantId: 'org_bharat',
    actorId: 'analyst@bharat.example',
    purpose: 'Claims intake',
  },
  policy: { entityTypes: ['EMAIL_ADDRESS', 'PERSON'], scoreThreshold: 0.7 },
};

function providerResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    engine: 'presidio-image-redactor',
    engine_version: PRESIDIO_IMAGE_REDACTOR_VERSION,
    ocr_engine: 'tesseract',
    media_type: 'image/png',
    redacted_image_base64: output.toString('base64'),
    width: 100,
    height: 50,
    detections: [
      { entity_type: 'PERSON', score: 0.91 },
      { entity_type: 'PERSON', score: 0.81 },
      { entity_type: 'EMAIL_ADDRESS', score: 0.88 },
    ],
    ...overrides,
  });
}

test('resolves a bounded provider configuration', () => {
  assert.deepEqual(
    resolvePresidioImageRedactorConfig({
      OFFGRID_PRESIDIO_IMAGE_REDACTOR_URL: 'http://127.0.0.1:5003/',
      OFFGRID_PRESIDIO_IMAGE_REDACTOR_TOKEN: ' private-token ',
      OFFGRID_PRESIDIO_IMAGE_REDACTOR_TIMEOUT_MS: '12000',
    }),
    { url: 'http://127.0.0.1:5003', token: 'private-token', timeoutMs: 12_000 },
  );
  assert.deepEqual(
    resolvePresidioImageRedactorConfig({ OFFGRID_PRESIDIO_IMAGE_REDACTOR_URL: 'file:///tmp/raw' }),
    {
      url: null,
      token: null,
      timeoutMs: 20_000,
    },
  );
});

test('calls only the provider boundary and returns redacted bytes with sanitized evidence', async () => {
  let calls = 0;
  const port = createPresidioImageRedactor(
    { url: 'http://presidio-image', token: 'secret-token', timeoutMs: 1000 },
    async (url, init) => {
      calls += 1;
      assert.equal(url, 'http://presidio-image/v1/redact');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('authorization'), 'Bearer secret-token');
      assert.equal(headers.get('content-type'), 'image/png');
      assert.equal(headers.get('x-offgrid-entity-types'), 'EMAIL_ADDRESS,PERSON');
      assert.equal(headers.get('x-offgrid-score-threshold'), '0.7');
      assert.equal(Buffer.from(init?.body as Uint8Array).equals(input), true);
      assert.equal(
        headers.has('x-offgrid-tenant-id'),
        false,
        'identity context stays at the OGAC boundary',
      );
      return providerResponse();
    },
  );
  const result = await port.redact(command);
  assert.equal(calls, 1);
  assert.equal(Buffer.from(result.redactedBytes).equals(output), true);
  assert.equal(result.mediaType, 'image/png');
  assert.deepEqual(result.evidence.entities, [
    { entityType: 'EMAIL_ADDRESS', count: 1, maxScore: 0.88 },
    { entityType: 'PERSON', count: 2, maxScore: 0.91 },
  ]);
  assert.equal(result.evidence.engineVersion, '0.0.59');
  assert.match(result.evidence.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.outputSha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.policy.receiptId, /^imgred_[a-f0-9]{64}$/);
  const serialized = JSON.stringify(result.evidence);
  assert.equal(serialized.includes('raw OCR'), false);
  assert.equal(serialized.includes('left'), false);
  assert.equal(serialized.includes('top'), false);
});

test('fails before provider I/O when the capability is not configured', async () => {
  let called = false;
  const port = createPresidioImageRedactor(
    { url: null, token: null, timeoutMs: 1000 },
    async () => {
      called = true;
      return providerResponse();
    },
  );
  await assert.rejects(
    () => port.redact(command),
    (error: unknown) => error instanceof ImageRedactionError && error.code === 'not-configured',
  );
  assert.equal(called, false);
});

test('fails closed on timeouts, provider errors and incompatible responses without returning provider text', async () => {
  const timeout = createPresidioImageRedactor(
    { url: 'http://presidio-image', token: 'token', timeoutMs: 1000 },
    async () => {
      throw new DOMException('raw OCR must stay private', 'TimeoutError');
    },
  );
  await assert.rejects(
    () => timeout.redact(command),
    (error: unknown) =>
      error instanceof ImageRedactionError &&
      error.code === 'provider-timeout' &&
      !error.message.includes('raw OCR'),
  );

  for (const response of [
    new Response('raw OCR must stay private', { status: 500 }),
    providerResponse({ engine_version: 'moving-version' }),
    providerResponse({ width: 20_000 }),
    providerResponse({ detections: [{ entity_type: 'PERSON', score: 0.2 }] }),
    providerResponse({ detections: [{ entity_type: 'US_SSN', score: 0.9 }] }),
  ]) {
    const port = createPresidioImageRedactor(
      { url: 'http://presidio-image', token: 'token', timeoutMs: 1000 },
      async () => response,
    );
    await assert.rejects(
      () => port.redact(command),
      (error: unknown) =>
        error instanceof ImageRedactionError && !error.message.includes('raw OCR'),
    );
  }
});

test('does not release an unchanged image when the provider reports detections', async () => {
  const port = createPresidioImageRedactor(
    { url: 'http://presidio-image', token: 'token', timeoutMs: 1000 },
    async () => providerResponse({ redacted_image_base64: input.toString('base64') }),
  );
  await assert.rejects(
    () => port.redact(command),
    (error: unknown) =>
      error instanceof ImageRedactionError && error.code === 'provider-invalid-response',
  );
});
