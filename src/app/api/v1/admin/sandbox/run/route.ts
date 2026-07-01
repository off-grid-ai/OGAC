import { NextResponse } from 'next/server';
import { getFlags, getSandbox } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';

// Execute agent-authored code in the active sandbox (OFFGRID_ADAPTER_SANDBOX: none default | docker).
// Double-gated: the `agent-code-exec` feature flag must be ON (default OFF), and the no-exec default
// refuses regardless. POST { language: 'python'|'node', code, timeoutMs? }.
interface Body {
  language?: unknown;
  code?: unknown;
  timeoutMs?: unknown;
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const enabled = await getFlags().isEnabled('agent-code-exec', false);
  if (!enabled) {
    return NextResponse.json(
      { error: 'code execution disabled (flag: agent-code-exec is off)' },
      { status: 403 },
    );
  }
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b || typeof b.code !== 'string' || !b.code.trim()) {
    return NextResponse.json({ error: 'code (string) required' }, { status: 400 });
  }
  const language = b.language === 'node' ? 'node' : 'python';
  const timeoutMs = typeof b.timeoutMs === 'number' ? Math.min(b.timeoutMs, 30_000) : undefined;
  const result = await getSandbox().run(language, b.code, timeoutMs);
  // A refused run (no-exec default) is a 403; a real execution returns 200 with the result.
  return NextResponse.json(result, { status: result.refused ? 403 : 200 });
}
