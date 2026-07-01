import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getSandbox } from '@/lib/adapters/registry';
import type { SandboxLanguage } from '@/lib/adapters/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Execute a code artifact in the configured sandbox (default no-exec; Docker/Firecracker when
// opted in). Output is shown inline in the artifact panel. Reuses the console's sandbox adapter.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { language = 'python', code = '' } = await req.json().catch(() => ({}));
  const lang: SandboxLanguage = language === 'node' ? 'node' : 'python';
  if (!code.trim()) return NextResponse.json({ error: 'no code' }, { status: 400 });
  const result = await getSandbox().run(lang, String(code));
  return NextResponse.json({ result });
}
