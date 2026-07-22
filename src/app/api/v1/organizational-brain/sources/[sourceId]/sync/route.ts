import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { parseSourceSyncRequest } from '@/lib/organizational-brain/requests';
import { organizationalBrainErrorResponse } from '@/lib/organizational-brain/route-response';
import { organizationalBrainRuntime } from '@/lib/organizational-brain/server';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    const input = parseSourceSyncRequest(await req.json());
    await brain.triggerSourceSync(authorization, (await params).sourceId, input.fromBeginning);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}
