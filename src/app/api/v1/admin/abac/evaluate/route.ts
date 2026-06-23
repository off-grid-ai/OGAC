import { NextResponse } from 'next/server';
import { getPolicy } from '@/lib/adapters/registry';

// Evaluate an access decision through the policy port (first-party ABAC by default, OPA when
// OFFGRID_ADAPTER_POLICY=opa). For testing/preview.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const role = (b?.role as string | undefined) ?? '*';
  const resource = (b?.resource as string | undefined) ?? '*';
  const attributes = (b?.attributes as Record<string, string> | undefined) ?? {};
  return NextResponse.json(await getPolicy().evaluate({ role, resource, attributes }));
}
