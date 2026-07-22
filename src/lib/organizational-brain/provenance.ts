import {
  assertBrainAuthorization,
  BrainPolicyError,
  type BrainAuthorizationContext,
  type BrainDocument,
} from './contracts';

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const MAX_VERSION_LENGTH = 128;

export type TrustedBrainProvenance = Readonly<{
  tenantId: string;
  documentId: string;
  version: string;
  checksum: string;
}>;

function validateDocumentProvenance(document: BrainDocument): void {
  if (!document.id.trim()) throw new BrainPolicyError('document id is required for provenance');
  if (!document.version.trim() || document.version.length > MAX_VERSION_LENGTH) {
    throw new BrainPolicyError('document version is missing or too long');
  }
  if (!CHECKSUM_PATTERN.test(document.checksum)) {
    throw new BrainPolicyError('document checksum must be a lowercase SHA-256 digest');
  }
}

/** A stable OGAC-owned citation target. The original source URI remains a separate receipt field. */
export function buildBrainProvenanceUri(
  context: BrainAuthorizationContext,
  document: BrainDocument,
): string {
  assertBrainAuthorization(context);
  validateDocumentProvenance(document);
  const url = new URL(
    `offgrid://organizational-brain/${encodeURIComponent(context.tenantId)}/documents/${encodeURIComponent(document.id)}`,
  );
  url.searchParams.set('version', document.version);
  url.searchParams.set('checksum', document.checksum);
  return url.toString();
}

/**
 * Parse provenance only for response enrichment. This output never grants access and callers must
 * retain an unrecognized link as an ordinary, untrusted provider link.
 */
export function parseTrustedBrainProvenanceUri(
  context: BrainAuthorizationContext,
  value: string | null | undefined,
): TrustedBrainProvenance | null {
  assertBrainAuthorization(context);
  if (!value) return null;
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [tenantId, documentsSegment, documentId, ...rest] = segments;
    const version = url.searchParams.get('version') ?? '';
    const checksum = url.searchParams.get('checksum') ?? '';
    if (
      url.protocol !== 'offgrid:' ||
      url.hostname !== 'organizational-brain' ||
      tenantId !== context.tenantId ||
      documentsSegment !== 'documents' ||
      !documentId ||
      rest.length ||
      !version ||
      version.length > MAX_VERSION_LENGTH ||
      !CHECKSUM_PATTERN.test(checksum)
    ) {
      return null;
    }
    return Object.freeze({ tenantId, documentId, version, checksum });
  } catch {
    return null;
  }
}
