import type { PiiResult } from './types';

// Pure, zero-runtime-import PII regex floor — the always-on default detector. Kept separate
// from pii.ts (which wires in Presidio + the guardrails registry) so this rule can be
// unit-tested in isolation with no mocks, the same way tenancy-policy.ts isolates its rule.

export const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
export const PHONE = /\b\+?\d[\d ()-]{7,}\d\b/g;

// Detect-and-redact in one pass via `replace`. We deliberately do NOT use `.test()` here:
// both regexes carry `/g`, and `.test()` on a global regex advances `lastIndex` and persists
// it on the shared object — so every *other* call would start mid-string and silently miss
// PII. `replace` resets `lastIndex` to 0 when it finishes, so reusing the shared regex is
// safe, and a changed string is an exact "was there a hit" signal.
export function regexScan(text: string): PiiResult {
  const entities: string[] = [];
  let redacted = text;

  const afterEmail = redacted.replace(EMAIL, '[EMAIL]');
  if (afterEmail !== redacted) entities.push('EMAIL_ADDRESS');
  redacted = afterEmail;

  const afterPhone = redacted.replace(PHONE, '[PHONE]');
  if (afterPhone !== redacted) entities.push('PHONE_NUMBER');
  redacted = afterPhone;

  return { hits: entities.length > 0, entities, redacted, engine: 'regex' };
}
