// ─── One way to write a timestamp ────────────────────────────────────────────────────────────────────
//
// Two problems, one helper.
//
// 1. toLocaleString() resolves BOTH locale and time zone from whatever environment it runs in. In the App
//    Router a client component still renders on the server first, so the same instant is formatted by the
//    server's environment and again by the browser's — and when they differ the render mismatches. The
//    retention evidence card read "Last applied 8/4/2026, 8:28:04 AM", which is also unreadable as
//    evidence: an auditor cannot tell which zone that is.
//
// 2. The explicit form was being open-coded — `iso.slice(0, 19).replace('T', ' ')` appears in a dozen
//    components, each free to pick a different length and to say "UTC" or not. That is one rule in a
//    dozen places, which is how two surfaces end up stamping one event two ways.
//
// Pure. Zero imports.

/** How much of the instant to show. Minutes is the default: seconds are noise on most surfaces. */
export type StampPrecision = 'minutes' | 'seconds';

/**
 * Format an instant as an explicit UTC stamp: `2026-08-04 02:58 UTC`.
 *
 * Accepts an ISO string, a Date, or a millisecond number, because callers hold all three and converting
 * at each call site is how the `Invalid Date` cases get missed.
 *
 * Returns `fallback` for anything unparseable rather than "Invalid Date" or the epoch — a surface must
 * never present a missing timestamp as a real one.
 */
export function utcStamp(
  value: string | number | Date | null | undefined,
  { precision = 'minutes', fallback = '—' }: { precision?: StampPrecision; fallback?: string } = {},
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return fallback;
  const iso = d.toISOString();
  return `${iso.slice(0, precision === 'seconds' ? 19 : 16).replace('T', ' ')} UTC`;
}
