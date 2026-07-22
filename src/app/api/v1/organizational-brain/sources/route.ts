import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { parseCreateBrainSourceRequest } from '@/lib/organizational-brain/requests';
import { organizationalBrainErrorResponse } from '@/lib/organizational-brain/route-response';
import { organizationalBrainRuntime } from '@/lib/organizational-brain/server';

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    return NextResponse.json({ sources: await brain.listSources(authorization) });
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { authorization, brain } = await organizationalBrainRuntime(gate);
    const source = await brain.createSource(authorization, parseCreateBrainSourceRequest(await req.json()));
    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    return organizationalBrainErrorResponse(error);
  }
}
