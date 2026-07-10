// @offgrid/finops — console FinOps plane snapshot + integrations catalog.

import type { DailySpend, FinopsStore, Totals } from './store.js';

export interface FinopsReport {
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
export function toFinopsReport(store: FinopsStore): FinopsReport {
  return {
    byModel: store.spendByModel(),
    byCaller: store.spendByCaller(),
    byGateway: store.spendByGateway(),
    daily: store.dailySpend(),
    projectedMonthly: store.projectedMonthlyUsd(),
    totals: store.totals(),
    generatedAt: Date.now(),
    currency: 'USD',
  };
}

export interface FinopsIntegration {
  id: string;
  name: string;
  category: 'finops';
}

export const FINOPS_INTEGRATIONS: FinopsIntegration[] = [
  { id: 'builtin', name: 'Built-in cost tracker', category: 'finops' },
  { id: 'console-finops', name: 'Off Grid Console FinOps plane', category: 'finops' },
  { id: 'csv-export', name: 'CSV export', category: 'finops' },
  { id: 'cloudability', name: 'Apptio Cloudability', category: 'finops' },
  { id: 'opencost', name: 'OpenCost', category: 'finops' },
];
