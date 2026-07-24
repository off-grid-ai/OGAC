// Presidio ADVANCED ANONYMIZERS — the per-entity operator POLICY layer (BFSI masking depth).
//
// The proven text path (src/lib/adapters/presidio.ts) hard-codes a single `replace` operator for
// every detected entity. Real operators need to mask/redact/hash/encrypt DIFFERENT entities
// DIFFERENTLY — reveal the last digits of a PAN, drop an Aadhaar entirely, hash a card number so it
// can be joined without exposing it. That per-entity decision is what this module owns.
//
// SOLID seam: EVERYTHING in this file is PURE and dependency-free (no Next / auth / DB / network /
// aliases) so it unit-tests in isolation with zero mocks — same discipline as presidio-recognizers.ts's
// pure half and tenancy-policy.ts. The I/O that persists a policy lives in the thin store adapter
// (presidio-anonymizer-policy-store.ts); the call that shapes + POSTs to Presidio /anonymize lives in
// the adapter (adapters/presidio-anonymize.ts). Both consume the pure functions below.
//
// Operators are exactly the set the DEPLOYED anonymizer (v2.2.356) accepts via its /anonymize API —
// verified live against the fleet engine: replace, redact, mask, hash, encrypt, keep. Presidio also
// lists a `custom` operator, but it takes a server-side lambda and the HTTP API rejects it
// ("Custom type anonymizer is not supported"), so it is deliberately excluded from the policy set.

// ─── Operator catalog ────────────────────────────────────────────────────────
export const ANONYMIZE_OPERATORS = ['replace', 'redact', 'mask', 'hash', 'encrypt', 'keep'] as const;
export type AnonymizeOperator = (typeof ANONYMIZE_OPERATORS)[number];

// Hash algorithms the deployed anonymizer supports (verified live: md5 / sha256 / sha512).
export const HASH_TYPES = ['md5', 'sha256', 'sha512'] as const;
export type HashType = (typeof HASH_TYPES)[number];

// AES key byte-lengths the anonymizer accepts (128/192/256-bit). Verified live: any other length is
// rejected with "key must be of length 128, 192 or 256 bits".
export const VALID_ENCRYPT_KEY_BYTES = [16, 24, 32] as const;

// A normalized per-entity operator choice. Only the fields relevant to `type` are populated after
// normalization, so serializing a spec never carries stale params from a previous operator.
export interface OperatorSpec {
  type: AnonymizeOperator;
  // replace: the literal to substitute. Empty/absent ⇒ Presidio's default `<ENTITY_TYPE>` token.
  newValue?: string;
  // mask: single masking character (default '*'), how many chars to mask (>=1), and whether to mask
  // from the END of the value (reveal the prefix) or the START (reveal the suffix, e.g. last 4).
  maskingChar?: string;
  charsToMask?: number;
  fromEnd?: boolean;
  // hash: the digest algorithm.
  hashType?: HashType;
  // encrypt: the symmetric AES key (16/24/32 bytes). Demo/on-prem only; a real deployment supplies
  // this from the secrets store, never a persisted plaintext policy.
  key?: string;
}

export interface AnonymizerPolicy {
  // The fallback operator applied to any detected entity with no per-entity override (Presidio's
  // reserved `DEFAULT` anonymizer key).
  default: OperatorSpec;
  // Per-entity overrides keyed by UPPER_SNAKE entity type → operator spec.
  perEntity: Record<string, OperatorSpec>;
}

export type OperatorValidation =
  | { ok: true; value: OperatorSpec }
  | { ok: false; error: string };

export type PolicyValidation =
  | { ok: true; value: AnonymizerPolicy }
  | { ok: false; error: string };

// ─── Small pure helpers ──────────────────────────────────────────────────────
function isOperator(v: unknown): v is AnonymizeOperator {
  return typeof v === 'string' && (ANONYMIZE_OPERATORS as readonly string[]).includes(v);
}

function isHashType(v: unknown): v is HashType {
  return typeof v === 'string' && (HASH_TYPES as readonly string[]).includes(v);
}

// UTF-8 byte length without pulling in node Buffer, so this file stays runtime-agnostic + pure.
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// A positive integer count, clamped into [min, max]; falls back when absent/non-finite.
export function clampCount(v: unknown, fallback: number, min = 1, max = 256): number {
  let n = Number.NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  n = Math.floor(n);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// Normalize a masking character to exactly one character (Presidio requires a single char).
export function normalizeMaskingChar(v: unknown, fallback = '*'): string {
  if (typeof v !== 'string' || v.length === 0) return fallback;
  return [...v][0]; // first code point, so an emoji/surrogate pair stays one char
}

export const DEFAULT_OPERATOR: OperatorSpec = { type: 'replace' };

// ─── Operator spec validation / normalization ─────────────────────────────────

// Strict validation of ONE operator spec (the PUT path — errors are surfaced to the operator).
// Returns a normalized spec carrying ONLY the fields its operator uses.
export function validateOperatorSpec(draft: unknown): OperatorValidation {
  const d = draft && typeof draft === 'object' ? (draft as Record<string, unknown>) : {};
  if (!isOperator(d.type)) {
    return { ok: false, error: `operator must be one of ${ANONYMIZE_OPERATORS.join(' | ')}` };
  }

  switch (d.type) {
    case 'redact':
    case 'keep':
      return { ok: true, value: { type: d.type } };

    case 'replace': {
      const raw = typeof d.newValue === 'string' ? d.newValue.slice(0, 200) : '';
      // Empty is valid — Presidio then uses its default `<ENTITY_TYPE>` token.
      return { ok: true, value: raw ? { type: 'replace', newValue: raw } : { type: 'replace' } };
    }

    case 'mask':
      return {
        ok: true,
        value: {
          type: 'mask',
          maskingChar: normalizeMaskingChar(d.maskingChar),
          charsToMask: clampCount(d.charsToMask, 4),
          fromEnd: d.fromEnd === true,
        },
      };

    case 'hash': {
      const hashType = isHashType(d.hashType) ? d.hashType : 'sha256';
      return { ok: true, value: { type: 'hash', hashType } };
    }

    case 'encrypt': {
      // A KEYLESS encrypt spec is legal and is the PRODUCTION shape: it means "use the org's
      // vault-held key", bound at call time by bindEncryptKey. Key material is therefore never
      // persisted in the policy row. An INLINE key is still accepted (bootstrap/tests) but must be a
      // real AES length; a wrong-length key is rejected rather than silently downgraded.
      const key = typeof d.key === 'string' ? d.key : '';
      if (!key) return { ok: true, value: { type: 'encrypt' } };
      const bytes = byteLength(key);
      if (!(VALID_ENCRYPT_KEY_BYTES as readonly number[]).includes(bytes)) {
        return {
          ok: false,
          error: `encrypt key must be 16, 24, or 32 bytes (got ${bytes})`,
        };
      }
      return { ok: true, value: { type: 'encrypt', key } };
    }

    /* c8 ignore next 2 -- exhaustive switch guard; isOperator already narrows d.type */
    default:
      return { ok: false, error: 'unsupported operator' };
  }
}

// Lenient normalization of ONE spec (the STORE-read path — a persisted/legacy blob must never throw;
// anything invalid collapses to the safe fallback).
export function normalizeOperatorSpec(draft: unknown, fallback: OperatorSpec = DEFAULT_OPERATOR): OperatorSpec {
  const parsed = validateOperatorSpec(draft);
  return parsed.ok ? parsed.value : fallback;
}

// UPPER_SNAKE entity key or null when it isn't a valid Presidio entity token.
export function normalizeEntityKey(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*$/.test(key) ? key : null;
}

// ─── Policy validation / normalization ─────────────────────────────────────────

// Strict validation of a whole policy draft (PUT path). A missing/invalid `default` falls back to
// the safe replace operator; any INVALID per-entity spec is a hard error so the operator sees it.
export function validateAnonymizerPolicy(draft: unknown): PolicyValidation {
  const d = draft && typeof draft === 'object' ? (draft as Record<string, unknown>) : {};

  let dflt: OperatorSpec = DEFAULT_OPERATOR;
  if (d.default !== undefined) {
    const parsed = validateOperatorSpec(d.default);
    if (!parsed.ok) return { ok: false, error: `default operator: ${parsed.error}` };
    dflt = parsed.value;
  }

  const perEntity: Record<string, OperatorSpec> = {};
  const rawMap =
    d.perEntity && typeof d.perEntity === 'object' ? (d.perEntity as Record<string, unknown>) : {};
  for (const [rawKey, rawSpec] of Object.entries(rawMap)) {
    const key = normalizeEntityKey(rawKey);
    if (!key) return { ok: false, error: `invalid entity type: ${rawKey}` };
    const parsed = validateOperatorSpec(rawSpec);
    if (!parsed.ok) return { ok: false, error: `${key}: ${parsed.error}` };
    perEntity[key] = parsed.value;
  }

  return { ok: true, value: { default: dflt, perEntity } };
}

// Lenient normalization (STORE-read path). Never throws; drops invalid entity keys, collapses
// invalid specs to the default operator.
export function normalizeAnonymizerPolicy(raw: unknown): AnonymizerPolicy {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const dflt = normalizeOperatorSpec(d.default);
  const perEntity: Record<string, OperatorSpec> = {};
  const rawMap =
    d.perEntity && typeof d.perEntity === 'object' ? (d.perEntity as Record<string, unknown>) : {};
  for (const [rawKey, rawSpec] of Object.entries(rawMap)) {
    const key = normalizeEntityKey(rawKey);
    if (!key) continue;
    perEntity[key] = normalizeOperatorSpec(rawSpec, dflt);
  }
  return { default: dflt, perEntity };
}

// ─── Sensible BFSI default policy ──────────────────────────────────────────────
// A ready-to-use policy for Indian BFSI operators: financial identifiers masked (revealing only a
// tail where useful), Aadhaar dropped entirely (UIDAI data-minimization), the rest replaced with a
// labelled token so redacted text stays readable.
export const DEFAULT_ANONYMIZER_POLICY: AnonymizerPolicy = {
  default: { type: 'replace' },
  perEntity: {
    IN_PAN: { type: 'mask', maskingChar: '*', charsToMask: 6, fromEnd: false },
    IN_AADHAAR: { type: 'redact' },
    IN_IFSC: { type: 'replace', newValue: '<IFSC>' },
    UPI_ID: { type: 'replace', newValue: '<UPI>' },
    CREDIT_CARD: { type: 'mask', maskingChar: '*', charsToMask: 12, fromEnd: false },
    US_BANK_NUMBER: { type: 'hash', hashType: 'sha256' },
    EMAIL_ADDRESS: { type: 'replace', newValue: '<EMAIL>' },
    PHONE_NUMBER: { type: 'mask', maskingChar: '*', charsToMask: 6, fromEnd: false },
  },
};

// ─── Presidio /anonymize request shaping ───────────────────────────────────────

// A Presidio analyzer result (the shape /analyze returns and /anonymize consumes).
export interface PresidioAnalyzerResult {
  entity_type: string;
  start: number;
  end: number;
  score?: number;
}

// A single Presidio operator config (the value side of the `anonymizers` map). snake_case to match
// the engine's wire contract exactly.
export interface PresidioOperatorConfig {
  type: AnonymizeOperator;
  new_value?: string;
  masking_char?: string;
  chars_to_mask?: number;
  from_end?: boolean;
  hash_type?: HashType;
  key?: string;
}

export interface PresidioAnonymizeRequest {
  text: string;
  analyzer_results: PresidioAnalyzerResult[];
  anonymizers: Record<string, PresidioOperatorConfig>;
}

// One normalized spec → the engine's wire config. Only relevant fields are emitted.
export function specToOperatorConfig(spec: OperatorSpec): PresidioOperatorConfig {
  switch (spec.type) {
    case 'redact':
      return { type: 'redact' };
    case 'keep':
      return { type: 'keep' };
    case 'replace':
      return spec.newValue ? { type: 'replace', new_value: spec.newValue } : { type: 'replace' };
    case 'mask':
      return {
        type: 'mask',
        masking_char: spec.maskingChar ?? '*',
        chars_to_mask: spec.charsToMask ?? 4,
        from_end: spec.fromEnd === true,
      };
    case 'hash':
      return { type: 'hash', hash_type: spec.hashType ?? 'sha256' };
    case 'encrypt':
      return { type: 'encrypt', key: spec.key ?? '' };
    /* c8 ignore next 2 -- spec.type is a closed union; no other case reachable */
    default:
      return { type: 'replace' };
  }
}

// Build the full /anonymize request body honoring the operator POLICY (NOT a hard-coded replace).
// The reserved `DEFAULT` key carries the fallback operator; per-entity operators are attached only
// for entity types that actually appear in the analyzer results, so the payload stays tight.
export function buildAnonymizeRequest(
  text: string,
  analyzerResults: PresidioAnalyzerResult[],
  policy: AnonymizerPolicy,
): PresidioAnonymizeRequest {
  const anonymizers: Record<string, PresidioOperatorConfig> = {
    DEFAULT: specToOperatorConfig(policy.default),
  };
  const present = new Set(analyzerResults.map((r) => r.entity_type));
  for (const entity of present) {
    const spec = policy.perEntity[entity];
    if (spec) anonymizers[entity] = specToOperatorConfig(spec);
  }
  return { text, analyzer_results: analyzerResults, anonymizers };
}

// ─── Presidio /anonymize response normalization ────────────────────────────────
export interface AnonymizeItem {
  entityType: string;
  operator: string;
  start: number;
  end: number;
  text: string;
}

export interface AnonymizeOutcome {
  text: string;
  items: AnonymizeItem[];
}

function toItem(raw: unknown): AnonymizeItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.entity_type !== 'string' || typeof o.operator !== 'string') return null;
  return {
    entityType: o.entity_type,
    operator: o.operator,
    start: typeof o.start === 'number' ? o.start : 0,
    end: typeof o.end === 'number' ? o.end : 0,
    text: typeof o.text === 'string' ? o.text : '',
  };
}

// Normalize the engine's /anonymize response. When the engine returns no usable `text`, fall back
// to the supplied text (the caller decides whether that is an error/fallback state).
export function normalizeAnonymizeResponse(raw: unknown, fallbackText: string): AnonymizeOutcome {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = typeof o.text === 'string' ? o.text : fallbackText;
  const items = Array.isArray(o.items)
    ? o.items.map(toItem).filter((i): i is AnonymizeItem => i !== null)
    : [];
  return { text, items };
}

// ─── UI-facing describe helper (pure) ──────────────────────────────────────────
// A short human label for an operator spec — reused by the console table so the label rule lives in
// ONE place (DRY) rather than being re-derived in the component.
export function describeOperator(spec: OperatorSpec): string {
  switch (spec.type) {
    case 'replace':
      return spec.newValue ? `replace → "${spec.newValue}"` : 'replace → <ENTITY>';
    case 'redact':
      return 'redact (remove)';
    case 'keep':
      return 'keep (no change)';
    case 'mask':
      return `mask ${spec.charsToMask ?? 4}× "${spec.maskingChar ?? '*'}" from ${spec.fromEnd ? 'end' : 'start'}`;
    case 'hash':
      return `hash (${spec.hashType ?? 'sha256'})`;
    case 'encrypt':
      return 'encrypt (AES)';
    /* c8 ignore next 2 -- closed union */
    default:
      return 'replace';
  }
}

// ─── Vault-backed encryption keys (the secret-backed half of advanced anonymizers) ────────────────
// The rule: an AES key is SECRET MATERIAL and must never sit in the policy row. So the persisted
// policy carries the encrypt INTENT only (a keyless encrypt spec) and the key is resolved from the
// secrets store at call time. These are PURE so the whole rule is unit-testable with zero I/O.

/** Where the org's Presidio AES key lives in the secrets store (mirrors the Slack webhook pattern). */
export const PRESIDIO_ENCRYPT_KEY_SECRET = 'org/presidio_encrypt_key';

/** Does this policy encrypt anywhere (⇒ a key must be resolved before it can run)? PURE. */
export function policyUsesEncrypt(policy: AnonymizerPolicy): boolean {
  if (policy.default.type === 'encrypt') return true;
  return Object.values(policy.perEntity).some((spec) => spec.type === 'encrypt');
}

/**
 * Drop inline AES key material from every encrypt spec — the shape we PERSIST. PURE. The encrypt
 * intent survives (a keyless encrypt spec is valid and means "use the vaulted key"), so stripping the
 * key can never silently disable encryption.
 */
export function stripInlineEncryptKeys(policy: AnonymizerPolicy): AnonymizerPolicy {
  const strip = (spec: OperatorSpec): OperatorSpec =>
    spec.type === 'encrypt' && spec.key !== undefined ? { type: 'encrypt' } : spec;
  const perEntity: Record<string, OperatorSpec> = {};
  for (const [entity, spec] of Object.entries(policy.perEntity)) perEntity[entity] = strip(spec);
  return { default: strip(policy.default), perEntity };
}

/**
 * Bind the vaulted key into every encrypt spec, ready to send to Presidio. PURE.
 *
 * FAIL SAFE, never fail open: when no key can be resolved, an encrypt spec is DOWNGRADED to `replace`
 * (the value is still masked — it is never emitted in plaintext) and the affected entity is reported
 * in `downgraded` so the caller can surface the degradation honestly instead of hiding it. A spec that
 * already carries an inline key keeps it (bootstrap/tests).
 */
export function bindEncryptKey(
  policy: AnonymizerPolicy,
  key: string | null,
): { policy: AnonymizerPolicy; downgraded: string[] } {
  const downgraded: string[] = [];
  const bind = (spec: OperatorSpec, label: string): OperatorSpec => {
    if (spec.type !== 'encrypt') return spec;
    if (spec.key) return spec;
    if (key) return { type: 'encrypt', key };
    downgraded.push(label);
    return { type: 'replace' };
  };
  const perEntity: Record<string, OperatorSpec> = {};
  for (const [entity, spec] of Object.entries(policy.perEntity)) {
    perEntity[entity] = bind(spec, entity);
  }
  return { policy: { default: bind(policy.default, 'DEFAULT'), perEntity }, downgraded };
}
