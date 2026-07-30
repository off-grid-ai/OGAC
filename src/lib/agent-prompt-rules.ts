// ─── House rules appended to a compiled agent's prompt — pure ──────────────────────────────────────
//
// G-UX5. A compiled app reported a claim as "$41,346.44" for an Indian BFSI tenant (live run
// apprun_76864dd2). Nothing in the data says dollars: the source column is a bare decimal, and the model
// supplied a symbol because nothing told it not to.
//
// The console already decided how to handle this. app-work-queue.ts:209 states it plainly — no currency
// symbol is added, because the module "cannot know the tenant's currency, and guessing one would be a
// lie on the screen". Every display surface honours that. The AGENT was simply never told, so it guessed,
// and its guess lands in the run outcome, the report and the reviewer's inbox.
//
// So this is not a new policy — it is the existing one, applied where it was being broken. The real fix
// for showing ₹ is a per-org currency setting that the prompt and the UI both read; until that exists,
// reporting the figure exactly as the record states it is the truthful option, and it is strictly better
// than a confident wrong symbol.

/**
 * The fidelity rules every compiled REASONING agent gets.
 *
 * Deliberately about faithfulness to the record rather than formatting: a governed run's answer is read
 * as a statement about the source data, so a value the sources do not contain — a currency symbol, a
 * rounded total, a filled-in gap — misstates the record even when the arithmetic is right.
 */
export const SOURCE_FIDELITY_RULE =
  'Report values exactly as the sources state them. Do not add a currency symbol: the records do not ' +
  'specify one, and inventing one would misstate them. If the sources do not contain something you ' +
  'need, say so plainly rather than estimating it.';

/**
 * Append the house rules to an authored prompt.
 *
 * Idempotent, so recompiling an app cannot stack the rule up, and a no-op on an empty prompt — an empty
 * system prompt is the caller's fallback path to handle, not something to quietly fill with house rules.
 */
export function withSourceFidelityRule(prompt: string): string {
  const base = prompt.trim();
  if (!base) return base;
  if (base.includes(SOURCE_FIDELITY_RULE)) return base;
  return `${base}\n\n${SOURCE_FIDELITY_RULE}`;
}
