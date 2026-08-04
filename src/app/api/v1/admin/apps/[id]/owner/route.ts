import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { auditFromSession } from '@/lib/audit-actor';
import { requireWriter } from '@/lib/authz';
import { getApp } from '@/lib/apps-store';
import { listUsers } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Hand a process over to someone else ─────────────────────────────────────────────────────────────
//
// apps.ownerId was set once at creation and never changeable, so a handover was impossible: when the
// person who built a process changed role, the app kept their name forever and nobody could correct it.
// That is how these systems become unowned while still displaying an owner.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { owner?: string } | null;
  const owner = String(body?.owner ?? '').trim().toLowerCase();

  if (!owner || !owner.includes('@')) {
    return NextResponse.json({ error: 'Give the email of the person taking this over.' }, { status: 400 });
  }

  const org = await currentOrgId();
  const app = await getApp(id, org);
  if (!app) return NextResponse.json({ error: 'unknown app' }, { status: 404 });

  // The new owner must have an account HERE. Handing a process to an address with no login recreates the
  // exact problem this fixes — an owner who cannot act, which is a name rather than an owner.
  const users = await listUsers(org).catch(() => []);
  if (!users.some((u) => (u.email ?? '').trim().toLowerCase() === owner)) {
    return NextResponse.json(
      { error: `${owner} has no account in this organization, so they could not act on it.` },
      { status: 400 },
    );
  }

  await db.execute(sql`UPDATE apps SET owner_id = ${owner} WHERE id = ${id} AND org_id = ${org};`);
  auditFromSession(gate, org, {
    action: 'apps.owner.changed',
    resource: `app:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, owner });
}
