// ─── Who has looked at this person's file? ────────────────────────────────────────────────────────────
//
// `WHATS_MISSING_2.md` #2: the audit trail is indexed by ACTOR and never by DATA SUBJECT. Measured then:
// 397 audit rows name an actor, 0 name a subject. So "who in the bank looked at Meera Malhotra's file, and
// when?" — the first question in any complaint, insider-risk investigation or regulator visit — could not
// be answered. The platform could say what a *person did*; it could not say who touched a *customer*.
//
// I recorded this as still-open. Checking properly, most of it was already there and nobody had joined it:
//   · `subject_chunk_index` already maps a salted subject fingerprint → the RUNS mentioning that person
//     (152 rows on the live tenant), because erasure needed it.
//   · every app run already records WHO decided it — `reviewer` on the human step — and when.
// The missing thing was not recording. It was the join.
//
// `audit_events_v2.run_id` is NOT usable for this: it is empty on these runs, so joining through the audit
// ledger returns nothing and would report "nobody has accessed this person's file" about a person whose
// file twelve runs had touched. That is the worst possible false negative here, so the trail is built from
// the runs themselves, which is where the evidence actually is.
//
// Pure. Zero IO.

export interface SubjectRun {
  runId: string;
  /** The app that handled it, by title — never its id. */
  appTitle: string;
  /** ISO. */
  startedAt: string;
  /** ISO, or null while unfinished. */
  finishedAt?: string | null;
  status: string;
  /** Signed-in identity of whoever approved/rejected it, when a person did. */
  reviewer?: string | null;
  /** Whether the run paused for a person at all. */
  hadHumanStep?: boolean;
}

export interface AccessEvent {
  /** Who — an email, or null when no person was recorded. */
  who: string | null;
  /** What they did, in plain words. */
  what: string;
  /** ISO of when it happened. */
  when: string;
  appTitle: string;
  runId: string;
}

export interface SubjectAccessTrail {
  events: AccessEvent[];
  /** Runs that touched this person where NO person is recorded as having handled them. */
  unattributed: number;
  /** Distinct people who handled a case about this person. */
  people: string[];
  /** Records the index says mention them that can no longer be opened. Reported, never dropped. */
  missing: number;
  /** One sentence. Never claims nobody accessed the file when the read could not attribute one. */
  sentence: string;
}

/**
 * Who handled cases about this person, newest first.
 *
 * A run with no recorded reviewer is counted as UNATTRIBUTED and reported, never dropped and never
 * silently credited to the system. "Twelve runs touched this person and we can name who handled nine of
 * them" is a usable answer; "nine people accessed this file" implying that is all of them is not.
 */
export function buildSubjectAccessTrail(
  runs: readonly SubjectRun[],
  /**
   * How many runs the subject index says mention this person.
   *
   * Passed separately because it can EXCEED the runs we can read: measured live, a subject was indexed
   * against 12 runs of which only 3 still exist — the rest went when their apps were deleted. Reporting
   * the 3 without saying so would present a partial access history as the whole of it, which on this
   * question is the difference between an answer and a misleading one.
   */
  indexedRunCount?: number,
): SubjectAccessTrail {
  const ordered = [...runs]
    .filter((r) => Number.isFinite(Date.parse(r.startedAt)))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  const events: AccessEvent[] = [];
  const people = new Set<string>();
  let unattributed = 0;

  for (const r of ordered) {
    const who = r.reviewer?.trim() || null;
    if (who) {
      people.add(who);
      events.push({
        who,
        what: r.status === 'error' ? 'reviewed and rejected a case about this person' : 'decided a case about this person',
        // The decision happened when the run finished, not when it started; fall back to the start only
        // when there is no finish time, and never invent one.
        when: r.finishedAt ?? r.startedAt,
        appTitle: r.appTitle,
        runId: r.runId,
      });
    } else {
      unattributed++;
      events.push({
        who: null,
        what: r.hadHumanStep
          ? 'a case about this person is waiting for someone to decide'
          : 'the platform processed a case about this person with no person involved',
        when: r.startedAt,
        appTitle: r.appTitle,
        runId: r.runId,
      });
    }
  }

  const named = [...people].sort();
  let sentence: string;
  if (ordered.length === 0) {
    // NOT "nobody accessed this file". No records found is not proof of no access.
    sentence =
      'No records mentioning this person were found, so nothing is known about who has seen their data.';
  } else if (named.length === 0) {
    sentence = `${ordered.length} ${ordered.length === 1 ? 'case' : 'cases'} about this person were handled by the platform, and none of them records a person as having decided it.`;
  } else {
    const tail =
      unattributed > 0
        ? ` ${unattributed} further ${unattributed === 1 ? 'case' : 'cases'} touched their data with no person recorded.`
        : '';
    sentence = `${named.length} ${named.length === 1 ? 'person has' : 'people have'} decided a case about this person: ${named.join(', ')}.${tail}`;
  }

  // Indexed but unreadable: the person is mentioned in records we can no longer open. Said plainly.
  const missing = Math.max(0, (indexedRunCount ?? ordered.length) - ordered.length);
  const withMissing =
    missing > 0
      ? `${sentence} A further ${missing} ${missing === 1 ? 'record' : 'records'} mentioning them can no longer be opened — the app that produced ${missing === 1 ? 'it' : 'them'} has since been deleted.`
      : sentence;

  return { events, unattributed, people: named, missing, sentence: withMissing };
}
