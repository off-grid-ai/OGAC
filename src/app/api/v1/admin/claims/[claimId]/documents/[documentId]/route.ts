import { NextResponse } from 'next/server';
import { readClaimDocument } from '@/lib/adapters/claim-documents';
import { auditFromSession } from '@/lib/audit-actor';
import { requireUser } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ claimId: string; documentId: string }> },
) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const [{ claimId, documentId }, orgId] = await Promise.all([params, currentOrgId()]);
  const result = await readClaimDocument(orgId, claimId, documentId);
  if (!result.ok) {
    auditFromSession(gate, orgId, {
      action: 'claim.document.read',
      resource: `claim:${claimId}/document:${documentId}`,
      outcome: result.code === 'not-found' ? 'blocked' : 'error',
    });
    return NextResponse.json(
      { error: result.message },
      { status: result.code === 'not-found' ? 404 : 502 },
    );
  }

  auditFromSession(gate, orgId, {
    action: 'claim.document.read',
    resource: `claim:${claimId}/document:${documentId}`,
    outcome: 'ok',
  });

  if (new URL(req.url).searchParams.get('meta') === '1') {
    return NextResponse.json({ meta: result.meta, receipt: result.receipt });
  }
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      'content-type': result.meta.mime,
      'content-length': String(result.bytes.length),
      'content-disposition': `inline; filename="${result.meta.name.replaceAll('"', '')}"`,
      'cache-control': 'private, no-store',
      'x-offgrid-content-sha256': result.receipt.sha256,
      'x-offgrid-provenance-algorithm': result.receipt.algorithm,
      'x-offgrid-provenance-signature': result.receipt.signature,
    },
  });
}
