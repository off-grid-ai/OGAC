import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteModule, deployModule, getModule } from '@/lib/opa-policy';
import { formatCompileErrors, validateRegoModule } from '@/lib/opa-policy-policy';

export const dynamic = 'force-dynamic';

// OPA Rego-module item: read one module's source (GET), update+redeploy it (PUT — OPA recompiles),
// or delete it (DELETE). The id in the path is authoritative; a body id is ignored to prevent an
// edit from silently forking to a new module.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const res = await getModule(id);
  if (!res.reachable) {
    return NextResponse.json({ error: res.reason, reachable: false }, { status: 502 });
  }
  if (!res.module) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(res.module);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateRegoModule({ id, rego: body?.rego });
  if (!parsed.ok || !parsed.value) {
    return NextResponse.json({ error: parsed.errors.join('; ') }, { status: 400 });
  }
  const result = await deployModule(parsed.value);
  if (result.status === 'invalid') {
    return NextResponse.json(
      { error: formatCompileErrors(result.errors), errors: result.errors },
      { status: 400 },
    );
  }
  if (result.status === 'unreachable') {
    return NextResponse.json({ error: result.reason, reachable: false }, { status: 502 });
  }
  return NextResponse.json(result.module);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const res = await deleteModule(id);
  if (!res.reachable) {
    return NextResponse.json({ error: res.reason, reachable: false }, { status: 502 });
  }
  return NextResponse.json({ deleted: res.deleted });
}
