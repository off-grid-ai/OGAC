import { NextResponse } from 'next/server';
import { evaluateAbac } from '@/lib/store';

// Evaluate an access decision against the ABAC rules (deny-overrides). For testing/preview.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const role = (b?.role as string | undefined) ?? '*';
  const resource = (b?.resource as string | undefined) ?? '*';
  const attributes = (b?.attributes as Record<string, string> | undefined) ?? {};
  return NextResponse.json(await evaluateAbac({ role, resource, attributes }));
}
