interface TrafficRecord {
    ts: number;
    gateway: string;
    model: string;
    modelServed?: string;
    kind: 'text' | 'image' | 'embedding';
    status: number;
    ms: number;
    bytes: number;
    tokens: number;
    promptTokens?: number;
    completionTokens?: number;
    caller?: string;
    corrId?: string;
}
interface ObservabilitySink {
    readonly name: string;
    record(e: TrafficRecord): void;
}
interface GatewayNode {
    name: string;
    host: string;
    port: number;
    model: string;
}
interface PolicyContext {
    caller: string;
    corrId: string;
    model: string;
    image: boolean;
    body: Record<string, unknown>;
    target: GatewayNode;
    candidates: GatewayNode[];
    deny?: {
        status: number;
        message: string;
        policy: string;
    };
    shortCircuit?: {
        status: number;
        json: unknown;
        from: string;
    };
    meta: Record<string, unknown>;
}
interface PolicyOutcome {
    status: number;
    output: string;
    promptTokens: number;
    completionTokens: number;
    streamed: boolean;
    raw?: unknown;
}
interface Policy {
    readonly name: string;
    pre?(ctx: PolicyContext): void | Promise<void>;
    post?(ctx: PolicyContext, o: PolicyOutcome): void | Promise<void>;
}

interface ModelPrice {
    inputPer1k: number;
    outputPer1k: number;
    currency: 'USD';
}
/**
 * Estimated blended cost per 1k tokens for a local / self-hosted model.
 * Off Grid runs models on the user's own hardware, so there is no API price —
 * this stands in for electricity + hardware amortization. Configurable.
 */
declare const LOCAL_MODEL_COST = 0.00002;
/** Reference prices. Frontier prices are for attribution when a call is routed
 *  to a hosted model; local models resolve via priceFor() to LOCAL_MODEL_COST. */
declare const PRICING: Record<string, ModelPrice>;
/**
 * Resolve a price for a model id. Exact match wins; otherwise fuzzy substring
 * match (both directions). Known local model families and unknown models fall
 * back to the local estimate.
 */
declare function priceFor(model: string, pricing?: Record<string, ModelPrice>): ModelPrice;
interface CostBreakdown {
    inputCost: number;
    outputCost: number;
    total: number;
    currency: string;
}
/**
 * Cost of a single traffic record. Uses promptTokens/completionTokens when
 * present; otherwise splits `tokens` 50/50 between input and output.
 */
declare function costOf(record: TrafficRecord, pricing?: Record<string, ModelPrice>): CostBreakdown;

interface Totals {
    totalUsd: number;
    totalTokens: number;
    requests: number;
}
interface DailySpend {
    day: string;
    usd: number;
    tokens: number;
    requests: number;
}
declare class FinopsStore {
    private entries;
    private pricing;
    constructor(pricing?: Record<string, ModelPrice>);
    ingest(e: TrafficRecord): void;
    private groupBy;
    spendByModel(): Record<string, number>;
    spendByCaller(): Record<string, number>;
    spendByGateway(): Record<string, number>;
    /** Spend for the trailing `days` (default 30), one bucket per UTC day. */
    dailySpend(days?: number): DailySpend[];
    /** Extrapolate a 30-day spend from the trailing `windowDays` (default 7). */
    projectedMonthlyUsd(windowDays?: number): number;
    /** Accumulated spend for a single caller (all time). */
    spendForCaller(caller: string): number;
    totals(): Totals;
}
declare function finopsSink(store: FinopsStore): ObservabilitySink;

interface BudgetOptions {
    monthlyUsd: number;
    per?: 'caller' | 'org';
    store: FinopsStore;
}
/**
 * Denies calls once the relevant spend meets or exceeds the monthly budget.
 * per:'caller' scopes the budget to each caller; per:'org' (default) uses the
 * projected monthly org-wide spend.
 */
declare function budgetPolicy(opts: BudgetOptions): Policy;

interface FinopsReport {
    byModel: Record<string, number>;
    byCaller: Record<string, number>;
    byGateway: Record<string, number>;
    daily: DailySpend[];
    projectedMonthly: number;
    totals: Totals;
    generatedAt: number;
    currency: 'USD';
}
/** Plain JSON snapshot the console FinOps plane can render directly. */
declare function toFinopsReport(store: FinopsStore): FinopsReport;
interface FinopsIntegration {
    id: string;
    name: string;
    category: 'finops';
}
declare const FINOPS_INTEGRATIONS: FinopsIntegration[];

export { type BudgetOptions, type CostBreakdown, type DailySpend, FINOPS_INTEGRATIONS, type FinopsIntegration, type FinopsReport, FinopsStore, type GatewayNode, LOCAL_MODEL_COST, type ModelPrice, type ObservabilitySink, PRICING, type Policy, type PolicyContext, type PolicyOutcome, type Totals, type TrafficRecord, budgetPolicy, costOf, finopsSink, priceFor, toFinopsReport };
