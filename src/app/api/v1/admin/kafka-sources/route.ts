import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { createKafkaSource, KafkaSourceOnboardingError } from '@/lib/adapters/kafka-source-onboarding';
import { requireAdmin } from '@/lib/authz';
import type { KafkaSourceInput } from '@/lib/kafka-source-onboarding';
import { currentOrgId } from '@/lib/tenancy';

function failure(error: unknown): NextResponse {
  if (!(error instanceof KafkaSourceOnboardingError)) {
    return NextResponse.json({ error: 'The Kafka source could not be saved.' }, { status: 500 });
  }
  const status = error.code === 'invalid-input' ? 400 : error.code === 'ambiguous-binding' ? 409 : 502;
  return NextResponse.json(
    { error: error.message, ...(Object.keys(error.fields).length ? { fields: error.fields } : {}) },
    { status },
  );
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as KafkaSourceInput | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Enter the source details and try again.' }, { status: 400 });
  }
  const orgId = await currentOrgId();
  try {
    const source = await createKafkaSource(body, orgId);
    auditFromSession(gate, orgId, {
      action: 'kafka-source.create',
      resource: `connector:${source.connectorId}`,
      outcome: 'ok',
    });
    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
