// ─── Cross-Sell Cockpit metrics (USE-surface) — PURE, zero-IO ─────────────────────────────────────
//
// The pure rollup behind the RM Cross-Sell Cockpit's dashboard + weekly digest. It takes a flat list
// of customer/holding rows (whatever the live Odoo data domain returns, or the synthetic fallback in
// cockpit-fixtures.ts) and computes the KPI band, the cross-sell funnel, the product mix, a
// month-over-month pipeline trend, and the ranked top opportunities. No imports, no I/O — every
// number here is unit-testable in isolation (test/cockpit-metrics.test.ts). All money is INR.

export type PipelineStage = 'lead' | 'qualified' | 'proposed' | 'won';

// The win-probability we weight a stage by when ranking opportunities by expected value. A proposed
// deal is worth more of its ticket than a raw lead — this is the one judgement call and it lives here.
export const STAGE_PROBABILITY: Record<PipelineStage, number> = {
  lead: 0.15,
  qualified: 0.4,
  proposed: 0.7,
  won: 1,
};

export const PIPELINE_STAGES: PipelineStage[] = ['lead', 'qualified', 'proposed', 'won'];

// One customer of the bank, with their current holdings and (optionally) the live cross-sell play.
export interface CustomerRow {
  id: string;
  name: string;
  segment: string; // Priority | Salaried | SME | NRI
  region: string; // Mumbai | Delhi | Bengaluru | …
  aumInr: number; // assets under management with the bank, in rupees
  products: string[]; // products the customer already holds
  nextBestProduct: string; // the suggested cross-sell product
  stage: PipelineStage; // where this cross-sell opportunity sits
  opportunityInr: number; // ticket size of the cross-sell opportunity, in rupees
  tenureMonths: number;
}

export interface Kpi {
  totalAumInr: number;
  customerCount: number;
  pipelineValueInr: number; // sum of open (non-won) opportunity tickets
  wonValueInr: number;
  conversionRate: number; // won / total opportunities, 0..1
  expectedPipelineInr: number; // probability-weighted open pipeline
}

export interface FunnelStage {
  stage: PipelineStage;
  count: number;
  valueInr: number;
}

export interface ProductSlice {
  product: string;
  holders: number;
}

export interface TrendPoint {
  month: string; // 'Feb', 'Mar', …
  pipelineInr: number;
}

export interface Opportunity {
  customerId: string;
  customer: string;
  segment: string;
  region: string;
  currentProducts: string[];
  nextBestProduct: string;
  stage: PipelineStage;
  opportunityInr: number;
  expectedValueInr: number; // opportunityInr × stage probability
}

export interface CockpitMetrics {
  kpi: Kpi;
  funnel: FunnelStage[];
  productMix: ProductSlice[];
  topOpportunities: Opportunity[];
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

export function computeKpi(rows: CustomerRow[]): Kpi {
  const open = rows.filter((r) => r.stage !== 'won');
  const won = rows.filter((r) => r.stage === 'won');
  const total = rows.length;
  return {
    totalAumInr: sum(rows.map((r) => r.aumInr)),
    customerCount: total,
    pipelineValueInr: sum(open.map((r) => r.opportunityInr)),
    wonValueInr: sum(won.map((r) => r.opportunityInr)),
    conversionRate: total === 0 ? 0 : won.length / total,
    expectedPipelineInr: sum(open.map((r) => r.opportunityInr * STAGE_PROBABILITY[r.stage])),
  };
}

export function computeFunnel(rows: CustomerRow[]): FunnelStage[] {
  return PIPELINE_STAGES.map((stage) => {
    const inStage = rows.filter((r) => r.stage === stage);
    return { stage, count: inStage.length, valueInr: sum(inStage.map((r) => r.opportunityInr)) };
  });
}

export function computeProductMix(rows: CustomerRow[]): ProductSlice[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.products) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([product, holders]) => ({ product, holders }))
    .sort((a, b) => b.holders - a.holders);
}

// Rank the open opportunities by probability-weighted expected value — the RM's "call these first"
// list. Won deals are excluded (they're closed, not opportunities). Ties break by ticket size then id
// so the ordering is deterministic (no stable-sort ambiguity across engines / test runs).
export function computeTopOpportunities(rows: CustomerRow[], limit = 8): Opportunity[] {
  return rows
    .filter((r) => r.stage !== 'won')
    .map((r) => ({
      customerId: r.id,
      customer: r.name,
      segment: r.segment,
      region: r.region,
      currentProducts: r.products,
      nextBestProduct: r.nextBestProduct,
      stage: r.stage,
      opportunityInr: r.opportunityInr,
      expectedValueInr: Math.round(r.opportunityInr * STAGE_PROBABILITY[r.stage]),
    }))
    .sort(
      (a, b) =>
        b.expectedValueInr - a.expectedValueInr ||
        b.opportunityInr - a.opportunityInr ||
        a.customerId.localeCompare(b.customerId),
    )
    .slice(0, Math.max(0, limit));
}

export function computeCockpitMetrics(rows: CustomerRow[]): CockpitMetrics {
  return {
    kpi: computeKpi(rows),
    funnel: computeFunnel(rows),
    productMix: computeProductMix(rows),
    topOpportunities: computeTopOpportunities(rows),
  };
}

// ─── INR formatting (PURE) — the Indian numbering the whole cockpit renders in ─────────────────────
// Rupees → a compact "₹1.2 Cr" / "₹34.5 L" / "₹8,200" string. Crore = 1e7, Lakh = 1e5. Kept here so
// every surface (dashboard, table, digest email) formats money ONE way.
export function formatInr(rupees: number): string {
  const n = Math.round(rupees);
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.00$/, '')} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// Mask a PAN like ABCDE1234F → ABCDE****F for display (never show the full PAN on a shared surface).
export function maskPan(pan: string): string {
  if (pan.length < 10) return pan;
  return `${pan.slice(0, 5)}****${pan.slice(9)}`;
}
