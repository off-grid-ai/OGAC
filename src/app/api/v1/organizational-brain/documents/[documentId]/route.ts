import { NextResponse } from 'next/server';
import { requireWriter } from '@/lib/authz';
import { organizationalBrainErrorResponse } from '@/lib/organizational-brain/route-response';
import { organizationalBrainRuntime } from '@/lib/organizational-brain/server';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    await brain.deleteDocument(authorization, (await params).documentId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}
