import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { type AuthzSession, requireAdmin } from '@/lib/authz';
import { getAnonymizerPolicy, setAnonymizerPolicy } from '@/lib/presidio-anonymizer-policy-store';
import { validateAnonymizerPolicy } from '@/lib/presidio-anonymizers';
import { degradeOn503 } from '@/lib/route-degrade';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Per-org Presidio anonymizer OPERATOR policy. GET returns { default, perEntity }; PUT validates
// (each entity → a supported operator + params) then upserts. This decides HOW each detected entity
// is masked (mask/redact/hash/encrypt/replace/keep) on the data-movement anonymize path — it does
// NOT change detection (recognizers/thresholds) or the fleet-owned LLM Guard content policy. Thin:
// admin-gated, validate via the pure lib, delegate to the store, audit the write.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return degradeOn503(async () =>
    NextResponse.json(await getAnonymizerPolicy(await currentOrgId())),
  );
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const parsed = validateAnonymizerPolicy(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const orgId = await currentOrgId();
  return degradeOn503(async () => {
    const saved = await setAnonymizerPolicy(parsed.value, orgId);
    auditFromSession(gate as AuthzSession, orgId, {
      action: 'governance.masking.policy.update',
      resource: 'presidio:anonymizer-policy',
      outcome: 'ok',
    });
    return NextResponse.json(saved);
  });
}
