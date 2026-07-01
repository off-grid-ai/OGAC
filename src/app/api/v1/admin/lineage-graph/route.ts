import { NextResponse } from 'next/server';
import { fetchLineageGraph } from '@/lib/marquez';

// Marquez lineage read-back — the server-sourced job→dataset graph for the Lineage page.
export async function GET() {
  return NextResponse.json(await fetchLineageGraph());
}
