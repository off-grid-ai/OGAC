import { NextResponse } from 'next/server';
import { probeEmbed } from '@/lib/embeds';

// Server-side reachability + framing check for embedded OSS tools. The UI calls this to decide
// whether to render an iframe or fall back to an "open in new tab" link. Query: ?url=...
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url') ?? undefined;
  if (!url) return NextResponse.json({ error: 'url query param required' }, { status: 400 });
  const probe = await probeEmbed(url);
  return NextResponse.json(probe ?? { url: '', reachable: false, frameable: false });
}
