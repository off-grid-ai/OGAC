import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { langfusePrompts as port } from '@/lib/adapters/langfuse-prompts';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { buildLabelUpdateBody } from '@/lib/langfuse-prompts';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Set the deployment labels on ONE prompt version (e.g. promote v3 to `production`). Langfuse keeps
// labels unique across versions, so setting `production` here moves it off whatever version had it.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ name: string; version: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name, version } = await params;
  if (!port.configured()) return NextResponse.json({ error: 'Langfuse not configured' }, { status: 503 });
  const versionNum = Number(version);
  if (!Number.isInteger(versionNum) || versionNum <= 0)
    return NextResponse.json({ error: 'bad version' }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { newLabels?: unknown } | null;
  const shaped = buildLabelUpdateBody(body?.newLabels);
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });
  const decoded = decodeURIComponent(name);
  try {
    const updated = await port.setVersionLabels(decoded, versionNum, shaped.value.newLabels);
    auditFromSession(gate, await currentOrgId(), {
      action: 'observability.prompt.label',
      resource: `prompt:${decoded}@${versionNum} → [${shaped.value.newLabels.join(', ')}]`,
      outcome: 'ok',
    });
    return NextResponse.json({ version: updated });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
