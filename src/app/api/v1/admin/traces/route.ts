import { NextResponse } from 'next/server';
import { safeListTraces } from '@/lib/langfuse';

// Langfuse trace read-back — recent traces for the Observability page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 30;
  return NextResponse.json(await safeListTraces(limit));
}
