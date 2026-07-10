// Pure logic for the NumberTicker primitive (src/components/ui/number-ticker.tsx).
//
// The console renders stats as PRE-FORMATTED strings — "1,200", "$4.2M", "98.6%", "3d". For a
// count-up animation we must: (a) recover the numeric magnitude to animate toward, and (b) know how
// to re-render an intermediate frame value with the SAME prefix/suffix/decimals/grouping as the
// target, so the ticker reads identically to the static value on its final frame. Keeping this a
// zero-IO module means it is unit-testable and reused by both the component and any test — the
// component itself stays thin presentation (motion values in, text out).

/** The parts recovered from a formatted numeric string, enough to re-render any frame value. */
export interface NumberFormat {
  /** Everything before the first digit (e.g. "$", "-$", ""). */
  prefix: string;
  /** Everything after the last digit (e.g. "%", "M", " req/s", ""). */
  suffix: string;
  /** The numeric magnitude to animate toward (sign included). NaN when no digits are present. */
  value: number;
  /** Decimal places in the source, preserved on every frame so digits do not jitter in width. */
  decimals: number;
  /** Whether the source grouped thousands with commas ("1,200" -> true, "1200" -> false). */
  grouped: boolean;
}

const NUMERIC = /-?\d[\d,]*(\.\d+)?/;

/**
 * Parse a display string into its animatable parts. A string with no digits (e.g. "n/a", "—")
 * yields value: NaN — callers treat that as "not animatable" and render the raw string.
 */
export function parseFormattedNumber(input: string): NumberFormat {
  const match = NUMERIC.exec(input);
  if (!match) {
    return { prefix: input, suffix: '', value: NaN, decimals: 0, grouped: false };
  }
  const raw = match[0];
  const start = match.index;
  const prefix = input.slice(0, start);
  const suffix = input.slice(start + raw.length);
  const grouped = raw.includes(',');
  const plain = raw.replace(/,/g, '');
  const dot = plain.indexOf('.');
  const decimals = dot === -1 ? 0 : plain.length - dot - 1;
  const value = Number(plain);
  return { prefix, suffix, value, decimals, grouped };
}

/** True when the parsed target is a finite number we can animate toward. */
export function isAnimatableNumber(fmt: NumberFormat): boolean {
  return Number.isFinite(fmt.value);
}

/**
 * Render an intermediate frame value using the target's formatting. Clamps display decimals and
 * grouping to the source so the ticking value is dimensionally identical to the final value.
 */
export function formatFrame(frame: number, fmt: NumberFormat): string {
  if (!Number.isFinite(frame)) return `${fmt.prefix}${fmt.suffix}`;
  const body = frame.toLocaleString('en-US', {
    minimumFractionDigits: fmt.decimals,
    maximumFractionDigits: fmt.decimals,
    useGrouping: fmt.grouped,
  });
  return `${fmt.prefix}${body}${fmt.suffix}`;
}

/**
 * The start value a ticker counts UP from. We never start at 0 for large magnitudes (a 6-digit
 * count-up from zero looks like a slot machine, not a data reveal); start at a fraction of target
 * so the motion reads as "settling in" - restraint over spectacle. Sign-preserving.
 */
export function countUpStart(target: number, fraction = 0): number {
  if (!Number.isFinite(target)) return 0;
  return target * fraction;
}
