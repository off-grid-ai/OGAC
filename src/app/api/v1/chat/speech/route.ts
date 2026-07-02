import { auth } from '@/auth';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Text-to-speech — forwards to the gateway's OpenAI-style speech endpoint (modality
// 'speech':'ready') and streams the audio back for inline playback of an answer.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return new Response('unauthorized', { status: 401 });
  const { input = '', voice = 'alloy' } = await req.json().catch(() => ({}));
  if (!String(input).trim()) return new Response('no input', { status: 400 });
  const r = await fetch(`${GATEWAY_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: gatewayHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ model: 'tts', input: String(input).slice(0, 4000), voice }),
    signal: AbortSignal.timeout(110000),
  }).catch(() => null);
  if (!r || !r.ok || !r.body) return new Response('speech unavailable', { status: 502 });
  return new Response(r.body, {
    headers: { 'content-type': r.headers.get('content-type') ?? 'audio/mpeg' },
  });
}
