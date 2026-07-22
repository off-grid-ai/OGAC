import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import {
  deleteKafkaSource,
  getKafkaSource,
  KafkaSourceOnboardingError,
  updateKafkaSource,
} from '@/lib/adapters/kafka-source-onboarding';
import { requireAdmin } from '@/lib/authz';
import type { KafkaSourceInput } from '@/lib/kafka-source-onboarding';
import { currentOrgId } from '@/lib/tenancy';

function failure(error: unknown): NextResponse {
  if (!(error instanceof KafkaSourceOnboardingError)) {
    return NextResponse.json({ error: 'The Kafka source request failed.' }, { status: 500 });
  }
  const status =
    error.code === 'invalid-input' || error.code === 'not-kafka'
      ? 400
      : error.code === 'unknown-source'
        ? 404
        : error.code === 'ambiguous-binding'
          ? 409
          : 502;
  return NextResponse.json(
    { error: error.message, ...(Object.keys(error.fields).length ? { fields: error.fields } : {}) },
    { status },
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  try {
    return NextResponse.json(await getKafkaSource(id, await currentOrgId()));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as KafkaSourceInput | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Enter the source details and try again.' }, { status: 400 });
  }
  const { id } = await params;
  const orgId = await currentOrgId();
  try {
    const source = await updateKafkaSource(id, body, orgId);
    auditFromSession(gate, orgId, {
      action: 'kafka-source.update',
      resource: `connector:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json(source);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  try {
    await deleteKafkaSource(id, orgId);
    auditFromSession(gate, orgId, {
      action: 'kafka-source.delete',
      resource: `connector:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
