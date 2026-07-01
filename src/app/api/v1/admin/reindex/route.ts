import { NextResponse } from 'next/server';
import { listDocuments } from '@/lib/brain';
import { qdrantCollectionName, qdrantCount, qdrantReindex } from '@/lib/qdrant';

// Qdrant activation: push existing Brain docs' embeddings into the Qdrant collection so switching
// OFFGRID_ADAPTER_RETRIEVAL=qdrant lands on a populated store. GET reports current count; POST
// reindexes. Reads the LanceDB-backed doc set unless Qdrant is already the active backend (in which
// case listDocuments returns the Qdrant set — a harmless no-op re-embed refresh).
export async function GET() {
  const [count, docs] = await Promise.all([qdrantCount(), listDocuments()]);
  return NextResponse.json({
    collection: qdrantCollectionName(),
    qdrantCount: count,
    sourceDocs: docs.length,
  });
}

export async function POST() {
  try {
    const docs = await listDocuments();
    const written = await qdrantReindex(docs);
    const count = await qdrantCount();
    return NextResponse.json({ ok: true, written, qdrantCount: count });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
