import { NextResponse } from 'next/server';
import { writeClaimDocument } from '@/lib/adapters/claim-documents';
import { auditFromSession } from '@/lib/audit-actor';
import { requireUser } from '@/lib/authz';
import { CLAIM_DOCUMENT_MAX_BYTES } from '@/lib/claim-document';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = CLAIM_DOCUMENT_MAX_BYTES + 1024 * 1024;

// Multipart fields: file + idempotencyKey. The route derives tenant and actor from the verified
// principal; neither can be supplied by the client.
export async function POST(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'request is too large' }, { status: 413 });
  }

  const [{ claimId }, orgId, form] = await Promise.all([
    params,
    currentOrgId(),
    req.formData().catch(() => null),
  ]);
  const file = form?.get('file');
  const idempotencyKey = form?.get('idempotencyKey');
  if (!(file instanceof File) || typeof idempotencyKey !== 'string') {
    return NextResponse.json({ error: 'file and idempotencyKey are required' }, { status: 400 });
  }
  if (file.size > CLAIM_DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: `document exceeds the ${CLAIM_DOCUMENT_MAX_BYTES}-byte limit` }, { status: 413 });
  }

  const result = await writeClaimDocument(
    {
      claimId,
      idempotencyKey,
      filename: file.name,
      contentType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    },
    orgId,
    gate.user.email ?? gate.user.name ?? 'unknown',
  );
  if (!result.ok) {
    auditFromSession(gate, orgId, {
      action: 'claim.document.write',
      resource: `claim:${claimId}`,
      outcome: result.code === 'invalid-document' || result.code === 'idempotency-conflict' ? 'blocked' : 'error',
    });
    const status = result.code === 'invalid-document'
      ? 400
      : result.code === 'idempotency-conflict'
        ? 409
        : 502;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  auditFromSession(gate, orgId, {
    action: 'claim.document.write',
    resource: `claim:${claimId}/document:${result.receipt.documentId}`,
    outcome: 'ok',
  });
  return NextResponse.json(result, { status: result.receipt.replayed ? 200 : 201 });
}
