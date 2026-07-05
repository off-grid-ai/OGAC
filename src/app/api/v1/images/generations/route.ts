import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { generateAndStore, normalizeImageRequest } from '@/lib/imagegen';

export const dynamic = 'force-dynamic';

// Generate an image through the governed gateway and store it in SeaweedFS. Body:
// { prompt, negativePrompt?, width?, height?, steps?, seed? } → { url, key, prompt, seed }.
export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const v = normalizeImageRequest(body);
  if (!v.ok || !v.value) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const image = await generateAndStore(v.value);
    return NextResponse.json(image, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
