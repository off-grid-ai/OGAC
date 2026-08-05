import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateTag } from '@/lib/data-ownership-policy';
import { listTags, tagDataset, untagDataset, upsertTag } from '@/lib/adapters/marquez-metadata';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Tag lifecycle in the lineage catalogue. A tag is a CLAIM about data, so a definition is required —
// see validateTag. Applying and removing a tag on a dataset changes the claim, never the dataset:
// lineage is an append-only record and a console that can erase it can erase evidence.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const out = await listTags();
  return out.ok
    ? NextResponse.json({ tags: out.result })
    : NextResponse.json({ error: out.reason }, { status: 502 });
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as { name?: string; description?: string } | null;
  const tag = validateTag(body?.name, body?.description);
  if (!tag.ok) return NextResponse.json({ error: tag.sentence, problem: tag.problem }, { status: 400 });
  const out = await upsertTag(tag.name, tag.description);
  if (!out.ok) return NextResponse.json({ error: out.reason }, { status: 502 });
  auditFromSession(gate, await currentOrgId(), {
    action: 'catalogue.tag.define',
    resource: `tag:${tag.name}`,
    outcome: 'ok',
  });
  return NextResponse.json(out.result);
}

// Apply (POST) or remove (DELETE) a tag on one dataset.
export async function POST(req: Request) {
  return applyTag(req, 'apply');
}
export async function DELETE(req: Request) {
  return applyTag(req, 'remove');
}

async function applyTag(req: Request, mode: 'apply' | 'remove') {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const namespace = url.searchParams.get('namespace')?.trim();
  const dataset = url.searchParams.get('dataset')?.trim();
  const tag = url.searchParams.get('tag')?.trim().toUpperCase();
  if (!namespace || !dataset || !tag) {
    return NextResponse.json({ error: 'namespace, dataset and tag are required' }, { status: 400 });
  }
  const out = mode === 'apply'
    ? await tagDataset(namespace, dataset, tag)
    : await untagDataset(namespace, dataset, tag);
  if (!out.ok) return NextResponse.json({ error: out.reason }, { status: 502 });
  auditFromSession(gate, await currentOrgId(), {
    action: mode === 'apply' ? 'catalogue.tag.apply' : 'catalogue.tag.remove',
    resource: `dataset:${namespace}/${dataset}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, namespace, dataset, tag });
}
