import { createHash } from 'node:crypto';
import {
  IMAGE_REDACTION_LIMITS,
  ImageRedactionError,
  decodeImageRedactionBytes,
  summarizeImageRedactionEntities,
  type ImageRedactionCommand,
  type ImageRedactionMediaType,
  type ImageRedactionPort,
  type ImageRedactionResult,
} from '@/lib/image-redaction';

export const PRESIDIO_IMAGE_REDACTOR_VERSION = '0.0.59';
const MAX_PROVIDER_RESPONSE_BYTES =
  Math.ceil((IMAGE_REDACTION_LIMITS.maxBytes * 4) / 3) + 64 * 1024;

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

export interface PresidioImageRedactorConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
}

interface ProviderResponse {
  engine?: unknown;
  engine_version?: unknown;
  ocr_engine?: unknown;
  media_type?: unknown;
  redacted_image_base64?: unknown;
  width?: unknown;
  height?: unknown;
  detections?: unknown;
}

function cleanUrl(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/\/+$/, '');
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString().replace(/\/+$/, '')
      : null;
  } catch {
    return null;
  }
}

export function resolvePresidioImageRedactorConfig(
  env: Env = process.env,
): PresidioImageRedactorConfig {
  const configuredTimeout = Number(env.OFFGRID_PRESIDIO_IMAGE_REDACTOR_TIMEOUT_MS);
  const timeoutMs =
    Number.isInteger(configuredTimeout) && configuredTimeout >= 1_000 && configuredTimeout <= 60_000
      ? configuredTimeout
      : IMAGE_REDACTION_LIMITS.timeoutMs;
  return {
    url: cleanUrl(env.OFFGRID_PRESIDIO_IMAGE_REDACTOR_URL),
    token: env.OFFGRID_PRESIDIO_IMAGE_REDACTOR_TOKEN?.trim() || null,
    timeoutMs,
  };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMediaType(value: unknown): value is ImageRedactionMediaType {
  return value === 'image/png' || value === 'image/jpeg';
}

function positiveInteger(value: unknown, name: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > IMAGE_REDACTION_LIMITS.maxDimension
  ) {
    throw new ImageRedactionError('provider-invalid-response', `provider returned invalid ${name}`);
  }
  return value as number;
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ImageRedactionError(
      'provider-invalid-response',
      'provider response exceeds the configured limit',
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ImageRedactionError(
        'provider-invalid-response',
        'provider response exceeds the configured limit',
      );
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks, total);
}

function providerError(error: unknown): ImageRedactionError {
  if (error instanceof ImageRedactionError) return error;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new ImageRedactionError('provider-timeout', 'image redaction provider timed out');
  }
  return new ImageRedactionError('provider-unavailable', 'image redaction provider is unavailable');
}

function parseProviderResponse(
  raw: Uint8Array,
  command: ImageRedactionCommand,
): {
  bytes: Uint8Array;
  mediaType: ImageRedactionMediaType;
  width: number;
  height: number;
  detections: Array<{ entityType: unknown; score: unknown }>;
} {
  let value: ProviderResponse;
  try {
    value = JSON.parse(Buffer.from(raw).toString('utf8')) as ProviderResponse;
  } catch {
    throw new ImageRedactionError('provider-invalid-response', 'provider returned invalid JSON');
  }
  if (
    value.engine !== 'presidio-image-redactor' ||
    value.engine_version !== PRESIDIO_IMAGE_REDACTOR_VERSION ||
    value.ocr_engine !== 'tesseract' ||
    !isMediaType(value.media_type) ||
    value.media_type !== command.mediaType ||
    !Array.isArray(value.detections)
  ) {
    throw new ImageRedactionError(
      'provider-invalid-response',
      'provider returned an incompatible contract',
    );
  }
  const width = positiveInteger(value.width, 'width');
  const height = positiveInteger(value.height, 'height');
  if (width * height > IMAGE_REDACTION_LIMITS.maxPixels) {
    throw new ImageRedactionError(
      'provider-invalid-response',
      'provider output exceeds the pixel limit',
    );
  }
  const bytes = decodeImageRedactionBytes(value.redacted_image_base64, value.media_type);
  const detections = value.detections.map((item) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return { entityType: record.entity_type, score: record.score };
  });
  return { bytes, mediaType: value.media_type, width, height, detections };
}

export function createPresidioImageRedactor(
  config: PresidioImageRedactorConfig = resolvePresidioImageRedactorConfig(),
  fetcher: Fetcher = fetch,
): ImageRedactionPort {
  return {
    async redact(command: ImageRedactionCommand): Promise<ImageRedactionResult> {
      if (!config.url || !config.token) {
        throw new ImageRedactionError(
          'not-configured',
          'image redaction provider is not configured',
        );
      }
      const started = performance.now();
      let response: Response;
      try {
        response = await fetcher(`${config.url}/v1/redact`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${config.token}`,
            'content-type': command.mediaType,
            'x-offgrid-entity-types': command.policy.entityTypes.join(','),
            'x-offgrid-score-threshold': String(command.policy.scoreThreshold),
          },
          body: Buffer.from(command.bytes),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        throw providerError(error);
      }
      if (!response.ok) {
        throw new ImageRedactionError(
          'provider-unavailable',
          `image redaction provider failed with status ${response.status}`,
        );
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new ImageRedactionError(
          'provider-invalid-response',
          'provider returned an unsupported content type',
        );
      }
      let parsed;
      try {
        parsed = parseProviderResponse(await readBoundedResponse(response), command);
      } catch (error) {
        throw providerError(error);
      }
      const entities = summarizeImageRedactionEntities(parsed.detections, command.policy);
      const inputSha256 = sha256(command.bytes);
      const outputSha256 = sha256(parsed.bytes);
      if (entities.length > 0 && inputSha256 === outputSha256) {
        throw new ImageRedactionError(
          'provider-invalid-response',
          'provider reported detections without redacting the image',
        );
      }
      const receiptMaterial = JSON.stringify({
        tenantId: command.authorization.tenantId,
        actorId: command.authorization.actorId,
        purpose: command.authorization.purpose,
        entityTypes: command.policy.entityTypes,
        scoreThreshold: command.policy.scoreThreshold,
        inputSha256,
        outputSha256,
      });
      return {
        redactedBytes: parsed.bytes,
        mediaType: parsed.mediaType,
        evidence: {
          engine: 'Microsoft Presidio image-redactor',
          engineVersion: PRESIDIO_IMAGE_REDACTOR_VERSION,
          ocrEngine: 'Tesseract',
          inputSha256,
          outputSha256,
          inputBytes: command.bytes.byteLength,
          outputBytes: parsed.bytes.byteLength,
          width: parsed.width,
          height: parsed.height,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          entities,
          policy: {
            receiptId: `imgred_${sha256(receiptMaterial)}`,
            tenantId: command.authorization.tenantId,
            actorId: command.authorization.actorId,
            purpose: command.authorization.purpose,
            entityTypes: [...command.policy.entityTypes],
            scoreThreshold: command.policy.scoreThreshold,
          },
        },
      };
    },
  };
}
