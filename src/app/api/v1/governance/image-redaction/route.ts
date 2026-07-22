import { NextResponse } from 'next/server';
import { actorFromSession, auditFromSession } from '@/lib/audit-actor';
import { createPresidioImageRedactor } from '@/lib/adapters/presidio-image-redaction';
import { requireWriter } from '@/lib/authz';
import {
  IMAGE_REDACTION_MAX_REQUEST_BYTES,
  ImageRedactionError,
  parseImageRedactionCommand,
} from '@/lib/image-redaction';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

async function readBoundedJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_REDACTION_MAX_REQUEST_BYTES) {
    throw new ImageRedactionError('image-too-large', 'request exceeds the image redaction limit');
  }
  if (!req.body) throw new ImageRedactionError('invalid-body', 'a JSON body is required');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > IMAGE_REDACTION_MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new ImageRedactionError('image-too-large', 'request exceeds the image redaction limit');
    }
    chunks.push(next.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    throw new ImageRedactionError('invalid-body', 'invalid JSON body');
  }
}

function errorResponse(error: unknown): NextResponse {
  if (!(error instanceof ImageRedactionError)) {
    return NextResponse.json(
      { error: 'image redaction failed', code: 'provider-unavailable' },
      { status: 503 },
    );
  }
  const status = {
    'invalid-body': 400,
    'invalid-policy': 400,
    'image-too-large': 413,
    'unsupported-media': 415,
    'not-configured': 503,
    'provider-timeout': 504,
    'provider-unavailable': 503,
    'provider-invalid-response': 502,
  }[error.code];
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const tenantId = await currentOrgId();
    const actorId = actorFromSession(gate).id;
    const command = parseImageRedactionCommand(await readBoundedJson(req), { tenantId, actorId });
    const result = await createPresidioImageRedactor().redact(command);
    const count = result.evidence.entities.reduce((sum, entity) => sum + entity.count, 0);
    auditFromSession(gate, tenantId, {
      action: 'governance.image.redact',
      resource: `${result.evidence.policy.receiptId} entities:${count}`,
      outcome: count > 0 ? 'redacted' : 'ok',
    });
    return NextResponse.json(
      {
        redactedImageBase64: Buffer.from(result.redactedBytes).toString('base64'),
        mediaType: result.mediaType,
        evidence: result.evidence,
      },
      { status: 200, headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
