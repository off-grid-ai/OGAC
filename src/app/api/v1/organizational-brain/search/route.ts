import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { parseBrainSearchRequest } from '@/lib/organizational-brain/requests';
import { organizationalBrainErrorResponse } from '@/lib/organizational-brain/route-response';
import { organizationalBrainRuntime } from '@/lib/organizational-brain/server';

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    return NextResponse.json(await brain.search(authorization, parseBrainSearchRequest(await req.json())));
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}
