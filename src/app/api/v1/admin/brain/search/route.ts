import { NextResponse } from 'next/server';
import { searchDocuments } from '@/lib/brain';

// Semantic retrieval over the Brain — returns scored hits (the citation set).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (!q) {
    return NextResponse.json({ object: 'list', query: '', data: [] });
  }
  return NextResponse.json({ object: 'list', query: q, data: await searchDocuments(q) });
}
