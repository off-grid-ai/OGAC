import { NextResponse } from 'next/server';
import { baoSeal, baoUnseal, openBaoConfigured } from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';
import { validateUnsealKey } from '@/lib/secrets-ops';

export const dynamic = 'force-dynamic';

// Seal / unseal operations — DESTRUCTIVE. Sealing makes the vault inaccessible until re-unsealed
// with operator key shares; unsealing is progressive (one share per call). The unseal key share is
// NEVER echoed, logged, or persisted — it is validated for shape and forwarded straight to OpenBao.

// POST { action: 'seal' } | { action: 'unseal', key } | { action: 'unseal', reset: true }
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!openBaoConfigured()) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  const b = (await req.json().catch(() => null)) as {
    action?: unknown;
    key?: unknown;
    reset?: unknown;
  } | null;

  try {
    if (b?.action === 'seal') {
      const status = await baoSeal();
      return NextResponse.json({ ok: true, status });
    }
    if (b?.action === 'unseal') {
      if (b.reset === true) {
        const status = await baoUnseal('', true);
        return NextResponse.json({ ok: true, status });
      }
      const v = validateUnsealKey(b.key);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      const status = await baoUnseal(v.key);
      return NextResponse.json({ ok: true, status });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
