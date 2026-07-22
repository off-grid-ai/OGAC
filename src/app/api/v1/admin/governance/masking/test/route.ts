import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { anonymizeWithPolicy } from '@/lib/adapters/presidio-anonymize';
import { degradeOn503 } from '@/lib/route-degrade';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Live test of the org's anonymizer operator policy: POST { text } → run the real analyze →
// anonymize flow (honoring per-entity operators) and return the masked terminal artifact + the
// per-item operator breakdown + honest engine status. Nothing is stored. Admin-gated, thin.

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { text?: unknown } | null;
  if (!b || typeof b.text !== 'string' || !b.text.trim()) {
    return NextResponse.json({ error: 'text (string) required' }, { status: 400 });
  }
  const orgId = await currentOrgId();
  return degradeOn503(async () => NextResponse.json(await anonymizeWithPolicy(b.text as string, orgId)));
}
