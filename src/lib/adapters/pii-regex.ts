import type { PiiResult } from './types';

// Pure, zero-runtime-import PII regex floor — the always-on default detector. Kept separate
// from pii.ts (which wires in Presidio + the guardrails registry) so this rule can be
// unit-tested in isolation with no mocks, the same way tenancy-policy.ts isolates its rule.

export const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
export const PHONE = /\b\+?\d[\d ()-]{7,}\d\b/g;

// ─── Indian BFSI PII floor (G-F2) ────────────────────────────────────────────
// The bharatunion tenant's entire seed is Indian financial data, so the always-on floor (used on
// the interactive chat path and whenever Presidio isn't reachable) MUST catch PAN / Aadhaar / IFSC
// / UPI. Every pattern is anchored on word boundaries and format-precise to keep false positives
// low. ORDER MATTERS in regexScan (see below) — the most specific shapes run first.

// PAN — Permanent Account Number: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). No other
// 10-char token mixes letters+digits in this exact layout, so the shape alone is highly specific
// and we don't over-gate on context.
export const IN_PAN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;

// IFSC — bank branch code: 4 letters (bank), a literal 0 (reserved), then 6 alphanumerics
// (e.g. HDFC0001234). The mandatory `0` in position 5 makes this shape almost impossible to hit by
// accident.
export const IN_IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

// CARD — a payment card number in its printed forms. This rule MUST run BEFORE Aadhaar.
//
// LIVE BUG (2026-07-29): `card 4111 1111 1111 1111` came back as `card [AADHAAR] 1111`. The Aadhaar
// rule's spaced 4-4-4 alternative matched the card's FIRST TWELVE digits — `4111 1111 1111` — and the
// trailing \b was satisfied because a space follows. So a card was both mislabelled as Aadhaar and
// left partly in the clear, and the engine's own card scanner never saw it because the floor had
// already rewritten the text. Consuming the card shape first removes the collision at the source.
//
// Matched forms: 4-4-4-4 and 4-6-5 (Amex) with a CONSISTENT separator (backreference, so `1111 2222`
// mixed with `-` doesn't match), plus unspaced runs carrying a known major-issuer prefix — Visa,
// Mastercard (both 5x and 2x ranges), Amex, Discover, and RuPay (60/65/81/82), which matters here
// because the tenants are Indian. Requiring a real prefix keeps a 16-digit order id from matching.
export const CARD =
  /\b(?:\d{4}([ -])\d{4}\1\d{4}\1\d{1,4}|\d{4}([ -])\d{6}\2\d{5}|4\d{12}(?:\d{3})?|5[1-5]\d{14}|2[2-7]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12}|(?:60|65|81|82)\d{14})\b/g;

// Aadhaar — 12-digit UIDAI number, printed as 4-4-4 groups (`2345 6789 0123`) or unspaced
// (`234567890123`). Three precision guards keep it off other digit runs:
//   1. The leading digit of a real Aadhaar is 2–9 (UIDAI never issues numbers starting 0 or 1),
//      so a leading-0/1 twelve-digit id won't match.
//   2. Only the CANONICAL forms fire: 4-4-4 with a single space/hyphen between groups, or a bare
//      12-digit run on its own word boundaries.
//   3. A trailing negative lookahead rejects a match FOLLOWED BY another digit group. \b alone was
//      not enough for the spaced form — a space satisfies it — which is exactly how a 16-digit card
//      got eaten. The CARD rule above already consumes cards; this is the second line of defence,
//      so an unusual grouping (a 20-digit reference in 4-4-4-4-4) can't resurface the same bug.
export const IN_AADHAAR =
  /\b[2-9][0-9]{3}[ -][0-9]{4}[ -][0-9]{4}\b(?![ -]?[0-9])|\b[2-9][0-9]{11}\b/g;

// UPI VPA — Virtual Payment Address: `handle@psp` (e.g. ramesh@okhdfc, 98765@paytm). The PSP side
// is letters-only (2+), which is what separates a VPA from an email: an email's domain has a dotted
// TLD (`@gmail.com`). We therefore forbid a dot in the PSP part so real emails fall through to the
// EMAIL rule instead of being mislabelled UPI. The handle allows the UPI-legal char set but must
// start and end on an alphanumeric so a trailing `.`/`-` isn't captured.
export const IN_UPI = /\b[a-zA-Z0-9](?:[a-zA-Z0-9.\-_]*[a-zA-Z0-9])?@[a-zA-Z]{2,}\b/g;

// A single detect-and-redact pass for a labelled pattern. We deliberately do NOT use `.test()`:
// every pattern here carries `/g`, and `.test()` on a global regex advances `lastIndex` and
// persists it on the shared object — so every *other* call would start mid-string and silently
// miss PII. `replace` resets `lastIndex` to 0 when it finishes, so reusing the shared regex is
// safe, and a changed string is an exact "was there a hit" signal.
function applyRule(
  text: string,
  entities: string[],
  regex: RegExp,
  label: string,
  entityType: string,
): string {
  const after = text.replace(regex, label);
  if (after !== text) entities.push(entityType);
  return after;
}

// Order is load-bearing — most specific shape first, because each rule redacts in place and later
// rules only ever see already-redacted text:
//   • EMAIL before UPI      — a real email (dotted TLD) is consumed as EMAIL, never mislabelled UPI.
//   • IFSC and PAN before the numeric rules — a labelled `[IFSC]` token can't be re-scanned as digits.
//   • CARD before AADHAAR   — a 16-digit card's first 12 digits otherwise match Aadhaar's spaced
//                             4-4-4 form (the live bug: `4111 1111 1111 1111` → `[AADHAAR] 1111`).
//   • AADHAAR before PHONE  — a 12-digit Aadhaar also satisfies the loose PHONE shape, and Aadhaar is
//                             the more specific (and more sensitive) claim.
export function regexScan(text: string): PiiResult {
  const entities: string[] = [];
  let redacted = text;

  redacted = applyRule(redacted, entities, EMAIL, '[EMAIL]', 'EMAIL_ADDRESS');
  redacted = applyRule(redacted, entities, IN_UPI, '[UPI]', 'UPI_ID');
  redacted = applyRule(redacted, entities, IN_IFSC, '[IFSC]', 'IN_IFSC');
  redacted = applyRule(redacted, entities, IN_PAN, '[PAN]', 'IN_PAN');
  redacted = applyRule(redacted, entities, CARD, '[CARD]', 'CREDIT_CARD');
  redacted = applyRule(redacted, entities, IN_AADHAAR, '[AADHAAR]', 'IN_AADHAAR');
  redacted = applyRule(redacted, entities, PHONE, '[PHONE]', 'PHONE_NUMBER');

  return { hits: entities.length > 0, entities, redacted, engine: 'regex' };
}
