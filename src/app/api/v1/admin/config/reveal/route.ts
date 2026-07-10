import { NextResponse } from 'next/server';
import { db } from '@/db';
import { configAudit } from '@/db/schema';
import { requireAdmin } from '@/lib/authz';
import { revealConfig } from '@/lib/config';
import { isViewer, redactSecretForViewer } from '@/lib/viewer-policy';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/config/reveal?key=KEY — returns the raw value of a single key,
// secrets included. Admin-only, and every reveal is written to the audit log.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const key = new URL(req.url).searchParams.get('key') ?? '';
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  const value = await revealConfig(key);
  if (value === null) return NextResponse.json({ error: 'unknown key' }, { status: 404 });
  // The read-only VIEWER reaches this admin read (view-everything demo) but must NEVER see a secret
  // VALUE — it gets a fixed placeholder instead. A real admin gets the raw value, unchanged.
  const viewer = isViewer(gate.user.role);
  const shown = redactSecretForViewer(value, viewer);
  await db.insert(configAudit).values({
    id: `cfg_reveal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    key,
    actor: gate.user.email ?? 'admin',
    oldValue: null,
    newValue: viewer ? 'REVEALED_REDACTED' : 'REVEALED',
    at: new Date(),
  });
  return NextResponse.json({ key, value: shown, ...(viewer ? { redacted: true } : {}) });
}
