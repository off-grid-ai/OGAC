import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { c2paRead, c2paSign, c2paSupported } from '@/lib/c2pa';

// C2PA Content Credentials for images. POST { image (base64), mimeType, action?: 'sign'|'verify' }.
//   sign   → embeds a signed manifest, returns { image: base64, bytes }
//   verify → reads + validates the embedded manifest, returns { hasManifest, valid, ... }
// (Text/document exports use the ed25519 detached manifest at /admin/reports/[id]/export instead.)
interface Body {
  image?: unknown;
  mimeType?: unknown;
  action?: unknown;
  title?: unknown;
  author?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function handle(b: Body): Promise<NextResponse> {
  const buffer = Buffer.from(b.image as string, 'base64');
  const mimeType = b.mimeType as string;
  if (b.action === 'verify') {
    return NextResponse.json(await c2paRead(buffer, mimeType));
  }
  const signed = await c2paSign(buffer, mimeType, {
    title: typeof b.title === 'string' ? b.title : undefined,
    author: typeof b.author === 'string' ? b.author : undefined,
  });
  return NextResponse.json(
    { image: signed.buffer.toString('base64'), bytes: signed.bytes },
    { status: 201 },
  );
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b || typeof b.image !== 'string' || typeof b.mimeType !== 'string') {
    return badRequest('image (base64) + mimeType required');
  }
  if (!c2paSupported(b.mimeType)) {
    return badRequest('mimeType must be image/png or image/jpeg');
  }
  try {
    return await handle(b);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'c2pa failed' }, { status: 502 });
  }
}
