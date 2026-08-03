import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { planErasure } from '@/lib/erasure';
import { findEmbeddedCopies, typeSubject } from '@/lib/erasure-embedded';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── FIND EVERY COPY, BEFORE DELETING ANY ──────────────────────────────────────────────────────────
//
// The erasure surface was a text box and an "Erase subject" button that deleted irreversibly on the
// first click, with a toast afterwards. No DPO should be asked to work that way: they are answering a
// legal request and have to be able to say WHAT was found and WHERE before anything is destroyed.
//
// This is the find step. It touches nothing. It reports the row-level stores the plan would clear AND
// — the part that did not exist at all — the EMBEDDED copies: retrieval chunks and run records that
// mention the person, located through the salted subject index.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as { subject?: string } | null;
  const subject = body?.subject?.trim();
  if (!subject) {
    return NextResponse.json({ error: 'Enter an email, PAN, mobile or reference to search for.' }, { status: 400 });
  }
  const orgId = await currentOrgId();

  // Row-level stores, from the existing pure planner (nothing is executed).
  const plan = planErasure(subject, orgId);

  // Embedded copies — the retrieval chunks and run records that mention the person. Shared with the
  // erasure routes so the find step can never disagree with what the erase step will actually reach.
  const embedded = await findEmbeddedCopies(orgId, subject);

  return NextResponse.json({
    subject,
    // What the identifier was recognised AS — so a DPO can see we searched for a PAN, not a string.
    recognisedAs: typeSubject(subject).map((t) => t.type),
    stores: plan.steps.map((s) => ({ store: s.store, table: s.table })),
    deferred: plan.deferred,
    embedded,
    // Honest headline: nothing found is a real answer, and must not look like a failed search.
    found: plan.steps.length > 0 || embedded.length > 0,
  });
}
