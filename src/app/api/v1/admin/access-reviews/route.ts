import { NextResponse } from 'next/server';
import { validateReview, type ReviewSubject, type SubjectDecision } from '@/lib/access-review';
import { listAccessReviews, recordAccessReview } from '@/lib/access-reviews-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { isRbacRole } from '@/lib/roles';
import { listUsers, revokeUserAccess, setUserRole } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── The access-review artefact ────────────────────────────────────────────────────────────────────
//
// An auditor asking "show me your last access review" got nothing — the console could list users and
// change roles, but never recorded that anyone had CERTIFIED the list.
//
// The important design decision is that this route APPLIES the decisions it records. A review that
// files a revocation without performing it is worse than no review at all: it produces an artefact
// asserting something untrue. So each revoke/change-role is executed, and what actually happened
// (including failures) is stored on the record next to what was decided.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({
    object: 'list',
    data: await listAccessReviews(await currentOrgId()),
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as { decisions?: SubjectDecision[] } | null;
  const decisions = Array.isArray(body?.decisions) ? body.decisions : [];
  if (!decisions.length) {
    return NextResponse.json({ error: 'No decisions were submitted.' }, { status: 400 });
  }
  const org = await currentOrgId();
  const reviewedBy = gate.user?.email ?? '';

  // Validated against the list AS IT IS NOW, not as the browser saw it. A person added since the page
  // loaded would otherwise be certified by omission.
  const people = await listUsers(org);
  const subjects: ReviewSubject[] = people.map((u) => ({
    id: u.id,
    email: u.email ?? '',
    name: u.name,
    role: u.role,
  }));
  const check = validateReview(subjects, decisions);
  if (!check.ok) {
    return NextResponse.json(
      { error: 'This review is not complete.', reasons: check.errors },
      { status: 400 },
    );
  }

  // APPLY. Each outcome is recorded, including the ones that failed — the artefact has to be able to
  // say "we decided to remove this person and the removal did not take".
  const applied: { email: string; action: string; ok: boolean; detail?: string }[] = [];
  for (const d of decisions) {
    if (d.decision === 'keep') {
      applied.push({ email: d.email, action: 'access confirmed', ok: true });
      continue;
    }
    if (d.decision === 'revoke') {
      // Never let a reviewer remove their own access mid-review: they would lose the ability to
      // finish it, and the artefact would be left half-applied.
      if (d.email && reviewedBy && d.email.toLowerCase() === reviewedBy.toLowerCase()) {
        applied.push({
          email: d.email,
          action: 'access removed',
          ok: false,
          detail: 'You cannot remove your own access while running the review.',
        });
        continue;
      }
      const ok = await revokeUserAccess(d.userId, org).catch(() => false);
      applied.push({
        email: d.email,
        action: 'access removed',
        ok,
        detail: ok ? undefined : 'The user could not be removed — they may already be gone.',
      });
      continue;
    }
    // change-role
    if (!isRbacRole(d.newRole)) {
      applied.push({
        email: d.email,
        action: `moved to ${d.newRole ?? 'a different role'}`,
        ok: false,
        detail: 'That is not a role this console recognises.',
      });
      continue;
    }
    const updated = await setUserRole(d.userId, d.newRole, org).catch(() => null);
    applied.push({
      email: d.email,
      action: `moved to ${d.newRole}`,
      ok: Boolean(updated),
      detail: updated ? undefined : 'The role change did not take.',
    });
  }

  const record = await recordAccessReview({ reviewedBy, decisions, applied }, org);
  auditFromSession(gate, org, {
    action: 'access.review.completed',
    resource: `review:${record.id}`,
    outcome: applied.every((a) => a.ok) ? 'ok' : 'error',
  });

  return NextResponse.json({ review: record }, { status: 201 });
}
