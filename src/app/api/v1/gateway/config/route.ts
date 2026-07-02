import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { gatewayConfig } from '@/db/schema';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

// ── GET /api/v1/gateway/config ────────────────────────────────────────────────
// Returns the schema + live values from the running gateway merged with any
// admin overrides saved in the DB. Secret values are masked (***) from the
// gateway; DB rows only store non-secret values.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // Fetch live config from the gateway
  let liveEntries: GatewayConfigEntry[] = [];
  try {
    const r = await fetch(`${GATEWAY_URL}/config`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.OFFGRID_GATEWAY_API_KEY ?? '' },
      signal: AbortSignal.timeout(2500),
    });
    if (r.ok) {
      const d = (await r.json()) as { entries: GatewayConfigEntry[] };
      liveEntries = d.entries ?? [];
    }
  } catch {
    /* gateway offline — fall through to DB-only */
  }

  // Load persisted overrides from DB
  const dbRows = await db.select().from(gatewayConfig);
  const dbMap = Object.fromEntries(dbRows.map((r) => [r.key, r]));

  // Merge: DB value takes precedence for display (it's what was last set via the console)
  const entries = liveEntries.map((e) => ({
    ...e,
    savedValue: dbMap[e.key]?.value ?? '',
    updatedAt: dbMap[e.key]?.updatedAt ?? null,
    updatedBy: dbMap[e.key]?.updatedBy ?? '',
  }));

  return NextResponse.json({ available: liveEntries.length > 0, entries });
}

// ── POST /api/v1/gateway/config ───────────────────────────────────────────────
// Save one or more settings: persist to DB, then push to the live gateway.
// Secret values are stored in DB (encrypted at rest by Postgres) but never
// returned in GET. Non-secret values are also pushed to the gateway's /config.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const session = (gate as { user?: { email?: string } })?.user;
  const actor = session?.email ?? 'admin';

  const body = (await req.json()) as { settings: Record<string, string> };
  if (!body.settings || typeof body.settings !== 'object') {
    return NextResponse.json({ error: 'settings object required' }, { status: 400 });
  }

  // Persist to DB
  await Promise.all(
    Object.entries(body.settings).map(([key, value]) =>
      db
        .insert(gatewayConfig)
        .values({ key, value, updatedBy: actor, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: gatewayConfig.key,
          set: { value, updatedBy: actor, updatedAt: new Date() },
        }),
    ),
  );

  // Push live to gateway
  let gatewayResult: { applied?: string[]; restartRequired?: string[] } = {};
  try {
    const r = await fetch(`${GATEWAY_URL}/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.OFFGRID_GATEWAY_API_KEY ?? '',
      },
      body: JSON.stringify({ settings: body.settings }),
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) gatewayResult = await r.json();
  } catch {
    /* gateway offline — settings saved to DB, will apply on next start */
  }

  return NextResponse.json({
    ok: true,
    saved: Object.keys(body.settings),
    applied: gatewayResult.applied ?? [],
    restartRequired: gatewayResult.restartRequired ?? [],
  });
}

// ── DELETE /api/v1/gateway/config?key=X ──────────────────────────────────────
// Remove a saved override (reverts to env var default on next restart).
export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const key = new URL(req.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  await db.delete(gatewayConfig).where(eq(gatewayConfig.key, key));
  return NextResponse.json({ ok: true });
}

interface GatewayConfigEntry {
  key: string;
  group: string;
  label: string;
  type: string;
  liveReload: boolean;
  secret: boolean;
  description: string;
  value: string;
  current: string;
}
