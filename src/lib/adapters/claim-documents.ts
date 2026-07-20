import { getSigning } from '@/lib/adapters/registry';
import {
  claimDocumentObjectKey,
  contentSha256,
  isClaimDocumentId,
  validateClaimDocumentUpload,
  type ClaimDocumentUploadInput,
} from '@/lib/claim-document';
import {
  getFileMeta,
  putObjectIfAbsent,
  readFileBytes,
  type FileMeta,
} from '@/lib/files';

export type ClaimDocumentErrorCode =
  | 'invalid-document'
  | 'idempotency-conflict'
  | 'not-found'
  | 'storage-error';

export interface ClaimDocumentReceipt {
  operation: 'write' | 'read';
  orgId: string;
  claimId: string;
  documentId: string;
  objectKey: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  replayed: boolean;
  signedAt: string;
  algorithm: string;
  publicKey: string | null;
  signature: string;
}

export type ClaimDocumentWriteResult =
  | { ok: true; receipt: ClaimDocumentReceipt }
  | { ok: false; code: ClaimDocumentErrorCode; message: string };

export type ClaimDocumentReadResult =
  | { ok: true; bytes: Buffer; meta: FileMeta; receipt: ClaimDocumentReceipt }
  | { ok: false; code: ClaimDocumentErrorCode; message: string };

function signedReceipt(input: Omit<ClaimDocumentReceipt, 'algorithm' | 'publicKey' | 'signature'>): ClaimDocumentReceipt {
  const signing = getSigning();
  return {
    ...input,
    algorithm: signing.algorithm,
    publicKey: signing.publicKey(),
    signature: signing.sign(input),
  };
}

function receiptFor(
  operation: 'write' | 'read',
  orgId: string,
  claimId: string,
  documentId: string,
  objectKey: string,
  meta: FileMeta,
  bytes: Buffer,
  replayed: boolean,
  now: () => Date,
): ClaimDocumentReceipt {
  return signedReceipt({
    operation,
    orgId,
    claimId,
    documentId,
    objectKey,
    filename: meta.name,
    contentType: meta.mime,
    size: bytes.length,
    sha256: contentSha256(bytes),
    replayed,
    signedAt: now().toISOString(),
  });
}

export async function writeClaimDocument(
  input: ClaimDocumentUploadInput,
  orgId: string,
  owner: string,
  now: () => Date = () => new Date(),
): Promise<ClaimDocumentWriteResult> {
  const validated = validateClaimDocumentUpload(input, orgId);
  if (!validated.ok) {
    return { ok: false, code: 'invalid-document', message: validated.errors.join(' ') };
  }
  const document = validated.value;
  try {
    const outcome = await putObjectIfAbsent(
      document.objectKey,
      document.bytes,
      document.contentType,
      { name: document.filename, owner, visibility: 'private' },
    );
    const [existingBytes, meta] = await Promise.all([
      readFileBytes(document.objectKey),
      getFileMeta(document.objectKey),
    ]);
    if (!existingBytes || !meta) {
      return { ok: false, code: 'storage-error', message: 'claim document could not be verified after write' };
    }
    const sameCommand =
      contentSha256(existingBytes) === document.sha256 &&
      meta.name === document.filename &&
      meta.mime === document.contentType;
    if (!sameCommand) {
      return {
        ok: false,
        code: 'idempotency-conflict',
        message: 'idempotency key already belongs to a different claim document',
      };
    }
    return {
      ok: true,
      receipt: receiptFor(
        'write', orgId, document.claimId, document.documentId, document.objectKey,
        meta, existingBytes, outcome === 'exists', now,
      ),
    };
  } catch (error) {
    return {
      ok: false,
      code: 'storage-error',
      message: error instanceof Error ? error.message : 'claim document storage failed',
    };
  }
}

export async function readClaimDocument(
  orgId: string,
  claimId: string,
  documentId: string,
  now: () => Date = () => new Date(),
): Promise<ClaimDocumentReadResult> {
  if (!isClaimDocumentId(documentId)) {
    return { ok: false, code: 'not-found', message: 'claim document was not found' };
  }
  const objectKey = claimDocumentObjectKey(orgId, claimId, documentId);
  if (!objectKey) return { ok: false, code: 'not-found', message: 'claim document was not found' };
  try {
    const [bytes, meta] = await Promise.all([readFileBytes(objectKey), getFileMeta(objectKey)]);
    if (!bytes || !meta || meta.visibility !== 'private') {
      return { ok: false, code: 'not-found', message: 'claim document was not found' };
    }
    return {
      ok: true,
      bytes,
      meta,
      receipt: receiptFor('read', orgId, claimId, documentId, objectKey, meta, bytes, false, now),
    };
  } catch {
    return { ok: false, code: 'storage-error', message: 'claim document storage is unavailable' };
  }
}
