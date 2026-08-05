import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { langfusePrompts as port } from '@/lib/adapters/langfuse-prompts';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { buildCreatePromptBody, type CreatePromptInput } from '@/lib/langfuse-prompts';
import { orgTag } from '@/lib/langfuse-tenancy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Langfuse-native prompt registry. GET lists prompts (honest `configured` flag when Langfuse isn't
// wired); POST creates a prompt or a new version (Langfuse upserts by name).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!port.configured()) return NextResponse.json({ configured: false, prompts: [] });
  const url = new URL(req.url);
  try {
    // The `tag` filter is NO LONGER caller-supplied. Ownership is expressed as the tag `org:<orgId>`, so
    // forwarding a caller's `?tag=` let anyone ask for another tenant's prompts by name — and with no
    // tag at all, this endpoint returned every tenant's. The org comes from the session's tenant
    // binding, and the caller's own `tag` parameter is deliberately dropped rather than validated.
    const prompts = await port.list({
      name: url.searchParams.get('name') ?? undefined,
      label: url.searchParams.get('label') ?? undefined,
      tag: orgTag(await currentOrgId()),
    });
    return NextResponse.json({ configured: true, prompts });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ configured: true, prompts: [], error: (e as Error).message }, { status });
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!port.configured()) return NextResponse.json({ error: 'Langfuse not configured' }, { status: 503 });
  const input = (await req.json().catch(() => null)) as CreatePromptInput | null;
  if (!input) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const shaped = buildCreatePromptBody(input);
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });
  const orgId = await currentOrgId();
  try {
    // STAMP OWNERSHIP AT CREATION. Without this the new prompt carries no `org:` tag, and since an
    // unowned record is shown to nobody, it would be invisible to the tenant that just created it —
    // the scoping fix would present as "saving does nothing". The org tag is added to whatever tags the
    // caller sent rather than replacing them, and is not something the caller can choose.
    const version = await port.create({
      ...shaped.value,
      tags: [...new Set([...(shaped.value.tags ?? []), orgTag(orgId)])],
    });
    auditFromSession(gate, orgId, {
      action: 'observability.prompt.create',
      resource: `prompt:${shaped.value.name}`,
      outcome: 'ok',
    });
    return NextResponse.json({ version }, { status: 201 });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
