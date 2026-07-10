// @offgrid/finops — budget enforcement policy.

import type { Policy, PolicyContext } from './gateway-types.js';
import type { FinopsStore } from './store.js';

export interface BudgetOptions {
  monthlyUsd: number;
  per?: 'caller' | 'org';
  store: FinopsStore;
}

/**
 * Denies calls once the relevant spend meets or exceeds the monthly budget.
 * per:'caller' scopes the budget to each caller; per:'org' (default) uses the
 * projected monthly org-wide spend.
 */
export function budgetPolicy(opts: BudgetOptions): Policy {
  const per = opts.per ?? 'org';
  return {
    name: 'finops-budget',
    pre(ctx: PolicyContext): void {
      const spend =
        per === 'caller'
          ? opts.store.spendForCaller(ctx.caller)
          : opts.store.projectedMonthlyUsd();
      if (spend >= opts.monthlyUsd) {
        ctx.deny = {
          status: 402,
          message: 'monthly budget exceeded',
          policy: 'finops-budget',
        };
      }
    },
  };
}
