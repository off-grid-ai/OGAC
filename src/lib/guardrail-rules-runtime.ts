// ─────────────────────────────────────────────────────────────────────────────────────────────
// Guardrail-rules RUNTIME enforcement (the missing consumer).
//
// The console lets operators CREATE guardrail rules — a matcher (a named PII entity type OR a raw
// regex) + an action (redact | mask | hash | allow | block | flag | log) — stored in `guardrails_rules` and loaded into
// OrgContext (org-context.ts). Until now NOTHING consumed them on the run path: the runtime PII
// engine reads a DIFFERENT table (`presidio_recognizers`), so an operator's console-authored rule
// never actually fired. This module closes that loop.
//
// SOLID seam:
//   • applyGuardrailRules() — PURE, zero-IO, exhaustively unit-testable. Given the org's rules and a
//     piece of text (+ the entity types the PII detector already found, so an `entity` matcher can
//     act on a detector hit it can't re-derive from a regex), it returns the enforced verdict +
//     the transformed (redacted/masked/hashed) text. No DB, no registry, no `headers()`.
//   • loadEnforcedGuardrailRules() — the thin I/O adapter: load the org's enabled rules from the
//     store. Best-effort; a load failure degrades to "no operator rules" so the base guardrail floor
//     (regex/Presidio) still runs — a broken deep layer is never a hard failure.
//
// The check adapter in checks.ts wires these together as the `guardrail-rules` pre-check.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { GuardrailRule, RuleAction } from '@/lib/guardrails-rules';

// The verdict a set of guardrail rules produces for one piece of text. Mirrors the CheckVerdict
// vocabulary so checks.ts can stamp it straight onto a CheckResult without translation.
export type GuardrailRuleVerdict = 'pass' | 'warn' | 'redacted' | 'blocked';

// Verdict precedence — the strongest wins across all fired rules. A single `block` match denies the
// whole run regardless of what else fired; a transform outranks a mere warning; warn outranks pass.
const VERDICT_RANK: Record<GuardrailRuleVerdict, number> = {
  pass: 0,
  warn: 1,
  redacted: 2,
  blocked: 3,
};
function strongest(a: GuardrailRuleVerdict, b: GuardrailRuleVerdict): GuardrailRuleVerdict {
  return VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a;
}

export interface GuardrailRuleOutcome {
  /** 'blocked' when a matched `block` rule denies the run; 'redacted' when any rule transformed the
   *  text; 'warn' when only `flag`/`log` rules matched (recorded, not enforced); 'pass' when no
   *  enabled rule matched. */
  verdict: GuardrailRuleVerdict;
  /** The text AFTER every matched transform rule was applied (redact/mask/hash). Equal to the input
   *  when nothing matched, so a caller can safely substitute it into the outbound query. */
  text: string;
  /** The rules that fired, with the action taken — for the audit detail + the run trace. */
  fired: { label: string; matcher: string; pattern: string; action: RuleAction }[];
}

// A stable deterministic non-cryptographic hash (FNV-1a, 32-bit) for the `hash` action. We do NOT
// pull in `crypto` here so this module stays a pure, importable-anywhere rule; the goal of `hash`
// is a consistent pseudonymous token that survives across a session, NOT a security primitive.
function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Actions that TRANSFORM the matched span (rewrite the text). The other actions (allow / block /
// flag / log) never rewrite: allow exempts, block denies the run, flag/log observe. Keeping this a
// single predicate means the matcher branches below decide "transform or just detect a match" once.
const TRANSFORM_ACTIONS = new Set<RuleAction>(['redact', 'mask', 'hash']);
function isTransform(action: RuleAction): boolean {
  return TRANSFORM_ACTIONS.has(action);
}

// The verdict a NON-transform enforcement action contributes when it matches.
//   • block      → 'blocked' (deny the run).
//   • flag / log → 'warn'    (record, don't enforce).
//   • allow      → 'pass'    (exemption; recorded as fired but never escalates the verdict).
function nonTransformVerdict(action: RuleAction): GuardrailRuleVerdict {
  if (action === 'block') return 'blocked';
  if (action === 'flag' || action === 'log') return 'warn';
  return 'pass';
}

// The replacement token an action substitutes for a matched span.
//   • redact → a typed placeholder `[<LABEL>]` (the detector's convention, positionally stable).
//   • mask   → a fixed-width mask so the shape is hidden but "something was here" is visible.
//   • hash   → a deterministic pseudonym `<hash:xxxxxxxx>` so the same value maps to the same token.
//   • allow / block / flag / log → NEVER reached here (they don't transform — handled before this).
function replacementFor(action: RuleAction, matched: string, label: string): string {
  switch (action) {
    case 'mask':
      return '****';
    case 'hash':
      return `<hash:${fnv1aHex(matched)}>`;
    case 'redact':
    default:
      return `[${label.toUpperCase()}]`;
  }
}

// Replace every match of `re` in `text`, reporting whether anything changed. `re` MUST be global.
function replaceAll(
  text: string,
  re: RegExp,
  action: RuleAction,
  label: string,
): { text: string; changed: boolean } {
  let changed = false;
  const out = text.replace(re, (m) => {
    changed = true;
    return replacementFor(action, m, label);
  });
  return { text: out, changed };
}

/**
 * Apply an org's guardrail rules to a piece of text. PURE — zero I/O.
 *
 * Semantics (deterministic, order = the rules array order):
 *   • enabled === false rules are skipped entirely.
 *   • action 'allow' is an EXEMPTION signal, not a transform: it does nothing to the text (its role
 *     is "explicitly permit this pattern"). Recorded as fired so the audit shows the allow decision.
 *   • actions 'redact' | 'mask' | 'hash' TRANSFORM every match (regex) / adopt the detector's
 *     redacted text (entity) → verdict escalates to 'redacted'.
 *   • action 'block' DENIES the run when the pattern matches — no transform, verdict 'blocked'.
 *   • actions 'flag' | 'log' RECORD a warning when the pattern matches — no transform, no block,
 *     verdict 'warn'. This lets an operator observe a pattern without enforcing.
 *   • matcher 'regex' → compile the pattern (global) and act on every match.
 *   • matcher 'entity' → act on a detector-found entity of that type. A pure function can't re-run
 *     the PII detector, so the caller passes `detectedEntities` (the entity TYPES the PII check
 *     found) and the detector's already-redacted text; an `entity` rule fires when its type is in
 *     `detectedEntities` and (for a transform action) the outcome adopts the detector's redacted
 *     text (raw PII is never reported as a clean pass).
 *
 * The returned verdict is the STRONGEST across all fired rules (blocked > redacted > warn > pass).
 * A single matched `block` rule denies the whole run. `text` carries the transformed form (only
 * transform actions change it); block/flag/log leave it untouched (the run is denied or merely
 * observed, not rewritten).
 */
export function applyGuardrailRules(
  input: string,
  rules: GuardrailRule[],
  detectedEntities: string[] = [],
  detectorRedactedText?: string,
): GuardrailRuleOutcome {
  const fired: GuardrailRuleOutcome['fired'] = [];
  let text = input;
  let verdict: GuardrailRuleVerdict = 'pass';

  const record = (rule: GuardrailRule) =>
    fired.push({
      label: rule.label || rule.pattern,
      matcher: rule.matcher,
      pattern: rule.pattern,
      action: rule.action,
    });

  const detected = new Set(detectedEntities.map((e) => e.toUpperCase()));

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // 'allow' is a pure exemption — recorded, never escalates the verdict, never transforms.
    if (rule.action === 'allow') {
      record(rule);
      continue;
    }

    // Does this rule MATCH the text? For a transform action we also rewrite; for block/flag/log we
    // only need the boolean "did it match".
    let matched = false;

    if (rule.matcher === 'regex') {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, 'g');
      } catch {
        // A pattern that no longer compiles (shouldn't happen — validateRule compiled it on write)
        // is skipped rather than throwing the whole scan. Fail safe, not closed.
        continue;
      }
      if (isTransform(rule.action)) {
        const res = replaceAll(text, re, rule.action, rule.label || rule.pattern);
        if (res.changed) {
          text = res.text;
          matched = true;
        }
      } else {
        // block / flag / log — detect a match without rewriting. `re` is global; test() advances
        // lastIndex, so we test a fresh, non-stateful check.
        matched = new RegExp(rule.pattern).test(text);
      }
    } else {
      // matcher === 'entity' — act on a detector hit of this entity type.
      if (detected.has(rule.pattern.toUpperCase())) {
        matched = true;
        if (isTransform(rule.action) && detectorRedactedText && detectorRedactedText !== text) {
          text = detectorRedactedText;
        }
      }
    }

    if (!matched) continue;

    record(rule);
    const contributed: GuardrailRuleVerdict = isTransform(rule.action)
      ? 'redacted'
      : nonTransformVerdict(rule.action);
    verdict = strongest(verdict, contributed);
  }

  return { verdict, text, fired };
}

// ─── PII masking-before-the-model substitution (PA-16c) ─────────────────────────────────────────────

// The minimal PII-scan shape the mask substitution needs (mirrors PiiResult without importing the
// adapter types into this pure module).
export interface PiiScanLike {
  hits: boolean;
  redacted?: string;
}

/**
 * Given the original outbound text and a PII scan of it, return the text that should actually reach
 * the model. PURE. When the scan found PII AND produced a redacted form that differs from the
 * original, the REDACTED text is returned (the raw PAN/email never leaves); otherwise the original
 * is returned unchanged. This is the substitution the run path applies when the bound pipeline
 * contract requires masking — isolated here so the "raw value is replaced" invariant is directly
 * unit-testable without the run path's I/O.
 */
export function maskTextForModel(original: string, scan: PiiScanLike): string {
  if (scan.hits && typeof scan.redacted === 'string' && scan.redacted !== original) {
    return scan.redacted;
  }
  return original;
}

// ─── Thin I/O adapter — load the org's ENABLED guardrail rules for the run path ─────────────────────

/**
 * Load the org's enabled guardrail rules. Best-effort BY DESIGN: any failure (table missing on a
 * fresh deploy, no DB, transient read error) degrades to `[]` (no operator rules) so the base
 * guardrail floor still runs — an operator rule layer that can't load is never a hard dependency.
 * `orgId` is required here (the check adapter resolves it, mirroring the PII path) so this never
 * touches `headers()`.
 */
export async function loadEnforcedGuardrailRules(orgId: string): Promise<GuardrailRule[]> {
  try {
    const { listGuardrailRules } = await import('@/lib/guardrails-rules');
    const rules = await listGuardrailRules(orgId);
    return rules.filter((r) => r.enabled);
  } catch (err) {
    console.warn(
      '[guardrail-rules] load failed, running without operator rules:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
