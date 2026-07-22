import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { langfusePrompts as port } from '@/lib/adapters/langfuse-prompts';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// One Langfuse prompt. GET returns the name's meta (all versions + labels) plus one selected version's
// body (?version= or ?label=, else production). DELETE removes a prompt, one version (?version=), or
// every version carrying a label (?label=).
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  if (!port.configured()) return NextResponse.json({ configured: false, detail: null });
  const url = new URL(req.url);
  try {
    const detail = await port.detail(decodeURIComponent(name), {
      version: url.searchParams.get('version'),
      label: url.searchParams.get('label'),
    });
    return NextResponse.json({ configured: true, detail });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ configured: true, detail: null, error: (e as Error).message }, { status });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  if (!port.configured()) return NextResponse.json({ error: 'Langfuse not configured' }, { status: 503 });
  const url = new URL(req.url);
  const decoded = decodeURIComponent(name);
  try {
    await port.remove(decoded, {
      version: url.searchParams.get('version'),
      label: url.searchParams.get('label'),
    });
    auditFromSession(gate, await currentOrgId(), {
      action: 'observability.prompt.delete',
      resource: `prompt:${decoded}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
