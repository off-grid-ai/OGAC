import { NextResponse } from 'next/server';
import { requireWriter } from '@/lib/authz';
import { parseBrainDocument } from '@/lib/organizational-brain/requests';
import { organizationalBrainErrorResponse } from '@/lib/organizational-brain/route-response';
import { organizationalBrainRuntime } from '@/lib/organizational-brain/server';

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    const receipt = await brain.upsertDocument(authorization, parseBrainDocument(await req.json()));
    return NextResponse.json(receipt, { status: receipt.created ? 201 : 200 });
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}
