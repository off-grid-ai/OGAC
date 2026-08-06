// ─── Money, in the reader's currency and their digit grouping ─────────────────────────────────────────
//
// The console showed `COST $0.00`, `VALUE OF TIME SAVED $0` and `@ $75/hr loaded cost` to a tenant that
// is an Indian bank — PAN, IFSC, rupee claim amounts throughout. Seeded run outcomes carried
// "Awaiting human review — Priya Iyer, $1,13,858": a dollar sign in front of a number grouped the INDIAN
// way, which is the worst of both and reads as a bug to anyone in either market.
//
// Pure. Zero IO.

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/** The default for this product's market. Overridable per org. */
export const DEFAULT_CURRENCY: CurrencyCode = 'INR';

const SYMBOL: Record<CurrencyCode, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED ',
  SGD: 'S$',
};

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);
}

export function currencySymbol(c: CurrencyCode): string {
  return SYMBOL[c] ?? '';
}

/**
 * Group digits the way the currency's market does.
 *
 * INR groups the last three then twos — 1,13,858 not 113,858 — and getting that wrong is immediately
 * visible to an Indian reader. Implemented directly rather than via toLocaleString, which resolves the
 * locale from the environment: that renders one way during SSR and another after hydration, the exact
 * mismatch this codebase has already been bitten by twice.
 */
export function groupForCurrency(whole: string, currency: CurrencyCode): string {
  if (currency !== 'INR') return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (whole.length <= 3) return whole;
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

export interface MoneyOptions {
  /** Show paise/cents. Off by default: operator dashboards read better in whole units. */
  decimals?: boolean;
}

/** "₹1,13,858" / "$113,858". Negatives get a true minus sign, not a hyphen. */
export function formatMoney(
  amount: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  opts: MoneyOptions = {},
): string {
  if (!Number.isFinite(amount)) return `${currencySymbol(currency)}0`;
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const fixed = opts.decimals ? abs.toFixed(2) : String(Math.round(abs));
  const [whole, fraction] = fixed.split('.');
  const grouped = groupForCurrency(whole, currency);
  const body = `${currencySymbol(currency)}${grouped}${fraction ? `.${fraction}` : ''}`;
  return negative ? `−${body}` : body;
}

/**
 * A cost we did not actually measure.
 *
 * Showing `₹0.00` for an unmeasured cost is the defect, not the fix: a zero reads as "this is free",
 * which is a claim we cannot make. Cost is attributed on a small fraction of ledger events and the demo
 * runs on free models, so the honest output says so.
 */
export function formatCostOrUnmeasured(
  amount: number | null | undefined,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  attributedEvents = 1,
): { text: string; measured: boolean } {
  if (amount == null || attributedEvents === 0) {
    return { text: 'Not measured', measured: false };
  }
  if (amount === 0) {
    // Genuinely zero spend is possible (a local model costs nothing per call) — but it must not be
    // presented as a measured money figure, because the reader cannot tell it from "we did not look".
    return { text: `${currencySymbol(currency)}0 — no chargeable model calls`, measured: true };
  }
  return { text: formatMoney(amount, currency, { decimals: amount < 100 }), measured: true };
}

/** "₹6,000/hr" — the rate an estimate is built from. */
export function formatRate(amount: number, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  return `${formatMoney(amount, currency)}/hr`;
}

// ─── Converting the gateway's USD costs into the org's currency ───────────────────────────────────
//
// The gateway prices model usage in USD — that is how model pricing is quoted, and local inference is
// $0 — while an org states value in its own currency. Those two met without conversion: roi-reader.ts
// notes the AI cost "passes straight through — no currency conversion", and the ROI page then renders
// it with formatAmount, which uses the org currency. So a USD figure was labelled ₹ and SUBTRACTED
// from a rupee value to produce "net value".
//
// It has been invisible because the demo's AI cost rounds to zero (~$0.05 → ₹0), but it is a
// correctness bug, not a formatting one: at any real spend the net value is wrong by the FX rate.
//
// The rate is explicit and overridable rather than hard-coded to a number someone has to trust. It is
// deliberately NOT fetched live: a finance figure that changes silently between two page loads is
// worse than one that is stated, and an offline-first product must not depend on an FX API.
export const DEFAULT_USD_RATES: Readonly<Record<CurrencyCode, number>> = {
  USD: 1,
  INR: 88,
  EUR: 0.92,
  GBP: 0.78,
  AED: 3.67,
  SGD: 1.35,
};

/**
 * Convert an amount in USD into `currency`.
 *
 * `rates` can override the defaults (an org setting, a test). An unknown or non-finite rate falls back
 * to 1 — leaving the number unconverted and visibly in the wrong currency — rather than silently
 * zeroing a cost, because a cost that vanishes reads as "free" and that is the dangerous failure here.
 */
export function convertUsd(
  usd: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  rates: Readonly<Record<string, number>> = DEFAULT_USD_RATES,
): number {
  if (!Number.isFinite(usd)) return 0;
  const rate = rates[currency];
  return usd * (Number.isFinite(rate) && rate > 0 ? rate : 1);
}
