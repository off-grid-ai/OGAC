import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { organizationalBrainErrorResponse } from '@/lib/organizational-brain/route-response';
import { organizationalBrainRuntime } from '@/lib/organizational-brain/server';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    await brain.deleteSource(authorization, (await params).sourceId);
    return new NextResponse(null, { status: 202 });
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}
