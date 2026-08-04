import { NextResponse } from 'next/server';
import { listApps } from '@/lib/apps-store';
import { listAppRuns } from '@/lib/app-run-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { typeSubject } from '@/lib/erasure-embedded';
import { findChunksForSubject } from '@/lib/subject-index-store';
import { buildSubjectAccessTrail, type SubjectRun } from '@/lib/subject-access-trail';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── "Who has looked at this person's file, and when?" ─────────────────────────────────────────────
//
// The first question in any complaint, insider-risk investigation or regulator visit, and the platform
// could not answer it: the audit ledger is indexed by ACTOR and never by data subject.
//
// It turned out most of the answer already existed and nobody had joined it — `subject_chunk_index` maps a
// salted subject fingerprint to the runs mentioning that person (it exists because erasure needed it), and
// every run already records who decided it. This route is the join.
//
// Deliberately NOT through `audit_events_v2.run_id`: that column is empty on these runs, so the ledger
// join returns nothing and would report "nobody has accessed this person's file" about someone whose file
// a dozen runs had touched. That is the worst false negative available here.
//
// The identifier is never stored or logged — it is fingerprinted with the deployment salt and used to look
// up, exactly as erasure does. Asking who accessed a person's file must not itself create a new record of
// that person.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as { subject?: string } | null;
  const subject = body?.subject?.trim();
  if (!subject) {
    return NextResponse.json(
      { error: 'Enter an email, PAN, mobile or reference to look up.' },
      { status: 400 },
    );
  }
  const orgId = await currentOrgId();

  // Which runs mention this person, via the salted index. Every recognised form of the identifier is
  // tried, so a mobile number written two ways still finds the same person.
  const recognised = typeSubject(subject);
  const runIds = new Set<string>();
  let masked: string | null = null;
  for (const t of recognised) {
    for (const m of await findChunksForSubject(orgId, t.type, t.value).catch(() => [])) {
      if (m.source === 'run') runIds.add(m.containerId);
      masked ??= m.masked;
    }
  }

  // The runs themselves carry who decided them. Read per app, because runs are stored per app.
  const apps = await listApps(orgId).catch(() => []);
  const subjectRuns: SubjectRun[] = [];
  for (const app of apps) {
    for (const r of await listAppRuns(app.id, orgId, 500).catch(() => [])) {
      if (!runIds.has(r.id)) continue;
      const steps =
        ((r as { steps?: { kind?: string; reviewer?: string }[] }).steps ?? []);
      subjectRuns.push({
        runId: r.id,
        appTitle: app.title,
        startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt ?? ''),
        finishedAt:
          (r as { finishedAt?: Date | string | null }).finishedAt instanceof Date
            ? ((r as { finishedAt: Date }).finishedAt).toISOString()
            : ((r as { finishedAt?: string | null }).finishedAt ?? null),
        status: String(r.status),
        reviewer: steps.find((st) => st.kind === 'human' && st.reviewer)?.reviewer ?? null,
        hadHumanStep: steps.some((st) => st.kind === 'human'),
      });
    }
  }

  // The indexed count is passed so the trail can say when it is partial — see buildSubjectAccessTrail.
  const trail = buildSubjectAccessTrail(subjectRuns, runIds.size);

  // Looking someone up IS an access event, and is itself audited — by actor, which is correct here.
  auditFromSession(gate, orgId, {
    action: 'privacy.subject.access-trail',
    resource: `subject:${masked ?? 'unrecognised'}`,
    outcome: 'ok',
  });

  return NextResponse.json({
    // Only the masked form is echoed. The raw identifier is never returned or stored.
    subject: masked,
    recognisedAs: recognised.map((t) => t.type),
    runsTouchingSubject: runIds.size,
    ...trail,
  });
}
