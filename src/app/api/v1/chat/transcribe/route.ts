import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Speech-to-text — forwards recorded audio to the gateway's OpenAI-style transcription endpoint
// (modality 'transcription':'ready'). The client puts the returned text into the composer.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file) return NextResponse.json({ error: 'no audio' }, { status: 400 });
  const out = new FormData();
  out.append('file', file as Blob, 'audio.webm');
  const r = await fetch(`${GATEWAY_URL}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: gatewayHeaders(),
    body: out,
    signal: AbortSignal.timeout(110000),
  }).catch(() => null);
  if (!r || !r.ok) return NextResponse.json({ error: 'transcription unavailable' }, { status: 502 });
  const j = await r.json().catch(() => ({}));
  return NextResponse.json({ text: j?.text ?? '' });
}
