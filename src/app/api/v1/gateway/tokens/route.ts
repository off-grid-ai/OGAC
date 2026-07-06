import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { gatewayClientTokens } from '@/db/schema';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

// ── GET /api/v1/gateway/tokens ────────────────────────────────────────────────
// Returns the merged view: DB rows (meta + routing overrides) merged with the
// live in-memory token store from the running gateway. The gateway's /tokens
// endpoint returns the TokenStore snapshot; we upsert it into the DB on each
// fetch so the DB is always up-to-date.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // Fetch live token snapshot from gateway
  let live: GatewayTokenSnapshot[] = [];
  try {
    const r = await fetch(`${GATEWAY_URL}/tokens`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.OFFGRID_GATEWAY_API_KEY ?? '' },
      signal: AbortSignal.timeout(2500),
    });
    if (r.ok) live = (await r.json()) as GatewayTokenSnapshot[];
  } catch {
    /* gateway unreachable — fall through to DB-only view */
  }

  // Upsert live entries into DB + read the merged view. Wrap so a DB outage returns the graceful
  // { available:false, error } shape (503) the console can degrade on — not an opaque 500.
  try {
    if (live.length) {
      await Promise.all(
        live.map((t) =>
          db
            .insert(gatewayClientTokens)
            .values({
              fingerprint: t.fingerprint,
              preview: t.preview,
              kind: t.kind,
              inferred: t.inferred ?? {},
              ips: t.ips ?? {},
              uses: t.uses,
              firstSeen: new Date(t.firstSeen),
              lastSeen: new Date(t.lastSeen),
            })
            .onConflictDoUpdate({
              target: gatewayClientTokens.fingerprint,
              set: {
                ips: t.ips ?? {},
                uses: t.uses,
                lastSeen: new Date(t.lastSeen),
                inferred: t.inferred ?? {},
              },
            }),
        ),
      );
    }

    const rows = await db.select().from(gatewayClientTokens).orderBy(gatewayClientTokens.lastSeen);
    return NextResponse.json({ available: true, tokens: rows.reverse() });
  } catch (e) {
    return NextResponse.json(
      { available: false, tokens: [], error: e instanceof Error ? e.message : 'token store unavailable' },
      { status: 503 },
    );
  }
}

// ── PATCH /api/v1/gateway/tokens/:fingerprint ─────────────────────────────────
// Update meta and/or routingOverrides for a token entry.
export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as {
    fingerprint?: string;
    meta?: Record<string, unknown>;
    routingOverrides?: { sourceIp: string; targetIp?: string; targetNode?: string; note?: string }[];
  } | null;

  if (!body?.fingerprint) {
    return NextResponse.json({ error: 'fingerprint required' }, { status: 400 });
  }

  const update: Partial<typeof gatewayClientTokens.$inferInsert> = {};
  if (body.meta !== undefined) update.meta = body.meta;
  if (body.routingOverrides !== undefined) update.routingOverrides = body.routingOverrides;

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  try {
    await db
      .update(gatewayClientTokens)
      .set(update)
      .where(eq(gatewayClientTokens.fingerprint, body.fingerprint));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'token store unavailable' },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}

interface GatewayTokenSnapshot {
  fingerprint: string;
  preview: string;
  kind: 'bearer' | 'x-api-key';
  inferred: Record<string, unknown>;
  ips: Record<string, number>;
  uses: number;
  firstSeen: number;
  lastSeen: number;
}
