import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { validateModule } from '@/lib/opa-policy';
import { formatCompileErrors, slugifyModuleId, validateRegoModule } from '@/lib/opa-policy-policy';

export const dynamic = 'force-dynamic';

// Action: validate Rego WITHOUT deploying it. OPA has no dry-run compile endpoint, so this PUTs the
// source under a scratch id, reads the compile result, and cleans up — surfacing OPA's own compile
// diagnostics. Lets an operator check syntax before committing to a real module id.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const candidate = {
    id: (body?.id as string) || slugifyModuleId((body?.title as string) ?? '') || 'draft',
    rego: body?.rego,
  };
  const parsed = validateRegoModule(candidate);
  if (!parsed.ok || !parsed.value) {
    return NextResponse.json({ valid: false, error: parsed.errors.join('; ') }, { status: 400 });
  }
  const result = await validateModule(parsed.value);
  if (result.status === 'deployed') {
    return NextResponse.json({ valid: true, reason: 'Rego compiles cleanly' });
  }
  if (result.status === 'invalid') {
    return NextResponse.json({
      valid: false,
      error: formatCompileErrors(result.errors),
      errors: result.errors,
    });
  }
  return NextResponse.json({ valid: false, error: result.reason, reachable: false }, { status: 502 });
}
