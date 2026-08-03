import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { currentOrgId } from '@/lib/tenancy';
import { daysWaiting } from '@/lib/my-work';

export const dynamic = 'force-dynamic';

// ─── How much is waiting on a person, for the nav badge ──────────────────────────────────────────────
//
// Nothing in the product told anyone that work had arrived. Output sinks deliver RESULTS (email,
// WhatsApp) but nothing tells a PERSON that a case needs them, so the only way to find out was to
// remember to go and look — and the consequence is measurable on this tenant: cases sat for ten days
// under "nobody has picked this up".
//
// This is the cheapest honest signal: a count the nav can show from every page. It is deliberately a
// COUNT endpoint rather than the full list, so putting it in the shell costs one small query.
export async function GET(req: Request) {
  // Any signed-in role, not just an admin: the person who works the queue is usually the least
  // privileged account in the org, and they are exactly who this badge is for.
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const orgId = await currentOrgId();
  const runs = await listAppRunsView(undefined, orgId, 300).catch(() => null);
  if (!runs) {
    // A failed read must not render as "nothing needs you". The client shows no badge at all rather
    // than a zero it cannot stand behind.
    return NextResponse.json({ available: false }, { status: 200 });
  }

  const waiting = runs.filter((r) => String(r.status) === 'awaiting_human');
  const now = new Date();
  const oldestDays = waiting.reduce(
    (max, r) => Math.max(max, daysWaiting(String(r.startedAt ?? ''), now)),
    0,
  );

  return NextResponse.json({
    available: true,
    waiting: waiting.length,
    // Drives the badge's tone: a pile that has gone stale should not look like a fresh one.
    oldestDays,
  });
}
