// ─── Is this app's data still arriving? ──────────────────────────────────────────────────────────────
//
// Freshness and broken-sync are tracked on the warehouse catalogue, and the app owner is never told. The
// obvious fix — join the app's data domains to the catalogue's assets — is one I deliberately did NOT
// build: measured earlier on this tenant, 0 of 16 assets carry a domain_id and no name match exists
// between `bharatunion.dim_customer` and `bhcon_corebank/customers`. Building on that join would produce
// a warning that is silently always-empty, which is worse than no warning.
//
// What IS observable is the app's own reads. A connector step that errored, or that returned nothing
// where it used to return rows, is the operator-visible form of "the source went stale" — and it comes
// from the app's real runs rather than a catalogue it is not connected to.
//
// Pure. Zero IO.

export interface ReadStep {
  /** The step's own words, e.g. "claims (claims): 20 row(s)." */
  outcome?: string | null;
  status?: string;
  kind?: string;
  label?: string;
}

export interface RunReads {
  /** ISO. */
  startedAt: string;
  steps: readonly ReadStep[];
}

/** Rows a data step reported reading, or null when it did not say. */
export function rowsRead(step: ReadStep): number | null {
  const m = /(\d[\d,]*)\s+row/i.exec(step.outcome ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export type SourceState = 'ok' | 'failing' | 'empty' | 'unknown';

export interface SourceHealth {
  state: SourceState;
  /** What to tell the owner. Null when there is nothing worth saying. */
  warning: string | null;
}

/**
 * Judge an app's data reads from its recent runs.
 *
 * The comparison is deliberately "the latest run against the earlier ones": a step returning zero rows
 * is only news if it USED to return some. An app that has always read zero rows is either new or filters
 * hard, and warning about it every day would train the owner to ignore the banner.
 */
export function sourceHealth(runs: readonly RunReads[]): SourceHealth {
  const ordered = [...runs]
    .filter((r) => Number.isFinite(Date.parse(r.startedAt)))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  if (ordered.length === 0) return { state: 'unknown', warning: null };

  const dataSteps = (r: RunReads) => r.steps.filter((s) => s.kind === 'connector-query');
  const latest = ordered[0];

  // A read that ERRORED is unambiguous and worth saying immediately, without waiting for a pattern.
  const errored = dataSteps(latest).find((s) => s.status === 'error');
  if (errored) {
    return {
      state: 'failing',
      warning: `This app could not read ${errored.label ?? 'one of its data sources'} on its last run. Until that is fixed it is working from nothing.`,
    };
  }

  const latestRows = dataSteps(latest).map(rowsRead).filter((n): n is number => n !== null);
  if (latestRows.length === 0) return { state: 'unknown', warning: null };
  const latestTotal = latestRows.reduce((a, b) => a + b, 0);
  if (latestTotal > 0) return { state: 'ok', warning: null };

  // Zero now — did it ever read anything? Only then is it news.
  const priorTotals = ordered
    .slice(1)
    .map((r) => dataSteps(r).map(rowsRead).filter((n): n is number => n !== null))
    .filter((xs) => xs.length > 0)
    .map((xs) => xs.reduce((a, b) => a + b, 0));

  const everHadData = priorTotals.some((t) => t > 0);
  if (!everHadData) {
    // Always empty: not a regression, and saying "your source went stale" would be a fabricated cause.
    return { state: 'unknown', warning: null };
  }

  const best = Math.max(...priorTotals);
  return {
    state: 'empty',
    warning: `This app read no data on its last run — it used to read ${best.toLocaleString()} rows. The source it depends on has probably stopped updating.`,
  };
}
