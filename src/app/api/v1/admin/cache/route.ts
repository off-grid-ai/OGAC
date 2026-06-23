import { NextResponse } from 'next/server';
import { cacheStats } from '@/lib/cache';

// Response-cache stats (size, hit rate, exact vs semantic). The cache cuts cost + latency on
// repeated/near-duplicate prompts before they ever reach a model.
export function GET() {
  return NextResponse.json(cacheStats());
}
