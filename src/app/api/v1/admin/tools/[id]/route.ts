import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteTool, setToolEnabled, setToolPolicy, updateTool, type ToolPolicy } from '@/lib/store';

const POLICIES = ['allow', 'approval', 'blocked'];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as
    | { enabled?: unknown; policy?: unknown; name?: unknown; endpoint?: unknown; description?: unknown }
    | null;
  if (b && typeof b.policy === 'string' && POLICIES.includes(b.policy)) {
    await setToolPolicy(id, b.policy as ToolPolicy);
    return NextResponse.json({ ok: true });
  }
  if (b && typeof b.enabled === 'boolean') {
    await setToolEnabled(id, b.enabled);
    return NextResponse.json({ ok: true });
  }
  // Field edit — name / endpoint / description (any subset). Distinct from the enable/policy toggles.
  if (
    b &&
    (typeof b.name === 'string' || typeof b.endpoint === 'string' || typeof b.description === 'string')
  ) {
    if (typeof b.name === 'string' && !b.name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    await updateTool(id, {
      name: typeof b.name === 'string' ? b.name : undefined,
      endpoint: typeof b.endpoint === 'string' ? b.endpoint : undefined,
      description: typeof b.description === 'string' ? b.description : undefined,
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    { error: 'enabled (boolean), policy (allow|approval|blocked), or name/endpoint/description required' },
    { status: 400 },
  );
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteTool(id);
  return NextResponse.json({ ok: true });
}
