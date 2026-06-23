import { NextResponse } from 'next/server';
import { ingestDatabase, ingestFile, ingestImage, ingestText } from '@/lib/ingest';

// Ingest a source into the Brain. Body is discriminated by `kind`:
//   text     { title, text, source? }
//   file     { name, text }            (client reads the file's text)
//   image    { title, dataUrl }        (base64 data URL; captioned via the gateway)
//   database { datasetId }             (indexes a data-plane dataset record)
interface Body {
  kind?: string;
  title?: string;
  name?: string;
  text?: string;
  source?: string;
  dataUrl?: string;
  datasetId?: string;
}

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

type Handler = (b: Body) => Promise<{ id: string } | null> | undefined;

const HANDLERS: Record<string, Handler> = {
  text: (b) => (b.title && b.text ? ingestText(b.title, b.text, b.source) : undefined),
  file: (b) => (b.name && b.text ? ingestFile(b.name, b.text) : undefined),
  image: (b) => (b.title && b.dataUrl ? ingestImage(b.title, b.dataUrl) : undefined),
  database: (b) => (b.datasetId ? ingestDatabase(b.datasetId) : undefined),
};

function dispatch(b: Body) {
  const handler = HANDLERS[b.kind ?? ''];
  return handler ? handler(b) : undefined;
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b || typeof b.kind !== 'string') return bad('kind required');
  const result = await dispatch(b);
  if (result === undefined) return bad('missing fields for this kind');
  if (result === null) return NextResponse.json({ error: 'unknown dataset' }, { status: 404 });
  return NextResponse.json(result, { status: 201 });
}
