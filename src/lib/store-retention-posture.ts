// ─── How long does each store keep our data? — PURE, zero-IO ──────────────────────────────────────
//
// The roadmap's line on this cluster: "retention is a compliance claim, not a convenience — an
// unbounded audit store is a promise we cannot keep." Most of these stores set retention as a DEPLOY
// FLAG, not through an API, so the console cannot write it. That is a fine ownership boundary. What is
// not fine is the console being unable to say what the window IS.
//
// THE DISTINCTION THIS MODULE EXISTS FOR. Three answers look identical on a dashboard and are utterly
// different to an auditor:
//
//   CONFIRMED      — the store told us its window. We can state it.
//   ASSUMED        — no flag is set, so the store is on its documented default. Probably right; NOT
//                    confirmed, and the difference matters when someone signs a DPA.
//   UNKNOWN        — we could not read it. Not "unbounded", not "fine" — unknown.
//   UNBOUNDED      — the store keeps everything until a disk fills.
//
// Measured on 2026-08-05: the metrics store reports `-retentionPeriod="3"`, so that one is CONFIRMED.
// The log store's flag list contains no retention flag at all, so it is running on a default nobody
// recorded — ASSUMED at best. Reporting both as "retention configured" would be false.

export type RetentionConfidence = 'confirmed' | 'assumed-default' | 'unknown' | 'unbounded';

export interface StoreReading {
  /** Store id, matching the service inventory. */
  storeId: string;
  /** What this store holds, in the reader's words — "metrics", "logs", "traces". */
  holds: string;
  /**
   * The retention flag value exactly as the store reported it, or null when the store exposes no such
   * flag. Null is NOT zero and NOT unbounded — it is the absence of an answer.
   */
  flagValue: string | null;
  /** The store's documented default, when the product knows one. Used ONLY to mark `assumed-default`. */
  documentedDefault?: string | null;
  /** True when the read itself failed (unreachable, refused, timed out). */
  readFailed?: boolean;
  /**
   * Set when the read SUCCEEDED and the answer is that nothing bounds this store — for example a
   * search index with zero lifecycle policies. Distinct from a missing flag: we did not fail to find
   * the setting, we found that there is none, and that is a stronger and worse statement.
   */
  explicitUnbounded?: boolean;
}

export interface RetentionPosture {
  storeId: string;
  holds: string;
  confidence: RetentionConfidence;
  /** Human-readable window ("3 months", "7 days"), or null when there is nothing to state. */
  window: string | null;
  sentence: string;
}

/**
 * VictoriaMetrics-family retention values are bare numbers meaning MONTHS, or a number with a unit
 * suffix. Parsed rather than printed raw, because "3" on a compliance page is not an answer.
 */
export function describeWindow(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([smhdwyM]?)$/.exec(v);
  if (!m) return v; // an unfamiliar format is shown verbatim rather than guessed at
  const n = Number(m[1]);
  const unit = m[2];
  const plural = (word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  switch (unit) {
    case '':
    case 'M':
      return plural('month'); // the family's default unit
    case 'd':
      return plural('day');
    case 'w':
      return plural('week');
    case 'y':
      return plural('year');
    case 'h':
      return plural('hour');
    case 'm':
      return plural('minute');
    case 's':
      return plural('second');
    default:
      return v;
  }
}

/** Zero or a negative window means "keep forever" in this family — an explicit unbounded state. */
function isUnbounded(raw: string): boolean {
  const n = Number(raw.trim().replace(/[smhdwyM]$/, ''));
  return Number.isFinite(n) && n <= 0;
}

export function readPosture(reading: StoreReading): RetentionPosture {
  const base = { storeId: reading.storeId, holds: reading.holds };

  if (reading.readFailed) {
    return {
      ...base,
      confidence: 'unknown',
      window: null,
      sentence: `How long ${reading.holds} are kept could not be read from this store. That is UNKNOWN, not confirmed and not unlimited.`,
    };
  }

  if (reading.explicitUnbounded) {
    return {
      ...base,
      confidence: 'unbounded',
      window: null,
      sentence: `Nothing removes ${reading.holds} on a schedule. They accumulate until someone deletes them or the disk fills — confirmed by reading the store, not inferred from a missing setting.`,
    };
  }

  if (reading.flagValue !== null && reading.flagValue.trim() !== '') {
    if (isUnbounded(reading.flagValue)) {
      return {
        ...base,
        confidence: 'unbounded',
        window: null,
        sentence: `This store is set to keep ${reading.holds} FOREVER. Nothing removes them, so the store grows until its disk is full.`,
      };
    }
    const window = describeWindow(reading.flagValue);
    return {
      ...base,
      confidence: 'confirmed',
      window,
      sentence: `${cap(reading.holds)} are kept ${window}, confirmed by the store itself.`,
    };
  }

  // No flag set. The store is on its own default — which is usually correct and is NOT the same as
  // having been chosen. An auditor asking "who decided 7 days?" has no answer here.
  if (reading.documentedDefault) {
    const window = describeWindow(reading.documentedDefault);
    return {
      ...base,
      confidence: 'assumed-default',
      window,
      sentence: `No retention was configured, so ${reading.holds} are kept ${window} — this store's built-in default. Nobody chose it, and the store does not report it, so it is ASSUMED rather than confirmed.`,
    };
  }

  return {
    ...base,
    confidence: 'unknown',
    window: null,
    sentence: `This store reports no retention setting and has no default we can cite, so how long ${reading.holds} are kept is UNKNOWN.`,
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface PostureSummary {
  stores: RetentionPosture[];
  confirmed: number;
  /** Anything not confirmed — the number that decides whether the claim can be made at all. */
  unproven: number;
  /** True only when EVERY store confirmed a bounded window. */
  claimable: boolean;
  sentence: string;
}

/**
 * Can the deployment make its retention claim?
 *
 * ONE unconfirmed store is enough to answer no. A retention statement is about all of the data, so
 * "most stores are bounded" is not a weaker version of the claim — it is not the claim.
 */
export function summarisePosture(stores: readonly RetentionPosture[]): PostureSummary {
  const confirmed = stores.filter((s) => s.confidence === 'confirmed').length;
  const unproven = stores.length - confirmed;
  const unbounded = stores.filter((s) => s.confidence === 'unbounded');
  const unknown = stores.filter((s) => s.confidence === 'unknown');
  const assumed = stores.filter((s) => s.confidence === 'assumed-default');

  if (stores.length === 0) {
    return {
      stores: [],
      confirmed: 0,
      unproven: 0,
      claimable: false,
      sentence: 'No stores were checked, so nothing can be said about how long data is kept.',
    };
  }
  if (unproven === 0) {
    return {
      stores: [...stores],
      confirmed,
      unproven,
      claimable: true,
      sentence: `Every store confirms a limit on how long it keeps data (${confirmed} of ${stores.length}).`,
    };
  }
  const parts: string[] = [];
  if (unbounded.length) parts.push(`${unbounded.length} keeps data forever`);
  if (unknown.length) parts.push(`${unknown.length} could not be read`);
  if (assumed.length) parts.push(`${assumed.length} relies on a built-in default nobody set`);
  return {
    stores: [...stores],
    confirmed,
    unproven,
    claimable: false,
    sentence: `${confirmed} of ${stores.length} stores confirm a retention limit. ${cap(parts.join(', '))} — so a blanket statement about how long data is kept cannot be made yet.`,
  };
}
