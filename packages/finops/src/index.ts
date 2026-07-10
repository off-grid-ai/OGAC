// @offgrid/finops — plug-and-play FinOps (cost + budget) layer for the Off Grid
// local AI gateway. Attributes cost per call, tracks spend, enforces budgets,
// and exports a snapshot for the console FinOps plane.

export type {
  TrafficRecord,
  ObservabilitySink,
  GatewayNode,
  PolicyContext,
  PolicyOutcome,
  Policy,
} from './gateway-types.js';

export {
  PRICING,
  LOCAL_MODEL_COST,
  priceFor,
  costOf,
  type ModelPrice,
  type CostBreakdown,
} from './pricing.js';

export {
  FinopsStore,
  finopsSink,
  type Totals,
  type DailySpend,
} from './store.js';

export { budgetPolicy, type BudgetOptions } from './policy.js';

export {
  toFinopsReport,
  FINOPS_INTEGRATIONS,
  type FinopsReport,
  type FinopsIntegration,
} from './report.js';
