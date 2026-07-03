import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  createTag,
  marquezWriteConfigured,
  tagDataset,
  tagJob,
  untagDataset,
} from '@/lib/lineage-writer';

export const dynamic = 'force-dynamic';

// POST (admin) — declare/apply/remove a Marquez tag. `action` selects the operation:
//   declare      → create a tag (name [+ description])
//   tag-dataset  → apply tag to a dataset (namespace, dataset, tag)
//   untag-dataset→ remove tag from a dataset
//   tag-job      → apply tag to a job (namespace, job, tag)
// Marquez has NO delete for namespaces/datasets/jobs — that is surfaced (disabled) in the UI, not here.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!marquezWriteConfigured()) {
    return NextResponse.json({ error: 'Marquez not configured' }, { status: 503 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(b?.action ?? '');
  try {
    const r =
      action === 'declare'
        ? await createTag({ name: b?.name, description: b?.description })
        : action === 'tag-dataset'
          ? await tagDataset({ namespace: b?.namespace, dataset: b?.dataset, tag: b?.tag })
          : action === 'untag-dataset'
            ? await untagDataset({ namespace: b?.namespace, dataset: b?.dataset, tag: b?.tag })
            : action === 'tag-job'
              ? await tagJob({ namespace: b?.namespace, job: b?.job, tag: b?.tag })
              : null;
    if (!r) return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 502 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
