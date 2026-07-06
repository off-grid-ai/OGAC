import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { synthesizeSpeech } from '@/lib/chat-audio-server';
import { textForSpeech } from '@/lib/chat-audio';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Text-to-speech (TTS) — thin handler. Auth, clean the answer markdown to speakable prose, delegate
// the on-prem synth to the audio adapter (dedicated OFFGRID_TTS_URL, else the gateway's
// /v1/audio/speech — both on-prem), and stream the audio back for inline playback. Never a cloud
// API. When no server TTS is configured we return 503 with reason 'not-configured'; the client then
// falls back to the local browser speechSynthesis (offline, air-gap-safe).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { input = '', voice = 'alloy' } = (await req.json().catch(() => ({}))) as {
    input?: string;
    voice?: string;
  };
  const clean = textForSpeech(String(input));
  if (!clean) return NextResponse.json({ error: 'no input' }, { status: 400 });

  const result = await synthesizeSpeech(clean, String(voice));
  if (!result.ok) {
    return result.reason === 'not-configured'
      ? NextResponse.json({ error: 'speech not configured', reason: 'not-configured' }, { status: 503 })
      : NextResponse.json({ error: 'speech unavailable', reason: 'unavailable' }, { status: 502 });
  }
  return new Response(result.body, { headers: { 'content-type': result.contentType } });
}
