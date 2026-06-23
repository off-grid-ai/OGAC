import { NextResponse } from 'next/server';
import { createTool, listTools } from '@/lib/store';

const TYPES = ['http', 'mcp'];

function valid(b: Record<string, unknown> | null): boolean {
  if (!b) return false;
  return typeof b.name === 'string' && Boolean(b.name) && TYPES.includes(b.type as string);
}

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listTools() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!valid(b)) {
    return NextResponse.json({ error: 'name and type (http|mcp) required' }, { status: 400 });
  }
  return NextResponse.json(
    await createTool({
      name: b!.name as string,
      type: b!.type as string,
      endpoint: (b!.endpoint as string | undefined) ?? '',
      description: (b!.description as string | undefined) ?? '',
    }),
    { status: 201 },
  );
}
