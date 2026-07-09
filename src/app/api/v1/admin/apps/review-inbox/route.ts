import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { callerFromSession } from '@/lib/app-access-caller';
import { getReviewInbox } from '@/lib/review-inbox-reader';

export const dynamic = 'force-dynamic';

// ─── HITL REVIEW-INBOX list route (Builder Epic Phase 4A, cross-app) ──────────────────────────────
// GET /api/v1/admin/apps/review-inbox?limit=<n>
//   → the runs awaiting a human decision that THIS reviewer may act on, scoped by the per-app access
//     policy (owner / admin / approver-role / approve allow-list) and annotated with whether they hold
//     the AUTHORITY to approve each one (canApprove) — the same authority the review route enforces.
//
// This backs the cross-app reviewer inbox (/build/review). Deliberately a NEW route (not
// /apps/[id]/review) so the reviewer sees ONE queue across every app they can decide on, not per-app.
//
// SOLID: thin handler — auth, org, resolve the caller (identity → AppAccessCaller), delegate to the
// server-only reader which runs the PURE scope. No scoping/presentation rule lives here.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const orgId = await currentOrgId();
  const caller = await callerFromSession(gate, orgId);

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 200;

  const data = await getReviewInbox(caller, orgId, limit);
  return NextResponse.json({ object: 'list', data });
}
