import { NextResponse } from 'next/server';
import { marquezLineageReader } from '@/lib/adapters/marquez-lineage';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateTagDecl } from '@/lib/marquez-lineage';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET — list declared tags (name + description) for the tag manager / picker.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await marquezLineageReader.listTags());
}

interface TagBody {
  action?: string;
  name?: string;
  description?: string;
  namespace?: string;
  dataset?: string;
  job?: string;
  tag?: string;
}

type Dispatch = { ok: boolean; status?: number; error?: string; resource?: string };

async function declareAction(b: TagBody): Promise<Dispatch> {
  const v = validateTagDecl(b);
  if (!v.ok || !v.value) return { ok: false, status: 400, error: v.error };
  return { ...(await marquezLineageReader.declareTag(v.value)), resource: `tag:${v.value.name}` };
}

async function datasetTagAction(b: TagBody, remove: boolean): Promise<Dispatch> {
  const input = { namespace: b.namespace ?? '', dataset: b.dataset ?? '', tag: b.tag ?? '' };
  const r = remove
    ? await marquezLineageReader.untagDataset(input)
    : await marquezLineageReader.tagDataset(input);
  return { ...r, resource: `dataset:${b.namespace}/${b.dataset}` };
}

async function jobTagAction(b: TagBody): Promise<Dispatch> {
  const r = await marquezLineageReader.tagJob({
    namespace: b.namespace ?? '',
    job: b.job ?? '',
    tag: b.tag ?? '',
  });
  return { ...r, resource: `job:${b.namespace}/${b.job}` };
}

// Route one governance action to its handler; returns the audit `resource` label on success.
function dispatch(b: TagBody): Promise<Dispatch> {
  if (b.action === 'declare') return declareAction(b);
  if (b.action === 'tag-dataset') return datasetTagAction(b, false);
  if (b.action === 'untag-dataset') return datasetTagAction(b, true);
  if (b.action === 'tag-job') return jobTagAction(b);
  return Promise.resolve({ ok: false, status: 400, error: 'unknown action' });
}

// POST — declare a tag, or apply/remove a tag on a dataset or job. Governed, audited writes.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!marquezLineageReader.configured()) {
    return NextResponse.json({ error: 'Marquez not configured' }, { status: 503 });
  }
  const b = ((await req.json().catch(() => null)) as TagBody | null) ?? {};
  const r = await dispatch(b);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 502 });
  auditFromSession(gate, await currentOrgId(), {
    action: `lineage.${b.action}`,
    resource: r.resource ?? 'tag',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
