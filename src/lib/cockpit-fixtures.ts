// ─── Cross-Sell Cockpit synthetic data — DETERMINISTIC Indian-BFSI sample ─────────────────────────
//
// The fallback dataset the cockpit renders when the live Odoo data domain is absent/unreachable, and
// the demo seed source. Indian BFSI flavour: INR tickets, PAN/IFSC, Indian names, real-world retail
// banking products. DETERMINISTIC — no Math.random / Date.now at module load, so the dashboard,
// tests, and screenshots are byte-stable. Marked `sample` by the data layer so the UI never implies
// this is live production data.

import type { CustomerRow, PipelineStage, TrendPoint } from './cockpit-metrics';

export interface CustomerDetail extends CustomerRow {
  pan: string;
  ifsc: string;
  email: string;
  rationale: string; // the one-line, PII-free next-best-action rationale
}

const SEGMENTS = ['Priority', 'Salaried', 'SME', 'NRI'];
const REGIONS = ['Mumbai', 'Delhi NCR', 'Bengaluru', 'Pune', 'Chennai', 'Hyderabad', 'Ahmedabad'];
const PRODUCTS = [
  'Savings',
  'Salary Account',
  'Fixed Deposit',
  'Mutual Fund SIP',
  'Term Insurance',
  'Health Cover',
  'Personal Loan',
  'Home Loan',
  'Credit Card',
  'Demat',
];
const STAGES: PipelineStage[] = ['lead', 'qualified', 'proposed', 'won'];

// A hand-authored spread of customers — enough variety for a live-feeling funnel + product mix.
const NAMES = [
  'Aarav Sharma', 'Diya Patel', 'Vivaan Nair', 'Ananya Iyer', 'Aditya Reddy', 'Ishaan Menon',
  'Saanvi Rao', 'Kabir Singh', 'Myra Gupta', 'Reyansh Bose', 'Aadhya Desai', 'Arjun Malhotra',
  'Kiara Joshi', 'Vihaan Chatterjee', 'Anika Kulkarni', 'Rudra Pillai', 'Navya Bhat', 'Shaurya Kapoor',
  'Prisha Agarwal', 'Dhruv Shetty', 'Riya Fernandes', 'Ayaan Khan', 'Sara Mehta', 'Advik Ghosh',
];
const NEXT_BEST = [
  'Mutual Fund SIP', 'Term Insurance', 'Home Loan', 'Credit Card', 'Health Cover',
  'Fixed Deposit', 'Personal Loan', 'Demat', 'Salary Account', 'Mutual Fund SIP',
];
const RATIONALES = [
  'High savings balance, no market-linked product — a SIP fits the surplus.',
  'Young family, salary credited monthly — term cover closes a protection gap.',
  'Rent outflow near EMI capacity — a home loan is the next logical step.',
  'Strong inflows, no card on file — a rewards card lifts engagement.',
  'Dependents on record, no health policy — a family floater fits.',
  'Idle current-account balance — a laddered FD improves yield.',
  'Clean repayment history — pre-approved personal loan headroom.',
  'Active MF holder without demat — enable direct-equity access.',
  'Salary elsewhere — consolidate to a salary account for the full relationship.',
  'SIP lapsed last quarter — re-engage with a step-up SIP.',
];

// A tiny deterministic hash so per-customer numbers vary without Math.random (index → pseudo value).
function vary(i: number, spread: number, base: number): number {
  const h = (i * 2654435761) % 1000; // Knuth multiplicative hash, bounded
  return base + Math.round((h / 1000) * spread);
}

function makePan(i: number): string {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const a = L[i % 26] + L[(i * 3) % 26] + L[(i * 7) % 26] + 'PB' ; // ...PB → individual pan-ish
  const num = String(1000 + ((i * 271) % 9000));
  return `${a}${num}${L[(i * 5) % 26]}`;
}

const IFSCS = ['HDFC0001234', 'ICIC0004567', 'SBIN0007788', 'UTIB0002233', 'KKBK0009911'];

export function cockpitCustomers(): CustomerDetail[] {
  return NAMES.map((name, i) => {
    const segment = SEGMENTS[i % SEGMENTS.length];
    const region = REGIONS[i % REGIONS.length];
    const stage = STAGES[i % STAGES.length];
    const held = 2 + (i % 4);
    const products = PRODUCTS.slice(i % 3, (i % 3) + held);
    const aumInr = vary(i, 4_500_000, 350_000) * (segment === 'Priority' ? 4 : segment === 'NRI' ? 3 : 1);
    const opportunityInr = vary(i, 900_000, 120_000) * (segment === 'SME' ? 3 : 1);
    return {
      id: `CUST-${String(1001 + i)}`,
      name,
      segment,
      region,
      aumInr,
      products,
      nextBestProduct: NEXT_BEST[i % NEXT_BEST.length],
      stage,
      opportunityInr,
      tenureMonths: 6 + vary(i, 90, 0),
      pan: makePan(i),
      ifsc: IFSCS[i % IFSCS.length],
      email: `${name.split(' ')[0].toLowerCase()}.${name.split(' ')[1].toLowerCase()}@example.in`,
      rationale: RATIONALES[i % RATIONALES.length],
    };
  });
}

export function cockpitRows(): CustomerRow[] {
  return cockpitCustomers();
}

export function cockpitCustomer(id: string): CustomerDetail | null {
  return cockpitCustomers().find((c) => c.id === id) ?? null;
}

// A 6-month month-over-month pipeline trend (deterministic, rising) for the dashboard trend chart.
export function cockpitTrend(): TrendPoint[] {
  const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  return months.map((month, i) => ({ month, pipelineInr: 6_400_000 + i * 1_150_000 + vary(i, 600_000, 0) }));
}
