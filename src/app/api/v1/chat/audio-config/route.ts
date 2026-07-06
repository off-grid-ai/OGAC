import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { resolveAudioConfig } from '@/lib/chat-audio-server';

export const dynamic = 'force-dynamic';

// Honest audio capability probe — tells the client whether STT and server-TTS are configured
// on-prem (so the mic + play buttons render enabled/disabled with the right tooltip, and the
// client knows whether to use the browser speechSynthesis fallback). Read-only; no cloud calls.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(resolveAudioConfig());
}
