import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { BrainWriteError } from '@/lib/brain';
import { dispatchBrainIngest, type BrainIngestBody } from '@/lib/brain-ingest';
import { currentOrgId } from '@/lib/tenancy';

// Ingest a source into the Brain. Body is discriminated by `kind`:
//   text     { title, text, source? }
//   file     { name, text }            (client reads the file's text)
//   image    { title, dataUrl }        (base64 data URL; captioned via the gateway)
//   database { datasetId }             (indexes a data-plane dataset record)
function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as BrainIngestBody | null;
  if (!b || typeof b.kind !== 'string') return bad('kind required');
  let result: { id: string } | null | undefined;
  try {
    result = await dispatchBrainIngest(b, await currentOrgId());
  } catch (e) {
    // The Brain's store rejected the write — return a clear error, never a bare empty-body 500.
    if (e instanceof BrainWriteError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (result === undefined) return bad('missing fields for this kind');
  if (result === null) return NextResponse.json({ error: 'unknown dataset' }, { status: 404 });
  return NextResponse.json(result, { status: 201 });
}
