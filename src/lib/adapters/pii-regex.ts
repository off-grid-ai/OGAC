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

// Aadhaar — 12-digit UIDAI number, printed as 4-4-4 groups (`2345 6789 0123`) or unspaced
// (`234567890123`). Two precision guards keep it off arbitrary 12-digit order/txn ids:
//   1. The leading digit of a real Aadhaar is 2–9 (UIDAI never issues numbers starting 0 or 1),
//      so a leading-0/1 twelve-digit id won't match.
//   2. We only fire on the CANONICAL forms: 4-4-4 with a single space/hyphen between groups, OR a
//      bare 12-digit run standing on its own word boundary. A longer digit run (a 16-digit card,
//      an 18-digit order id) fails the \b on the trailing side and is left alone.
// The spaced 4-4-4 form is by itself an extremely strong Aadhaar signal.
export const IN_AADHAAR = /\b[2-9][0-9]{3}[ -][0-9]{4}[ -][0-9]{4}\b|\b[2-9][0-9]{11}\b/g;

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

// Order is load-bearing. EMAIL runs before UPI so a real email (dotted TLD) is consumed as EMAIL
// and never reaches the UPI rule. IFSC runs before PAN is irrelevant (disjoint shapes) but IFSC
// and PAN both run before the numeric Aadhaar rule so a labelled `[IFSC]` token can't be re-scanned
// as digits. Each rule redacts in place, so later rules scan already-redacted text.
export function regexScan(text: string): PiiResult {
  const entities: string[] = [];
  let redacted = text;

  redacted = applyRule(redacted, entities, EMAIL, '[EMAIL]', 'EMAIL_ADDRESS');
  redacted = applyRule(redacted, entities, IN_UPI, '[UPI]', 'UPI_ID');
  redacted = applyRule(redacted, entities, IN_IFSC, '[IFSC]', 'IN_IFSC');
  redacted = applyRule(redacted, entities, IN_PAN, '[PAN]', 'IN_PAN');
  redacted = applyRule(redacted, entities, IN_AADHAAR, '[AADHAAR]', 'IN_AADHAAR');
  redacted = applyRule(redacted, entities, PHONE, '[PHONE]', 'PHONE_NUMBER');

  return { hits: entities.length > 0, entities, redacted, engine: 'regex' };
}
