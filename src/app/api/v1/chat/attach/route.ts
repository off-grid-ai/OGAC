import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractFile } from '@/lib/chat-attach';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024; // 15MB per file

// Ad-hoc chat file attachment: extract text from an uploaded txt/md/csv/pdf server-side and return
// it so the client can attach it as context for a single turn (chip in the composer). Nothing is
// persisted here — the extracted text rides along in the next stream request.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'no file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large' }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const { name, text, truncated } = extractFile(file.name, file.type, buf.toString('base64'));
  if (!text.trim()) {
    return NextResponse.json({ error: 'no extractable text (scanned or image-only?)' }, { status: 422 });
  }
  return NextResponse.json({ name, text, truncated, chars: text.length });
}
