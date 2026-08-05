import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { safeListTraces } from '@/lib/langfuse';
import { currentOrgId } from '@/lib/tenancy';

// Trace read-back — recent traces for the Observability page, scoped to the caller's own tenant.
//
// The org comes from the request's tenant binding, never from a query parameter: this endpoint used to
// return every tenant's traces, and letting a caller name the org would only change how they ask for
// someone else's.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 30;
  return NextResponse.json(await safeListTraces(await currentOrgId(), limit));
}
