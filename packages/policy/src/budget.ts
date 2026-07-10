// @offgrid/policy — rolling token budget, keyed by caller or model.
// Tracks token spend in a sliding window; denies once the window tally hits the cap.

import type { Policy, PolicyContext, PolicyOutcome } from './gateway-types.js';

export interface BudgetOptions {
  /** Max tokens allowed within the window per key. */
  maxTokens: number;
  /** Sliding window length in ms. Default: 60_000. */
  windowMs?: number;
  /** Budget key dimension. Default: 'caller'. */
  per?: 'caller' | 'model';
}

interface Entry {
  ts: number;
  tokens: number;
}

export function budget(opts: BudgetOptions): Policy {
  const per = opts.per ?? 'caller';
  const windowMs = opts.windowMs ?? 60_000;
  const ledgers = new Map<string, Entry[]>();

  const keyOf = (ctx: PolicyContext): string => (per === 'model' ? ctx.model : ctx.caller);

  /** Drop entries older than the window and return the surviving list + sum. */
  const prune = (key: string, now: number): { entries: Entry[]; total: number } => {
    const cutoff = now - windowMs;
    const kept = (ledgers.get(key) ?? []).filter((e) => e.ts >= cutoff);
    ledgers.set(key, kept);
    let total = 0;
    for (const e of kept) total += e.tokens;
    return { entries: kept, total };
  };

  return {
    name: 'budget',
    pre(ctx: PolicyContext): void {
      const now = Date.now();
      const { total } = prune(keyOf(ctx), now);
      if (total >= opts.maxTokens) {
        ctx.deny = { status: 429, message: 'token budget exceeded', policy: 'budget' };
      }
    },
    post(ctx: PolicyContext, o: PolicyOutcome): void {
      const spent = (o.promptTokens || 0) + (o.completionTokens || 0);
      if (spent <= 0) return;
      const key = keyOf(ctx);
      const entries = ledgers.get(key) ?? [];
      entries.push({ ts: Date.now(), tokens: spent });
      ledgers.set(key, entries);
    },
  };
}
