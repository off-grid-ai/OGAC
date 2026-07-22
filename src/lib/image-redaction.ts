/**
 * Provider-neutral contract for governed image redaction.
 *
 * This module owns only deterministic validation and evidence shaping. OCR, entity detection and
 * pixel mutation belong to the selected provider behind ImageRedactionPort.
 */

export const IMAGE_REDACTION_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxDimension: 10_000,
  maxEntities: 32,
  timeoutMs: 20_000,
} as const;

export const IMAGE_REDACTION_MEDIA_TYPES = ['image/png', 'image/jpeg'] as const;
export type ImageRedactionMediaType = (typeof IMAGE_REDACTION_MEDIA_TYPES)[number];

export const DEFAULT_IMAGE_REDACTION_ENTITIES = [
  'CREDIT_CARD',
  'EMAIL_ADDRESS',
  'IP_ADDRESS',
  'PERSON',
  'PHONE_NUMBER',
] as const;

export type ImageRedactionErrorCode =
  | 'invalid-body'
  | 'unsupported-media'
  | 'image-too-large'
  | 'invalid-policy'
  | 'not-configured'
  | 'provider-timeout'
  | 'provider-unavailable'
  | 'provider-invalid-response';

export class ImageRedactionError extends Error {
  readonly code: ImageRedactionErrorCode;

  constructor(code: ImageRedactionErrorCode, message: string) {
    super(message);
    this.name = 'ImageRedactionError';
    this.code = code;
  }
}

export interface ImageRedactionAuthorization {
  tenantId: string;
  actorId: string;
  purpose: string;
}

export interface ImageRedactionPolicy {
  entityTypes: string[];
  scoreThreshold: number;
}

export interface ImageRedactionCommand {
  bytes: Uint8Array;
  mediaType: ImageRedactionMediaType;
  authorization: ImageRedactionAuthorization;
  policy: ImageRedactionPolicy;
}

export interface ImageRedactionEntityEvidence {
  entityType: string;
  count: number;
  maxScore: number;
}

export interface ImageRedactionPolicyReceipt {
  receiptId: string;
  tenantId: string;
  actorId: string;
  purpose: string;
  entityTypes: string[];
  scoreThreshold: number;
}

export interface ImageRedactionEvidence {
  engine: 'Microsoft Presidio image-redactor';
  engineVersion: string;
  ocrEngine: 'Tesseract';
  inputSha256: string;
  outputSha256: string;
  inputBytes: number;
  outputBytes: number;
  width: number;
  height: number;
  durationMs: number;
  entities: ImageRedactionEntityEvidence[];
  policy: ImageRedactionPolicyReceipt;
}

export interface ImageRedactionResult {
  redactedBytes: Uint8Array;
  mediaType: ImageRedactionMediaType;
  evidence: ImageRedactionEvidence;
}

export interface ImageRedactionPort {
  redact(command: ImageRedactionCommand): Promise<ImageRedactionResult>;
}

interface ImageRedactionBody {
  imageBase64?: unknown;
  mediaType?: unknown;
  purpose?: unknown;
  entityTypes?: unknown;
  scoreThreshold?: unknown;
}

const ENTITY_TYPE = /^[A-Z][A-Z0-9_]{1,63}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function cleanIdentity(value: string, field: 'tenant' | 'actor'): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 160) {
    throw new ImageRedactionError('invalid-body', `${field} context is required`);
  }
  return cleaned;
}

function cleanPurpose(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ImageRedactionError('invalid-body', 'purpose is required');
  }
  const cleaned = value.trim();
  if (cleaned.length < 3 || cleaned.length > 160) {
    throw new ImageRedactionError('invalid-body', 'purpose must be between 3 and 160 characters');
  }
  return cleaned;
}

function mediaType(value: unknown): ImageRedactionMediaType {
  if (value === 'image/png' || value === 'image/jpeg') return value;
  throw new ImageRedactionError('unsupported-media', 'only PNG and JPEG images are supported');
}

function decodeImage(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value) {
    throw new ImageRedactionError('invalid-body', 'imageBase64 must be canonical base64');
  }
  if (value.length > Math.ceil(IMAGE_REDACTION_LIMITS.maxBytes / 3) * 4) {
    throw new ImageRedactionError('image-too-large', 'image exceeds the 8 MiB limit');
  }
  if (!BASE64.test(value)) {
    throw new ImageRedactionError('invalid-body', 'imageBase64 must be canonical base64');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length) throw new ImageRedactionError('invalid-body', 'image must not be empty');
  if (bytes.length > IMAGE_REDACTION_LIMITS.maxBytes) {
    throw new ImageRedactionError('image-too-large', 'image exceeds the 8 MiB limit');
  }
  return bytes;
}

function validateSignature(bytes: Uint8Array, type: ImageRedactionMediaType): void {
  const png =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((type === 'image/png' && !png) || (type === 'image/jpeg' && !jpeg)) {
    throw new ImageRedactionError(
      'unsupported-media',
      'declared media type does not match image bytes',
    );
  }
}

/** Decode bounded base64 image bytes and verify the declared raster signature. */
export function decodeImageRedactionBytes(
  value: unknown,
  type: ImageRedactionMediaType,
): Uint8Array {
  const bytes = decodeImage(value);
  validateSignature(bytes, type);
  return bytes;
}

function imagePolicy(entityTypes: unknown, scoreThreshold: unknown): ImageRedactionPolicy {
  const supplied = entityTypes === undefined ? [...DEFAULT_IMAGE_REDACTION_ENTITIES] : entityTypes;
  if (
    !Array.isArray(supplied) ||
    supplied.length < 1 ||
    supplied.length > IMAGE_REDACTION_LIMITS.maxEntities
  ) {
    throw new ImageRedactionError(
      'invalid-policy',
      'entityTypes must contain between 1 and 32 values',
    );
  }
  const normalized = [
    ...new Set(
      supplied.map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : '')),
    ),
  ].sort();
  if (normalized.some((value) => !ENTITY_TYPE.test(value))) {
    throw new ImageRedactionError(
      'invalid-policy',
      'entityTypes contains an invalid entity identifier',
    );
  }
  const threshold = scoreThreshold === undefined ? 0.65 : scoreThreshold;
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    throw new ImageRedactionError('invalid-policy', 'scoreThreshold must be between 0 and 1');
  }
  return { entityTypes: normalized, scoreThreshold: threshold };
}

/** Decode and validate a client payload before any provider I/O occurs. */
export function parseImageRedactionCommand(
  value: unknown,
  context: Omit<ImageRedactionAuthorization, 'purpose'>,
): ImageRedactionCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImageRedactionError('invalid-body', 'a JSON object is required');
  }
  const body = value as ImageRedactionBody;
  const resolvedMediaType = mediaType(body.mediaType);
  const bytes = decodeImageRedactionBytes(body.imageBase64, resolvedMediaType);
  return {
    bytes,
    mediaType: resolvedMediaType,
    authorization: {
      tenantId: cleanIdentity(context.tenantId, 'tenant'),
      actorId: cleanIdentity(context.actorId, 'actor'),
      purpose: cleanPurpose(body.purpose),
    },
    policy: imagePolicy(body.entityTypes, body.scoreThreshold),
  };
}

/** Aggregate provider findings without accepting text, offsets or coordinates into evidence. */
export function summarizeImageRedactionEntities(
  detections: ReadonlyArray<{ entityType: unknown; score: unknown }>,
  policy: ImageRedactionPolicy,
): ImageRedactionEntityEvidence[] {
  if (detections.length > 10_000) {
    throw new ImageRedactionError(
      'provider-invalid-response',
      'provider returned too many detections',
    );
  }
  const allowed = new Set(policy.entityTypes);
  const grouped = new Map<string, { count: number; maxScore: number }>();
  for (const detection of detections) {
    const entityType =
      typeof detection.entityType === 'string' ? detection.entityType.trim().toUpperCase() : '';
    const score = detection.score;
    if (
      !allowed.has(entityType) ||
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < policy.scoreThreshold ||
      score > 1
    ) {
      throw new ImageRedactionError(
        'provider-invalid-response',
        'provider returned invalid detection evidence',
      );
    }
    const current = grouped.get(entityType) ?? { count: 0, maxScore: 0 };
    grouped.set(entityType, {
      count: current.count + 1,
      maxScore: Math.max(current.maxScore, score),
    });
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entityType, evidence]) => ({ entityType, ...evidence }));
}
