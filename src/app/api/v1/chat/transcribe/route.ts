import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { transcribeAudio } from '@/lib/chat-audio-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Speech-to-text (STT) — thin handler. Auth, extract the audio blob, delegate the on-prem forward
// to the audio adapter (which resolves the target: dedicated OFFGRID_STT_URL, else the gateway's
// /v1/audio/transcriptions — both on-prem). The client drops the returned text into the composer.
// Never calls a cloud API. Graceful, honest failures: 503 not-configured vs 502 unavailable.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const filename = String(form?.get('filename') ?? 'audio.webm');
  // Optional STT engine selection from the catalog (picker). Empty → gateway default.
  const model = form?.get('model') ? String(form.get('model')) : undefined;
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'no audio' }, { status: 400 });

  const result = await transcribeAudio(file, filename, model);
  if (!result.ok) {
    return result.reason === 'not-configured'
      ? NextResponse.json({ error: 'transcription not configured', reason: 'not-configured' }, { status: 503 })
      : NextResponse.json({ error: 'transcription unavailable', reason: 'unavailable' }, { status: 502 });
  }
  return NextResponse.json({ text: result.text });
}
