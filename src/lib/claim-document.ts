import { createHash } from 'node:crypto';

export const CLAIM_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CLAIM_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type ClaimDocumentType = (typeof CLAIM_DOCUMENT_TYPES)[number];

export interface ClaimDocumentUploadInput {
  claimId: string;
  idempotencyKey: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface ValidatedClaimDocumentUpload extends ClaimDocumentUploadInput {
  contentType: ClaimDocumentType;
  documentId: string;
  objectKey: string;
  sha256: string;
}

export type ClaimDocumentValidationResult =
  | { ok: true; value: ValidatedClaimDocumentUpload }
  | { ok: false; errors: string[] };

const SAFE_SCOPE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const DOCUMENT_ID = /^[a-f0-9]{64}$/;

export function contentSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function claimDocumentId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex');
}

export function claimDocumentObjectKey(orgId: string, claimId: string, documentId: string): string | null {
  if (!SAFE_SCOPE_ID.test(orgId) || !SAFE_SCOPE_ID.test(claimId) || !DOCUMENT_ID.test(documentId)) return null;
  return `orgs/${orgId}/claims/${claimId}/documents/${documentId}`;
}

function cleanFilename(filename: unknown): string | null {
  if (typeof filename !== 'string') return null;
  const value = filename.trim();
  if (!value || value.length > 160 || /[/\\\u0000-\u001f]/.test(value)) return null;
  return value;
}

export function sniffClaimDocumentType(bytes: Uint8Array): ClaimDocumentType | null {
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

export function validateClaimDocumentUpload(
  input: ClaimDocumentUploadInput,
  orgId: string,
): ClaimDocumentValidationResult {
  const errors: string[] = [];
  if (!SAFE_SCOPE_ID.test(orgId)) errors.push('organization id is not safe for object storage');
  if (!SAFE_SCOPE_ID.test(input.claimId)) errors.push('claimId must be a safe claim identifier');
  if (!SAFE_IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    errors.push('idempotencyKey must be 8-160 letters, numbers, dot, colon, underscore, or dash');
  }
  const filename = cleanFilename(input.filename);
  if (!filename) errors.push('filename must be 1-160 characters without path separators');
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) errors.push('document must not be empty');
  if (input.bytes.length > CLAIM_DOCUMENT_MAX_BYTES) {
    errors.push(`document exceeds the ${CLAIM_DOCUMENT_MAX_BYTES}-byte limit`);
  }
  const sniffed = sniffClaimDocumentType(input.bytes);
  if (!sniffed) errors.push(`document must be one of: ${CLAIM_DOCUMENT_TYPES.join(', ')}`);
  if (sniffed && input.contentType.toLowerCase().split(';')[0]?.trim() !== sniffed) {
    errors.push(`declared contentType does not match detected ${sniffed}`);
  }
  const documentId = claimDocumentId(input.idempotencyKey);
  const objectKey = claimDocumentObjectKey(orgId, input.claimId, documentId);
  if (!objectKey) errors.push('claim document key could not be derived safely');
  if (errors.length > 0 || !filename || !sniffed || !objectKey) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...input,
      filename,
      contentType: sniffed,
      documentId,
      objectKey,
      sha256: contentSha256(input.bytes),
    },
  };
}

export function isClaimDocumentId(value: string): boolean {
  return DOCUMENT_ID.test(value);
}
