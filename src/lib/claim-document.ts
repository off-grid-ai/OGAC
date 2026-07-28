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
  { ok: true; value: ValidatedClaimDocumentUpload } | { ok: false; errors: string[] };

const SAFE_SCOPE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const DOCUMENT_ID = /^[a-f0-9]{64}$/;

export function contentSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function claimDocumentId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex');
}

export function claimDocumentObjectKey(
  orgId: string,
  claimId: string,
  documentId: string,
): string | null {
  if (!SAFE_SCOPE_ID.test(orgId) || !SAFE_SCOPE_ID.test(claimId) || !DOCUMENT_ID.test(documentId))
    return null;
  return `orgs/${orgId}/claims/${claimId}/documents/${documentId}`;
}

function cleanFilename(filename: unknown): string | null {
  if (typeof filename !== 'string') return null;
  const value = filename.trim();
  if (!value || value.length > 160 || /[/\\\u0000-\u001f]/.test(value)) return null;
  return value;
}

/**
 * File signatures, as data. The type is decided by the BYTES, never by the declared contentType —
 * a caller can claim anything, and an uploaded executable renamed to .pdf must not be accepted.
 */
const CLAIM_DOCUMENT_SIGNATURES: ReadonlyArray<{ type: ClaimDocumentType; magic: readonly number[] }> = [
  { type: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
];

export function sniffClaimDocumentType(bytes: Uint8Array): ClaimDocumentType | null {
  const hit = CLAIM_DOCUMENT_SIGNATURES.find(
    (sig) => bytes.length >= sig.magic.length && sig.magic.every((b, i) => bytes[i] === b),
  );
  return hit ? hit.type : null;
}

/** Problems with the identifiers this document would be stored under. PURE. */
function identifierErrors(input: ClaimDocumentUploadInput, orgId: string): string[] {
  const errors: string[] = [];
  if (!SAFE_SCOPE_ID.test(orgId)) errors.push('organization id is not safe for object storage');
  if (!SAFE_SCOPE_ID.test(input.claimId)) errors.push('claimId must be a safe claim identifier');
  if (!SAFE_IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    errors.push('idempotencyKey must be 8-160 letters, numbers, dot, colon, underscore, or dash');
  }
  return errors;
}

/** Problems with the bytes themselves and how they were declared. PURE. */
function contentErrors(
  input: ClaimDocumentUploadInput,
  filename: string | null,
  sniffed: ClaimDocumentType | null,
): string[] {
  const errors: string[] = [];
  if (!filename) errors.push('filename must be 1-160 characters without path separators');
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    errors.push('document must not be empty');
  }
  if (input.bytes.length > CLAIM_DOCUMENT_MAX_BYTES) {
    errors.push(`document exceeds the ${CLAIM_DOCUMENT_MAX_BYTES}-byte limit`);
  }
  if (!sniffed) {
    errors.push(`document must be one of: ${CLAIM_DOCUMENT_TYPES.join(', ')}`);
    return errors;
  }
  // The declared type must AGREE with the sniffed one. Mismatch is rejected rather than silently
  // corrected, because a caller lying about content type is a signal, not a typo to paper over.
  if (declaredType(input.contentType) !== sniffed) {
    errors.push(`declared contentType does not match detected ${sniffed}`);
  }
  return errors;
}

/** The bare media type from a Content-Type header, without parameters. */
function declaredType(contentType: string): string {
  return contentType.toLowerCase().split(';')[0]?.trim() ?? '';
}

export function validateClaimDocumentUpload(
  input: ClaimDocumentUploadInput,
  orgId: string,
): ClaimDocumentValidationResult {
  const filename = cleanFilename(input.filename);
  const sniffed = sniffClaimDocumentType(input.bytes);
  const documentId = claimDocumentId(input.idempotencyKey);
  const objectKey = claimDocumentObjectKey(orgId, input.claimId, documentId);

  // Collect EVERY problem rather than failing on the first: an uploader fixing one field at a time
  // through four round-trips is a worse surface than being told all four at once.
  const errors = [
    ...identifierErrors(input, orgId),
    ...contentErrors(input, filename, sniffed),
    ...(objectKey ? [] : ['claim document key could not be derived safely']),
  ];
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
