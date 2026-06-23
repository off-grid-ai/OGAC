import { NextResponse } from 'next/server';
import { type PolicyBundle, getOrgPolicy, pushPolicy } from '@/lib/store';

type PolicyPatch = Partial<Omit<PolicyBundle, 'version' | 'updatedAt'>>;

export async function GET() {
  return NextResponse.json(await getOrgPolicy());
}

// Admin pushes a new policy down to the fleet (bumps the version; nodes converge on pull).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const patch: PolicyPatch = {};
  if (typeof body?.egressAllowed === 'boolean') patch.egressAllowed = body.egressAllowed;
  if (Array.isArray(body?.guardrails)) patch.guardrails = body.guardrails;
  if (Array.isArray(body?.allowedModels)) patch.allowedModels = body.allowedModels;
  return NextResponse.json(await pushPolicy(patch));
}
