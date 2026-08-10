// ─── Counted nouns (PURE, zero-IO) ───────────────────────────────────────────────────────────────
//
// "1 actions" and "1 triggers" appeared on most of the 193 cards in the action catalogue. Small on its
// own, and exactly the kind of thing a buyer reads as carelessness on a page whose job is to look like
// a serious platform.

/**
 * A count and its noun, agreeing.
 *
 * `plural(1, 'action')` → "1 action"; `plural(3, 'action')` → "3 actions". Irregular plurals are
 * passed explicitly rather than guessed — English is not derivable, and a rule that tries produces
 * "1 entrys" eventually.
 */
export function plural(count: number, noun: string, pluralForm?: string): string {
  const n = Number.isFinite(count) ? count : 0;
  const word = n === 1 ? noun : (pluralForm ?? `${noun}s`);
  return `${n.toLocaleString('en-IN')} ${word}`;
}
