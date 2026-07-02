import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getConfigEntries, setConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

// ── GET /api/v1/admin/config ──────────────────────────────────────────────────
// The full config surface: every declared key, grouped, with effective value
// (secrets masked — only whether set), source, and restart-required flag.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const entries = await getConfigEntries();
  return NextResponse.json({ entries });
}

// ── POST /api/v1/admin/config ─────────────────────────────────────────────────
// Save one or more keys. Writes to the server env file (applied on restart) and
// records an audit row per key (secret values redacted in the audit).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const actor = gate.user.email ?? 'admin';
  const body = (await req.json().catch(() => ({}))) as { settings?: Record<string, string> };
  if (!body.settings || typeof body.settings !== 'object') {
    return NextResponse.json({ error: 'settings object required' }, { status: 400 });
  }
  const result = await setConfig(body.settings, actor);
  return NextResponse.json({ ok: true, ...result });
}
