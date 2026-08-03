// ─── The nudge that tells someone work is waiting ────────────────────────────────────────────────────
//
// Nothing told a person a case needed them. The in-console badge fixes that for someone already looking
// at the console; it does nothing for someone who isn't. Measured consequence on this tenant: cases sat
// for ten days under "nobody has picked this up".
//
// This is the pure half: who should be told, and what the message says. Zero IO.

export interface DigestCase {
  appTitle: string;
  label: string;
  daysWaiting: number;
}

export interface DigestRecipient {
  email: string;
  role: string;
}

/**
 * Who to tell.
 *
 * Only people whose role can actually decide a case. Emailing someone who will arrive and find every
 * button refused is worse than not emailing them — it teaches them the notification is noise, and then
 * the real ones get ignored too.
 *
 * This is deliberately role-based and therefore blunt: there is no per-app owner or assignee yet, so it
 * cannot be narrowed further. When ownership lands, this should narrow to the owner.
 */
export function digestRecipients(
  users: readonly { email?: string | null; role?: string | null }[],
  /**
   * Cover in force today. Someone away is dropped from the list and whoever covers them is added.
   *
   * Nudging a person on leave about work they cannot do is how a team learns to ignore these messages,
   * and then the real ones get ignored too. Adding the cover is the other half — an absence with cover
   * named should move the nudge, not silence it.
   */
  cover: readonly { away: string; coveredBy: string }[] = [],
): DigestRecipient[] {
  const canDecide = new Set(['admin', 'compliance', 'editor', 'member', 'lead']);
  const away = new Set(cover.map((c) => c.away.trim().toLowerCase()).filter(Boolean));
  const standIns = cover
    .map((c) => c.coveredBy.trim().toLowerCase())
    .filter((e) => e.includes('@'));

  const seen = new Set<string>();
  const out: DigestRecipient[] = [];
  for (const u of users) {
    const email = u.email?.trim().toLowerCase();
    const role = (u.role ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    if (!canDecide.has(role)) continue;
    if (away.has(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, role });
  }
  // A named stand-in is told even if their own role would not have put them on the list: they were
  // explicitly asked to cover, which is a stronger signal than a role table.
  for (const s of standIns) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ email: s, role: 'covering' });
  }
  return out;
}

/** Days a case must have waited before it is worth interrupting somebody about. */
export const NUDGE_AFTER_DAYS = 1;

/**
 * Which cases justify a message.
 *
 * Not everything waiting — only what has waited long enough that nobody is evidently already on it. A
 * digest that fires the moment a case arrives is indistinguishable from noise, and the failure mode we
 * are fixing is a ten-day-old case, not a ten-minute-old one.
 */
export function casesWorthNudging(
  cases: readonly DigestCase[],
  afterDays = NUDGE_AFTER_DAYS,
): DigestCase[] {
  return [...cases].filter((c) => c.daysWaiting >= afterDays).sort((a, b) => b.daysWaiting - a.daysWaiting);
}

export interface DigestMessage {
  subject: string;
  text: string;
}

/**
 * The message.
 *
 * Written as the person's work, not as a platform event: it leads with the oldest thing, says how long it
 * has been sitting, and links straight to where the decision is made. No platform vocabulary, no counts
 * of "runs", no mention of apps as a concept.
 */
export function buildDigest(cases: readonly DigestCase[], consoleUrl: string): DigestMessage | null {
  const worth = casesWorthNudging(cases);
  if (worth.length === 0) return null;

  const oldest = worth[0];
  const subject =
    worth.length === 1
      ? `1 case is waiting for your decision (${oldest.daysWaiting} day${oldest.daysWaiting === 1 ? '' : 's'})`
      : `${worth.length} cases are waiting for your decision`;

  const lines = worth
    .slice(0, 10)
    .map(
      (c) =>
        `  · ${c.label} — ${c.appTitle}, waiting ${c.daysWaiting} day${c.daysWaiting === 1 ? '' : 's'}`,
    );
  const more = worth.length > 10 ? `\n  …and ${worth.length - 10} more.` : '';

  const text = [
    worth.length === 1
      ? 'A case has been waiting for someone to decide it.'
      : `${worth.length} cases have been waiting for someone to decide them.`,
    '',
    'Oldest first:',
    lines.join('\n') + more,
    '',
    `Decide them here: ${consoleUrl.replace(/\/$/, '')}/work/tasks`,
    '',
    // Said plainly, because a person who cannot act on this needs to know why they got it.
    'You are getting this because your account can decide these cases.',
  ].join('\n');

  return { subject, text };
}
