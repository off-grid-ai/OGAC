// ─── What needs this person, across everything ──────────────────────────────────────────────────────
//
// A department person's first question is "what needs me today?". The product could only answer it one
// app at a time: each app's own page opens with "2 cases are waiting for a person to decide" — the best
// sentence in the console — but nothing gathered those sentences up. With a dozen apps, answering the
// question meant opening a dozen pages, and the section named "Work" contained chat, not their work.
//
// This is the pure half. Zero IO.

/** A case waiting on a person, as this screen needs it. */
export interface WaitingCase {
  runId: string;
  appId: string;
  appTitle: string;
  /** What the case is about, in the author's words. Blank is tolerated and handled. */
  subject?: string | null;
  /** ISO timestamp the case started waiting. */
  waitingSince: string;
  /** Deep link to the place the decision is actually made. */
  href: string;
}

export interface AppSummary {
  id: string;
  title: string;
  /** False for a draft — a person should not be sent to run something not yet live. */
  published: boolean;
  /** How work reaches it, already in plain words. */
  howWorkArrives?: string;
}

export interface MyWorkGroup {
  appId: string;
  appTitle: string;
  cases: WaitingCase[];
  /** Age of the OLDEST case here, in whole days. Drives the ordering and the nudge. */
  oldestDays: number;
}

export interface MyWork {
  /** Every waiting case, oldest first — see the ordering note below. */
  cases: WaitingCase[];
  /** The same cases grouped by app, most-overdue app first. */
  groups: MyWorkGroup[];
  totalWaiting: number;
  /** One sentence naming what is on their plate. */
  headline: string;
  /** Apps with nothing waiting, so the screen also answers "what can I start?". */
  idle: AppSummary[];
  /** True when there is nothing waiting AND nothing runnable. */
  isEmpty: boolean;
}

/** Whole days between two instants, floored, never negative. Unparseable dates read as 0. */
export function daysWaiting(since: string, now: Date): number {
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/**
 * How a case is described when its input carries no subject.
 *
 * Deliberately NOT the run id. A row reading "Case proof_msd05iih" tells a person nothing and is what
 * the per-app queue currently falls back to; an unnamed case is better described by what it is and
 * when it arrived than by an identifier they cannot act on.
 */
export function caseLabel(c: WaitingCase, now: Date): string {
  const subject = c.subject?.trim();
  if (subject) return subject;
  const days = daysWaiting(c.waitingSince, now);
  if (days === 0) return 'Unnamed case · arrived today';
  return `Unnamed case · waiting ${days} day${days === 1 ? '' : 's'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "03 Aug 14:33" — formatted explicitly, NOT via toLocaleString.
 *
 * app-work-queue.ts already records why: toLocaleString resolves the locale AND time zone from the
 * environment, so it renders one way on the server and another in the browser. That mismatch broke this
 * page's first deploy once already, and this is the same trap one module over. UTC is stated so the
 * reader is never shown a time whose zone is a guess.
 */
function startedAtText(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'a time we did not record';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** How long it has been waiting, in words a person reads without doing arithmetic. */
export function waitedFor(since: string, now: Date): string {
  const ms = now.getTime() - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function headlineFor(waiting: number, runnable: number): string {
  if (waiting === 0 && runnable === 0) {
    return 'Nothing is set up for you yet.';
  }
  if (waiting === 0) {
    return 'Nothing is waiting for you.';
  }
  if (waiting === 1) {
    return '1 case is waiting for you to decide.';
  }
  return `${waiting} cases are waiting for you to decide.`;
}

/**
 * Build the "what needs me" screen.
 *
 * ORDERING IS OLDEST-FIRST, and that is deliberate. Every other list in the console is newest-first,
 * which is right for watching activity and wrong here: the case that has sat for three days is the one
 * that matters, and a newest-first queue buries it further every time new work arrives.
 */
export function buildMyWork(
  cases: readonly WaitingCase[],
  apps: readonly AppSummary[],
  now: Date,
): MyWork {
  const oldestFirst = [...cases].sort((a, b) => {
    const ta = Date.parse(a.waitingSince);
    const tb = Date.parse(b.waitingSince);
    // An unparseable timestamp sorts last rather than throwing or jumping to the top.
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return ta - tb;
  });

  const byApp = new Map<string, WaitingCase[]>();
  for (const c of oldestFirst) {
    const list = byApp.get(c.appId);
    if (list) list.push(c);
    else byApp.set(c.appId, [c]);
  }

  const groups: MyWorkGroup[] = [...byApp.entries()]
    .map(([appId, list]) => ({
      appId,
      appTitle: list[0].appTitle,
      cases: list,
      oldestDays: daysWaiting(list[0].waitingSince, now),
    }))
    // Most overdue app first; ties broken by how much is piled up.
    .sort((a, b) => b.oldestDays - a.oldestDays || b.cases.length - a.cases.length);

  // "What can I start?" only offers PUBLISHED apps — sending someone to run a draft is a dead end.
  const withWaiting = new Set(byApp.keys());
  const idle = apps.filter((a) => a.published && !withWaiting.has(a.id));

  return {
    cases: oldestFirst,
    groups,
    totalWaiting: oldestFirst.length,
    headline: headlineFor(oldestFirst.length, apps.filter((a) => a.published).length),
    idle,
    isEmpty: oldestFirst.length === 0 && idle.length === 0,
  };
}

/**
 * Make every label in a group distinguishable.
 *
 * Three cases of the same claim record produced three rows reading exactly
 * "Meera Malhotra · submitted · 41,346.44 · 2025-09-16" — a person cannot tell them apart, cannot tell
 * whether it is one case shown thrice or three real ones, and cannot safely act on any of them. That is
 * precisely the failure a case subject exists to prevent, so where labels collide the arrival time is
 * appended — the one thing that genuinely differs. Labels that are already unique are left alone.
 */
export function disambiguate(
  cases: readonly WaitingCase[],
  now: Date,
  label: (c: WaitingCase, now: Date) => string = caseLabel,
): { case: WaitingCase; label: string }[] {
  const counts = new Map<string, number>();
  for (const c of cases) {
    const l = label(c, now);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return cases.map((c) => {
    const l = label(c, now);
    if ((counts.get(l) ?? 0) < 2) return { case: c, label: l };
    return { case: c, label: `${l} · started ${startedAtText(c.waitingSince)}` };
  });
}

/**
 * A nudge for a group that has been waiting too long, or null when it hasn't.
 *
 * Returns null rather than a reassuring "on track" string: this screen should be quiet when there is
 * nothing wrong, and a row of green ticks trains people to stop reading it.
 */
export function overdueNote(group: MyWorkGroup): string | null {
  if (group.oldestDays >= 7) {
    return `Oldest has been waiting ${group.oldestDays} days — nobody has picked this up.`;
  }
  if (group.oldestDays >= 2) {
    return `Oldest has been waiting ${group.oldestDays} days.`;
  }
  return null;
}

// ─── The apps list, ordered by what needs a person ───────────────────────────────────────────────────
//
// The list showed name, step count, trigger and audience — and neither of the two things that decide
// whether a person opens a card: whether it is LIVE, and whether anything is waiting in it. The app's
// own page opens with "2 cases are waiting for a person to decide"; the list one level up knew nothing,
// so "what needs me?" meant opening twelve cards in turn.

export interface AppListEntry {
  id: string;
  published: boolean;
  /** Cases paused for a person in this app. */
  waiting: number;
}

/** What the card should say about its state, in the owner's language. Null = say nothing. */
export function appStateNote(entry: AppListEntry): { text: string; tone: 'attention' | 'draft' } | null {
  if (entry.waiting > 0) {
    return {
      text: `${entry.waiting} waiting for a decision`,
      tone: 'attention',
    };
  }
  if (!entry.published) {
    // Not a failure — a draft is a normal state — but a person should know before they open it that
    // no work can reach it yet.
    return { text: 'Draft — not live, no work reaches it yet', tone: 'draft' };
  }
  return null;
}

/**
 * Order the list so the cards that need a person come first.
 *
 * Ties keep the caller's order (stable), so an alphabetical list stays alphabetical within each band.
 * Drafts sink BELOW live apps with nothing waiting: a draft is the least urgent thing on the screen,
 * and leaving them interleaved is what made the list read as twelve equivalent options.
 */
export function orderAppsByAttention<T extends AppListEntry>(entries: readonly T[]): T[] {
  const band = (e: AppListEntry) => (e.waiting > 0 ? 0 : e.published ? 1 : 2);
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => band(a.e) - band(b.e) || b.e.waiting - a.e.waiting || a.i - b.i)
    .map((x) => x.e);
}

// ─── "Which one of these do I use?" ──────────────────────────────────────────────────────────────────
//
// The demo tenant carries "Expense Claim Approval (fidelity check)", "Expense Claim Approval Process",
// "Reimbursement Approval" and "Reimbursement Approval (copy)"; also "Personal Loan Underwriting" and
// "Personal Loan Underwriting Assist". A person cannot tell which one to run, and picking wrong is
// silent — they only find out when the wrong process happens.
//
// Deleting the near-duplicates would fix this tenant and not the problem: any org that duplicates an
// app to try a change lands in the same place. So the list SAYS SO instead. A warning is the right
// strength here — we cannot know that two similar names are actually redundant, and blocking or hiding
// one on a name match would eventually hide the app somebody needed.

/** Words too common to make two names similar. */
const STOPWORDS = new Set([
  'the', 'and', 'a', 'an', 'of', 'for', 'to', 'with', 'process', 'copy', 'new', 'v2', 'test', 'draft',
  'assist', 'check', 'approval', 'verification',
]);

function significantWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Titles that a reader could confuse, keyed by app id.
 *
 * Similarity is on the SIGNIFICANT words only: "Reimbursement Approval" vs "Reimbursement Approval
 * (copy)" differ by a parenthetical and the word "copy", neither of which tells anyone which to use.
 * "Fraud Screening" vs "Fraud Alert Triage" share only "fraud" and are genuinely different jobs, so
 * they are deliberately NOT flagged — a warning on every card would be noise, and noise gets ignored.
 */
export function confusableTitles(
  apps: readonly { id: string; title: string }[],
): Record<string, string[]> {
  const words = apps.map((a) => ({ ...a, words: significantWords(a.title) }));
  const out: Record<string, string[]> = {};
  for (const a of words) {
    if (a.words.size === 0) continue;
    const twins: string[] = [];
    for (const b of words) {
      if (b.id === a.id || b.words.size === 0) continue;
      const shared = [...a.words].filter((w) => b.words.has(w)).length;
      // Confusable when one name's significant words are entirely contained in the other's — that is
      // what "X" vs "X Process" and "X" vs "X (copy)" actually look like.
      const contained = shared === Math.min(a.words.size, b.words.size);
      if (contained && shared > 0) twins.push(b.title);
    }
    if (twins.length) out[a.id] = twins;
  }
  return out;
}
