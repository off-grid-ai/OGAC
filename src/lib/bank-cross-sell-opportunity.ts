import type {
  CrossSellOpportunityView,
  CrossSellRecommendation,
} from '@/lib/bank-cross-sell-contract';

export interface BankCrossSellSourceSnapshot {
  customerDomain: string;
  eligibilityDomain: string;
  customerResource: string;
  eligibilityResource: string;
  readAt: string;
  customerRows: Record<string, unknown>[];
  eligibilityRows: Record<string, unknown>[];
}

interface EligibleScheme {
  name: string;
  minimumGroupSize: number;
  ageBandRate: number;
  record: string;
}

function text(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function amount(row: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function list(row: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function priorityIndustry(rows: readonly Record<string, unknown>[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const industry = text(row, ['industry', 'sector']);
    if (industry) counts.set(industry, (counts.get(industry) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount || left.localeCompare(right),
    )[0]?.[0] ?? ''
  );
}

function eligibleScheme(rows: readonly Record<string, unknown>[]): EligibleScheme | null {
  const schemes = new Map<string, EligibleScheme>();
  rows.forEach((row, index) => {
    const name = text(row, ['scheme_type', 'scheme', 'product', 'product_name']);
    if (!name) return;
    const minimumGroupSize = amount(row, ['min_group_size', 'minimum_group_size']);
    const ageBand = text(row, ['age_band', 'ageBand']);
    const rate = amount(row, ['base_rate_per_mille', 'base_rate', 'rate']);
    const current = schemes.get(name);
    const next: EligibleScheme = {
      name,
      minimumGroupSize,
      ageBandRate: /31\s*[-–]\s*40/.test(ageBand) ? rate : Number.POSITIVE_INFINITY,
      record: text(row, ['id', 'rate_id']) || String(index + 1),
    };
    if (!current) {
      schemes.set(name, next);
      return;
    }
    current.minimumGroupSize = Math.min(current.minimumGroupSize, minimumGroupSize);
    if (next.ageBandRate < current.ageBandRate) {
      current.ageBandRate = next.ageBandRate;
      current.record = next.record;
    }
  });
  return (
    [...schemes.values()].sort(
      (left, right) =>
        left.minimumGroupSize - right.minimumGroupSize ||
        left.ageBandRate - right.ageBandRate ||
        left.name.localeCompare(right.name),
    )[0] ?? null
  );
}

function recommendation(
  snapshot: BankCrossSellSourceSnapshot,
  customer: Record<string, unknown>,
  industry: string,
  priority: string,
  scheme: EligibleScheme | null,
  customerId: string,
): CrossSellRecommendation | null {
  if (!scheme || !priority) return null;
  const groupSize = amount(customer, ['group_size', 'member_count', 'employee_count']);
  const constraints: string[] = [];
  if (industry !== priority) {
    constraints.push(`The governed cohort policy currently prioritises ${priority}.`);
  }
  if (groupSize === 0) {
    constraints.push(
      `Customer group size is not available to prove the minimum of ${scheme.minimumGroupSize}.`,
    );
  } else if (groupSize < scheme.minimumGroupSize) {
    constraints.push(
      `Customer group size ${groupSize} is below the governed minimum of ${scheme.minimumGroupSize}.`,
    );
  }
  const eligible = constraints.length === 0;
  const rate = Number.isFinite(scheme.ageBandRate)
    ? `${scheme.ageBandRate} per mille for age 31–40`
    : 'the currently governed rate card';
  return {
    product: scheme.name,
    rationale: `${priority} is the largest customer cohort. ${scheme.name} has the lowest minimum group size (${scheme.minimumGroupSize}) and ${rate}.`,
    confidence: eligible ? 0.86 : 0.68,
    eligible,
    constraints,
    citations: [
      {
        source: snapshot.customerDomain,
        record: `${snapshot.customerResource}/${customerId}`,
        label: 'Live customer relationship',
      },
      {
        source: snapshot.eligibilityDomain,
        record: `${snapshot.eligibilityResource}/${scheme.record}`,
        label: 'Live eligibility rate card',
      },
    ],
  };
}

/** Build the RM opportunity book only from the two live governed source reads. */
export function assembleBankCrossSellOpportunities(
  snapshot: BankCrossSellSourceSnapshot,
): CrossSellOpportunityView[] {
  const priority = priorityIndustry(snapshot.customerRows);
  const scheme = eligibleScheme(snapshot.eligibilityRows);
  return snapshot.customerRows.flatMap((row, index) => {
    const customerId = text(row, ['customer_id', 'account_id', 'id']);
    const customerName = text(row, ['customer_name', 'account_name', 'name']);
    if (!customerId || !customerName) return [];
    const industry = text(row, ['industry', 'sector']);
    return [
      {
        opportunityId: text(row, ['opportunity_id', 'opportunityId']) || `candidate:${customerId}`,
        customerId,
        customerName,
        relationshipManager:
          text(row, ['relationship_manager', 'rm_name', 'owner']) || 'Unassigned',
        segment: text(row, ['segment', 'tier']) || 'Not recorded',
        region: text(row, ['region', 'city', 'branch_region']) || 'Not recorded',
        currentProducts: list(row, ['current_products', 'holdings', 'products']),
        opportunityValueInr: amount(row, ['opportunity_value_inr', 'cross_sell_value_inr']),
        source: {
          kind: 'live' as const,
          customerDomain: snapshot.customerDomain,
          eligibilityDomain: snapshot.eligibilityDomain,
          readAt: snapshot.readAt,
        },
        recommendation: recommendation(snapshot, row, industry, priority, scheme, customerId),
        runId: null,
        rmDecision: { status: 'pending' as const, reason: null, reviewer: null, decidedAt: null },
        actionReceipt: null,
        outcomes: [],
      },
    ];
  });
}
