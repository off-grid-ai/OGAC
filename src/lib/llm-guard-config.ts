// PURE LLM Guard scanner-config GENERATOR — ZERO I/O, exhaustively unit-testable (mirrors
// litellm-config.ts / presidio-recognizers.ts). Turns the console's view of the guardrails it wants
// enforced — the standard scanner set + the org's PII recognizers — into the config the console
// hands LLM Guard on every scan (the `scanners` block LLM Guard's /analyze/prompt accepts).
//
// WHY this module exists (closes G-LG-2): LLM Guard is now THE authoritative content-guardrail
// engine. Its stock Anonymize scanner uses Presidio under the hood BUT does not ship recognizers for
// Indian PII (PAN / Aadhaar / IFSC / UPI) — so `ABCDE1234F` passed straight through. LLM Guard's
// Anonymize accepts CUSTOM Presidio recognizers via `recognizer_conf`, so we fold the SAME India
// recognizer patterns the Presidio path already used (DEFAULT_RECOGNIZERS in presidio-recognizers.ts)
// into the Anonymize scanner's config. One source of the India patterns, two consumers — DRY. With
// this, LLM Guard's Anonymize catches Indian PII with no separate first-party Presidio path.
//
// PURE: same inputs → same object, no network, no DB. The adapter (guardrail-provider.ts) attaches
// the generated config to the POST body; this module never fetches anything.

import { DEFAULT_RECOGNIZERS, type NormalizedRecognizer } from './presidio-recognizers';

// ─── The scanner config shape LLM Guard's input-scan accepts ───────────────────────────────────────
// LLM Guard's API takes a `scanners` map keyed by the scanner class name, each value a params object.
// We only emit the params we set; an empty object means "use the scanner with its defaults".

/** One custom Presidio pattern recognizer, in the shape LLM Guard's Anonymize `recognizer_conf`
 *  accepts (mirrors Presidio's PatternRecognizer.to_dict: patterns[{name,regex,score}] + context). */
export interface LlmGuardRecognizer {
  name: string;
  supported_entity: string;
  supported_language: string;
  patterns: { name: string; regex: string; score: number }[];
  context?: string[];
}

/** The Anonymize scanner's params — the PII scanner. `recognizer_conf` carries our custom
 *  (India) recognizers so Anonymize detects them; `entity_types` names the entities it acts on. */
export interface AnonymizeScannerParams {
  recognizer_conf: LlmGuardRecognizer[];
  entity_types: string[];
}

/** The full generated scanner config. Only Anonymize carries params today; the other standard
 *  scanners are enabled with their defaults (an empty params object). */
export interface LlmGuardScannerConfig {
  Anonymize: AnonymizeScannerParams;
  Secrets: Record<string, never>;
  PromptInjection: Record<string, never>;
  Toxicity: Record<string, never>;
}

// The default entity types Anonymize acts on — the global Presidio entities plus the India entities
// our custom recognizers emit. These are the entity TYPES the console cares about masking.
export const DEFAULT_ANONYMIZE_ENTITIES: readonly string[] = [
  'PERSON',
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'CREDIT_CARD',
  'IBAN_CODE',
  'US_SSN',
  'IP_ADDRESS',
  // India BFSI (from DEFAULT_RECOGNIZERS) — the entities G-LG-2 said leaked past stock Anonymize.
  'IN_PAN',
  'IN_AADHAAR',
  'IN_IFSC',
  'UPI_ID',
];

// One normalized (pattern) recognizer → the LLM Guard recognizer_conf entry. Deny-list recognizers
// have no regex, so they are skipped here (LLM Guard's Anonymize is pattern/entity based). PURE.
export function recognizerToLlmGuard(
  r: NormalizedRecognizer,
  language = 'en',
): LlmGuardRecognizer | null {
  if (r.kind !== 'pattern' || !r.regex) return null;
  return {
    name: r.name,
    supported_entity: r.entity,
    supported_language: language,
    patterns: [{ name: `${r.name}_pattern`, regex: r.regex, score: r.score }],
    ...(r.context.length ? { context: r.context } : {}),
  };
}

/**
 * Build the LLM Guard scanner config the console sends on every scan. PURE.
 *
 * `extraRecognizers` are the org's stored custom recognizers (optional); they are folded in ALONGSIDE
 * the always-on India defaults. An org recognizer for the SAME entity type WINS over the default (the
 * operator's tuning overrides ours) — same precedence as presidio-recognizers.mergeWithDefaults.
 * Deny-list / disabled recognizers are dropped (Anonymize is pattern based).
 */
export function buildLlmGuardScannerConfig(
  extraRecognizers: NormalizedRecognizer[] = [],
  language = 'en',
): LlmGuardScannerConfig {
  // Org recognizers override a same-entity default; enabled + pattern only.
  const orgEntities = new Set(
    extraRecognizers.filter((r) => r.enabled).map((r) => r.entity.toUpperCase()),
  );
  const defaults = DEFAULT_RECOGNIZERS.filter(
    (d) => d.enabled && !orgEntities.has(d.entity.toUpperCase()),
  );
  const merged = [...defaults, ...extraRecognizers.filter((r) => r.enabled)];

  const recognizer_conf = merged
    .map((r) => recognizerToLlmGuard(r, language))
    .filter((r): r is LlmGuardRecognizer => r !== null);

  // The entity types Anonymize acts on = the standard set ∪ every entity our recognizers emit (so a
  // custom EMPLOYEE_ID recognizer's hits are actually masked, not just detected).
  const entity_types = [
    ...new Set([...DEFAULT_ANONYMIZE_ENTITIES, ...recognizer_conf.map((r) => r.supported_entity)]),
  ];

  return {
    Anonymize: { recognizer_conf, entity_types },
    Secrets: {},
    PromptInjection: {},
    Toxicity: {},
  };
}

/** True when the generated config's Anonymize recognizers cover the given entity type. Lets a test
 *  (and the UI) assert "the India recognizers are folded in" directly. PURE. */
export function configCoversEntity(cfg: LlmGuardScannerConfig, entity: string): boolean {
  const e = entity.toUpperCase();
  return cfg.Anonymize.recognizer_conf.some((r) => r.supported_entity.toUpperCase() === e);
}
