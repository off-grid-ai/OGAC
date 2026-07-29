// ─── The manual-entry prompt, DERIVED from the app itself — PURE ─────────────────────────────────────
//
// When an app declares no inputForm, the run screen fell back to a single required field labelled
// "Input". A grievance officer cannot act on that: nothing says whether it wants a customer name, a
// policy number, or a sentence describing what happened.
//
// The fix is NOT to hand-author form fields per app. docs/APP_AS_PRODUCT.md §3 rules that out — an app
// is "a web app, but not with customUI fields". Work normally ARRIVES from an existing enterprise flow;
// manual entry is the fallback path, and it should describe itself using what the app already knows.
//
// So the prompt is derived, and the example is a REAL previous case from this same app. That teaches the
// format better than any invented placeholder, and it cannot drift from reality because it IS reality.
//
// Zero-IO: the caller supplies the app's facts and its most recent case subject.

/** How work normally reaches this app — decides whether manual entry is the norm or the exception. */
export type EntryContext = 'on-demand' | 'arrives' | (string & {});

export interface RunInputPrompt {
  /** Field label. Plain language, never a schema name. */
  label: string;
  /** One line telling the reader what to type, ending with a real prior case when one exists. */
  hint: string;
  /** Greyed sample text in the box. Empty when we have no real case to quote. */
  placeholder: string;
}

/** Trigger kinds where work turns up on its own, so typing a case by hand is the exception. */
const ARRIVES = new Set(['webhook', 'email', 'whatsapp', 'schedule']);

export interface RunInputPromptInput {
  /** The app's trigger kind. */
  trigger?: string | null;
  /** A subject line from a REAL previous run of this app, if there is one. */
  exampleSubject?: string | null;
}

/**
 * The prompt for the single free-text entry field.
 *
 * Never invents an example. With no prior case the hint stays generic rather than showing a fabricated
 * one — a made-up "e.g. ₹12,000 travel claim for Priya" on an app that has never run would teach the
 * reader a format the app may not accept.
 */
export function runInputPrompt(input: RunInputPromptInput = {}): RunInputPrompt {
  const example = input.exampleSubject?.trim();
  const arrives = ARRIVES.has(String(input.trigger ?? ''));

  const base = arrives
    ? 'Cases normally arrive on their own. Use this to enter one by hand.'
    : 'Describe the case in a line, the way it would come in.';

  return {
    label: 'The case to work on',
    hint: example ? `${base} For example: ${example}` : base,
    placeholder: example ?? '',
  };
}
