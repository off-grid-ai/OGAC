import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { validatePolicyRule } from '@/lib/policy-rules-policy';
import { createPolicyRule, listPolicyRules } from '@/lib/policy-rules';
import { currentOrgId } from '@/lib/tenancy';

// Console-owned policy-rule collection: list + create. Thin — validation is the pure module,
// persistence is the I/O lib. Separate from the org-bundle push route (../route.ts).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listPolicyRules(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const result = validatePolicyRule(body);
  if (!result.ok || !result.value) {
    return NextResponse.json({ error: result.errors.join('; ') }, { status: 400 });
  }
  return NextResponse.json(await createPolicyRule(result.value, await currentOrgId()), {
    status: 201,
  });
}
