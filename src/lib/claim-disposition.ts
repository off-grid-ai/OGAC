import { createHash } from 'node:crypto';

export const CLAIM_DISPOSITIONS = [
  'approve',
  'repudiate',
  'request-documents',
  'escalate-review',
] as const;
export const CLAIM_AUTHORITY_BASES = [
  'manual-review',
  'documents-complete',
  'medical-review',
  'fraud-investigation',
] as const;

export type ClaimDisposition = (typeof CLAIM_DISPOSITIONS)[number];
export type ClaimAuthorityBasis = (typeof CLAIM_AUTHORITY_BASES)[number];

export interface ClaimDispositionInput {
  claimId: string;
  idempotencyKey: string;
  disposition: ClaimDisposition;
  authority: {
    basis: ClaimAuthorityBasis;
    reference: string;
    reason: string;
  };
}

export interface ValidatedClaimDisposition extends ClaimDispositionInput {
  sourceStatus: 'approved' | 'repudiated' | 'documents_pending' | 'under_review';
  commandHash: string;
}

export type ClaimDispositionValidationResult =
  | { ok: true; value: ValidatedClaimDisposition }
  | { ok: false; errors: string[] };

const SAFE_CLAIM_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

const SOURCE_STATUS: Record<ClaimDisposition, ValidatedClaimDisposition['sourceStatus']> = {
  approve: 'approved',
  repudiate: 'repudiated',
  'request-documents': 'documents_pending',
  'escalate-review': 'under_review',
};

function commandCore(input: Omit<ValidatedClaimDisposition, 'commandHash'>) {
  return {
    claimId: input.claimId,
    idempotencyKey: input.idempotencyKey,
    disposition: input.disposition,
    authority: input.authority,
    sourceStatus: input.sourceStatus,
  };
}

export function claimDispositionCommandHash(
  input: Omit<ValidatedClaimDisposition, 'commandHash'>,
): string {
  return createHash('sha256').update(JSON.stringify(commandCore(input))).digest('hex');
}

export function validateClaimDisposition(input: unknown): ClaimDispositionValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const claimId = typeof raw.claimId === 'string' ? raw.claimId.trim() : '';
  if (!SAFE_CLAIM_ID.test(claimId)) errors.push('claimId must be a safe claim identifier');
  const idempotencyKey = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey.trim() : '';
  if (!SAFE_IDEMPOTENCY_KEY.test(idempotencyKey)) {
    errors.push('idempotencyKey must be 8-160 letters, numbers, dot, colon, underscore, or dash');
  }
  const disposition = raw.disposition as ClaimDisposition;
  if (!(CLAIM_DISPOSITIONS as readonly unknown[]).includes(disposition)) {
    errors.push(`disposition must be one of: ${CLAIM_DISPOSITIONS.join(', ')}`);
  }
  const authorityRaw = raw.authority;
  if (!authorityRaw || typeof authorityRaw !== 'object' || Array.isArray(authorityRaw)) {
    errors.push('authority must be an object');
  }
  const authority = (authorityRaw ?? {}) as Record<string, unknown>;
  const basis = authority.basis as ClaimAuthorityBasis;
  if (!(CLAIM_AUTHORITY_BASES as readonly unknown[]).includes(basis)) {
    errors.push(`authority.basis must be one of: ${CLAIM_AUTHORITY_BASES.join(', ')}`);
  }
  const reference = typeof authority.reference === 'string' ? authority.reference.trim() : '';
  if (reference.length < 4 || reference.length > 120) {
    errors.push('authority.reference must be 4-120 characters');
  }
  const reason = typeof authority.reason === 'string' ? authority.reason.trim() : '';
  if (reason.length < 10 || reason.length > 500) {
    errors.push('authority.reason must be 10-500 characters');
  }
  if (errors.length > 0) return { ok: false, errors };

  const valueWithoutHash = {
    claimId,
    idempotencyKey,
    disposition,
    authority: { basis, reference, reason },
    sourceStatus: SOURCE_STATUS[disposition],
  };
  return {
    ok: true,
    value: {
      ...valueWithoutHash,
      commandHash: claimDispositionCommandHash(valueWithoutHash),
    },
  };
}

export type ClaimTransitionVerdict = 'apply' | 'already-applied' | 'terminal';

export function claimTransitionVerdict(
  currentStatus: string,
  targetStatus: ValidatedClaimDisposition['sourceStatus'],
): ClaimTransitionVerdict {
  if (currentStatus === targetStatus) return 'already-applied';
  if (['approved', 'repudiated', 'settled'].includes(currentStatus)) return 'terminal';
  return 'apply';
}

export function reasonHash(reason: string): string {
  return createHash('sha256').update(reason).digest('hex');
}
