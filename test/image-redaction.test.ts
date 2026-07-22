import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_IMAGE_REDACTION_ENTITIES,
  IMAGE_REDACTION_LIMITS,
  ImageRedactionError,
  parseImageRedactionCommand,
  summarizeImageRedactionEntities,
} from '@/lib/image-redaction';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const jpeg = Buffer.from('ffd8ffe00000', 'hex');
const context = { tenantId: ' org_bharat ', actorId: ' analyst@bharat.example ' };

test('parses a bounded image and normalizes its governed policy before provider I/O', () => {
  const command = parseImageRedactionCommand(
    {
      imageBase64: png.toString('base64'),
      mediaType: 'image/png',
      purpose: ' Claims intake ',
      entityTypes: ['person', 'EMAIL_ADDRESS', 'person'],
      scoreThreshold: 0.72,
    },
    context,
  );
  assert.deepEqual(command, {
    bytes: png,
    mediaType: 'image/png',
    authorization: {
      tenantId: 'org_bharat',
      actorId: 'analyst@bharat.example',
      purpose: 'Claims intake',
    },
    policy: { entityTypes: ['EMAIL_ADDRESS', 'PERSON'], scoreThreshold: 0.72 },
  });
});

test('uses a narrow server-owned default policy', () => {
  const command = parseImageRedactionCommand(
    {
      imageBase64: jpeg.toString('base64'),
      mediaType: 'image/jpeg',
      purpose: 'Document indexing',
    },
    context,
  );
  assert.deepEqual(command.policy, {
    entityTypes: [...DEFAULT_IMAGE_REDACTION_ENTITIES].sort(),
    scoreThreshold: 0.65,
  });
});

test('rejects malformed, oversized and media-mismatched images without echoing content', () => {
  const cases: Array<{ body: Record<string, unknown>; code: string }> = [
    {
      body: { imageBase64: 'not base64!', mediaType: 'image/png', purpose: 'Claims intake' },
      code: 'invalid-body',
    },
    {
      body: {
        imageBase64: png.toString('base64'),
        mediaType: 'image/jpeg',
        purpose: 'Claims intake',
      },
      code: 'unsupported-media',
    },
    {
      body: {
        imageBase64: 'A'.repeat(Math.ceil(IMAGE_REDACTION_LIMITS.maxBytes / 3) * 4 + 4),
        mediaType: 'image/png',
        purpose: 'Claims intake',
      },
      code: 'image-too-large',
    },
  ];
  for (const { body, code } of cases) {
    assert.throws(
      () => parseImageRedactionCommand(body, context),
      (error: unknown) =>
        error instanceof ImageRedactionError &&
        error.code === code &&
        !error.message.includes('not base64!'),
    );
  }
});

test('rejects missing purpose and invalid entity/threshold policies', () => {
  const base = {
    imageBase64: png.toString('base64'),
    mediaType: 'image/png',
    purpose: 'Claims intake',
  };
  for (const body of [
    { ...base, purpose: '' },
    { ...base, entityTypes: [] },
    { ...base, entityTypes: ['bad entity'] },
    { ...base, scoreThreshold: 1.01 },
    { ...base, scoreThreshold: Number.NaN },
  ]) {
    assert.throws(() => parseImageRedactionCommand(body, context), ImageRedactionError);
  }
});

test('aggregates only sanitized provider evidence and rejects anything outside policy', () => {
  const policy = { entityTypes: ['EMAIL_ADDRESS', 'PERSON'], scoreThreshold: 0.65 };
  assert.deepEqual(
    summarizeImageRedactionEntities(
      [
        { entityType: 'person', score: 0.8 },
        { entityType: 'PERSON', score: 0.91 },
        { entityType: 'EMAIL_ADDRESS', score: 0.77 },
      ],
      policy,
    ),
    [
      { entityType: 'EMAIL_ADDRESS', count: 1, maxScore: 0.77 },
      { entityType: 'PERSON', count: 2, maxScore: 0.91 },
    ],
  );
  assert.throws(
    () => summarizeImageRedactionEntities([{ entityType: 'US_SSN', score: 0.9 }], policy),
    (error: unknown) =>
      error instanceof ImageRedactionError && error.code === 'provider-invalid-response',
  );
  assert.throws(
    () =>
      summarizeImageRedactionEntities([{ entityType: 'PERSON', score: 'raw OCR text' }], policy),
    ImageRedactionError,
  );
});
