import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { parseSourceStateRequest } from '@/lib/organizational-brain/requests';
import { organizationalBrainErrorResponse } from '@/lib/organizational-brain/route-response';
import { organizationalBrainRuntime } from '@/lib/organizational-brain/server';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    const input = parseSourceStateRequest(await req.json());
    await brain.setSourceState(authorization, (await params).connectionId, input.state);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}
