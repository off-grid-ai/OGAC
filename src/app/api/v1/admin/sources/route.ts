import { NextResponse } from 'next/server';
import { listSources } from '@/lib/retrieval/router';

// The retrieval destinations the router can route to (KB / database / tool).
export function GET() {
  return NextResponse.json({ object: 'list', data: listSources() });
}
