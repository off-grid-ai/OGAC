// ─── One read of "what is waiting for a person" ──────────────────────────────────────────────────────
//
// Three surfaces answer this question — the My tasks screen, the out-of-band digest, and now the home
// screen — and each was assembling it from scratch: list the apps, list the runs, keep the ones paused on
// a human, drop the ones whose app is gone, map to a case, group. Same rule, three copies, free to drift.
//
// This is the one composition. It is deliberately thin: the JUDGEMENT stays in `buildMyWork` (pure), and
// this only does the two reads and the shaping that both callers need identically.

import { listAppRunsView } from './app-runs-view-reader';
import { listApps } from './apps-store';
import { runSubject } from './app-work-queue';
import { buildMyWork, type AppSummary, type MyWork, type WaitingCase } from './my-work';

export interface MyWorkRead {
  work: MyWork;
  /** Every waiting case, before any query filter — callers that filter do it themselves. */
  cases: WaitingCase[];
  summaries: AppSummary[];
  /**
   * False when either underlying read failed.
   *
   * A failed read must never present as an empty queue: "nothing is waiting for you" is the single most
   * dangerous thing this platform can say incorrectly, because the reader stops looking.
   */
  complete: boolean;
}

export async function readMyWork(orgId: string, now: Date, runLimit = 300): Promise<MyWorkRead> {
  let complete = true;
  const apps = await listApps(orgId).catch(() => {
    complete = false;
    return [];
  });
  const runs = await listAppRunsView(undefined, orgId, runLimit).catch(() => {
    complete = false;
    return [];
  });

  const titleById = new Map(apps.map((a) => [a.id, a.title]));
  const cases: WaitingCase[] = runs
    .filter((r) => String(r.status) === 'awaiting_human')
    // A run whose app has been deleted cannot be acted on — sending someone to a dead page is worse
    // than leaving it out, and it is counted nowhere else either.
    .filter((r) => titleById.has(r.appId))
    .map((r) => ({
      runId: r.id,
      appId: r.appId,
      appTitle: titleById.get(r.appId) ?? r.appId,
      subject: runSubject((r as { input?: unknown }).input),
      waitingSince: String(r.startedAt ?? ''),
      // Straight to where the evidence is, so the decision is made having seen the case.
      href: `/solutions/apps/${encodeURIComponent(r.appId)}/runs/${encodeURIComponent(r.id)}`,
    }));

  const summaries: AppSummary[] = apps.map((a) => ({
    id: a.id,
    title: a.title,
    published: Boolean((a as { published?: boolean }).published),
  }));

  return { work: buildMyWork(cases, summaries, now), cases, summaries, complete };
}
