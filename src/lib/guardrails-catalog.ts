// ─── STANDARD GUARDRAILS CATALOG (Builder Epic #124) — PURE, zero-IO ──────────────────────────────
//
// The founder's ask (same shape as the evals templates + the MCP catalog): operators shouldn't
// hand-write regex to turn on the protections everyone needs. Bundle the STANDARD guardrails so a
// non-technical operator ONE-CLICK enables them.
//
// LLM Guard is THE authoritative content-guardrail engine. Its Anonymize scanner uses Presidio under
// the hood (so it recognizes the standard PII entities below) AND carries the India recognizers the
// console folds into the scanner config (llm-guard-config.ts). Three kinds of standard guardrail ship:
//   1. `presidio-entity`  — a PII/PHI entity type (PERSON, EMAIL_ADDRESS, US_SSN, IBAN_CODE, the IN_*
//      packs, …). The operator picks WHICH entities to mask — no regex, no config. Enabling one means
//      "detect + mask this entity", ENFORCED by LLM Guard's Anonymize scanner (the entity name is a
//      Presidio recognizer LLM Guard runs).
//   2. `llm-guard-scanner` — a specific LLM Guard scanner class (Anonymize, Secrets, PromptInjection,
//      Toxicity, Bias, BanTopics, Language, Regex, TokenLimit) enabled directly.
//   3. `guardrails-validator` — a curated Guardrails-AI Hub validator (a LEGACY second-opinion check
//      that runs on-prem via the Guardrails-AI runtime; distinct from the authoritative LLM Guard
//      engine). The console records the org's intent to enforce it.
//
// ── HOW ENABLING WRITES THROUGH THE EXISTING PATH (no new storage) ────────────────────────────────
// Enabling a catalog item does NOT introduce a new store. It writes a row through the EXISTING
// guardrails masking-rules path (POST /api/v1/admin/guardrails/rules → createGuardrailRule):
//   • a `presidio-entity`      → a rule { matcher:'entity', pattern:<ENTITY>, action:'redact', … }
//     — the entity joins the org's active detection/masking set.
//   • a `guardrails-validator` → a rule { matcher:'entity', pattern:<VALIDATOR_TOKEN>, action, … }
//     — an UPPER_SNAKE token (e.g. TOXIC_LANGUAGE) that names the validator to enforce.
// buildEnablePayload below produces EXACTLY the body validateRule() accepts, so there's one storage
// path, one audit trail, and the existing GuardrailRules table/UI already manages what we enable.
//
// ── AIR-GAP SAFETY ────────────────────────────────────────────────────────────────────────────────
// Everything here runs ON-PREM. PII entities + LLM Guard scanners are enforced by the self-hosted
// LLM Guard engine (its Anonymize scanner runs Presidio locally). Guardrails-AI validators run in the
// local Guardrails runtime. Nothing in this catalog reaches the public internet — no item declares
// network egress, and the payload builder writes only local rows.
//
// ── GROUNDED — REAL entities/validators ONLY (do NOT invent) ─────────────────────────────────────
//   • Presidio predefined recognizers — microsoft.github.io/presidio (Supported entities):
//     global + US + UK/AU/ES/IT/SG/IN/DE/PH/FI country packs. Only entities on that page appear here.
//   • Guardrails-AI Hub validators — hub.guardrailsai.com. Only validators published on the Hub
//     appear here.

// ─── Category — the group an item sorts under in the browse UI ────────────────────────────────────
export type GuardrailCategory =
  | 'Identity'
  | 'Financial'
  | 'Contact'
  | 'Network'
  | 'Medical'
  | 'Government & Country'
  | 'Content Safety'
  | 'Prompt Security'
  | 'Output Quality';

export const GUARDRAIL_CATEGORIES: GuardrailCategory[] = [
  'Identity',
  'Financial',
  'Contact',
  'Network',
  'Medical',
  'Government & Country',
  'Content Safety',
  'Prompt Security',
  'Output Quality',
];

// ─── Kind + engine ────────────────────────────────────────────────────────────────────────────────
export type GuardrailKind = 'presidio-entity' | 'guardrails-validator' | 'llm-guard-scanner';
export type GuardrailEngine = 'presidio' | 'guardrails-ai' | 'llm-guard';

// ─── GuardrailCatalogItem — one bundled standard guardrail ────────────────────────────────────────
export interface GuardrailCatalogItem {
  /** Stable catalog key. */
  id: string;
  /** Human name shown on the card. */
  name: string;
  category: GuardrailCategory;
  kind: GuardrailKind;
  /** Plain-language "what it protects / when to use it" — for a non-technical operator. */
  description: string;
  /** Which on-prem engine enforces it. */
  engine: GuardrailEngine;
  /**
   * The UPPER_SNAKE token written to a guardrails rule's `pattern` when enabled. For a
   * presidio-entity this IS the Presidio entity type (e.g. EMAIL_ADDRESS). For a validator it's a
   * stable token naming the validator (e.g. TOXIC_LANGUAGE).
   */
  entity: string;
  /** Whether this is a protection most operators want on by default (drives a "recommended" badge). */
  defaultEnabled: boolean;
  /** For a validator only: its Guardrails-AI Hub id (informational; no auto-fetch). */
  hubId?: string;
  /** For an llm-guard-scanner only: the exact LLM Guard scanner class name (e.g. `PromptInjection`). */
  scanner?: string;
}

// ─── THE CATALOG — real Presidio entities + curated Guardrails-AI validators ──────────────────────
export const GUARDRAIL_CATALOG: GuardrailCatalogItem[] = [
  // ── Identity ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'person',
    name: 'Person names',
    category: 'Identity',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'PERSON',
    defaultEnabled: true,
    description:
      "Detect and mask people's full names. Turn this on to keep names out of prompts and logs.",
  },
  {
    id: 'nrp',
    name: 'Nationality / religion / group',
    category: 'Identity',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'NRP',
    defaultEnabled: false,
    description:
      'Detect a person’s nationality, religious, or political group. Turn this on to redact sensitive group affiliations.',
  },
  {
    id: 'date-time',
    name: 'Dates & times',
    category: 'Identity',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'DATE_TIME',
    defaultEnabled: false,
    description:
      'Detect dates and times (e.g. a date of birth). Turn this on when dates could identify someone.',
  },
  {
    id: 'location',
    name: 'Locations',
    category: 'Identity',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'LOCATION',
    defaultEnabled: false,
    description:
      'Detect addresses, cities, and places. Turn this on to keep location details out of prompts and logs.',
  },

  // ── Financial ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'credit-card',
    name: 'Credit card numbers',
    category: 'Financial',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'CREDIT_CARD',
    defaultEnabled: true,
    description:
      'Detect and mask credit and debit card numbers. Recommended for anything touching payments.',
  },
  {
    id: 'iban',
    name: 'Bank account (IBAN)',
    category: 'Financial',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'IBAN_CODE',
    defaultEnabled: true,
    description: 'Detect international bank account numbers (IBAN). Recommended for financial data.',
  },
  {
    id: 'crypto',
    name: 'Crypto wallet address',
    category: 'Financial',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'CRYPTO',
    defaultEnabled: false,
    description:
      'Detect cryptocurrency wallet addresses (e.g. Bitcoin). Turn this on when handling crypto.',
  },

  // ── Contact ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'email',
    name: 'Email addresses',
    category: 'Contact',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'EMAIL_ADDRESS',
    defaultEnabled: true,
    description: 'Detect and mask email addresses. Recommended — one of the most common leaks.',
  },
  {
    id: 'phone',
    name: 'Phone numbers',
    category: 'Contact',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'PHONE_NUMBER',
    defaultEnabled: true,
    description: 'Detect and mask phone numbers. Recommended — a very common leak.',
  },
  {
    id: 'url',
    name: 'Web addresses (URLs)',
    category: 'Contact',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'URL',
    defaultEnabled: false,
    description:
      'Detect web addresses (URLs). Turn this on when links could reveal private systems or people.',
  },

  // ── Network ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ip-address',
    name: 'IP addresses',
    category: 'Network',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'IP_ADDRESS',
    defaultEnabled: false,
    description:
      'Detect IPv4 and IPv6 addresses. Turn this on to keep network identifiers out of prompts and logs.',
  },

  // ── Medical ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'medical-license',
    name: 'Medical license number',
    category: 'Medical',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'MEDICAL_LICENSE',
    defaultEnabled: false,
    description:
      'Detect medical license numbers (e.g. US DEA). Turn this on for healthcare (PHI) workloads.',
  },

  // ── Government & Country ────────────────────────────────────────────────────────────────────────
  {
    id: 'us-ssn',
    name: 'US Social Security Number',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'US_SSN',
    defaultEnabled: true,
    description: 'Detect and mask US SSNs. Recommended for any US personal data.',
  },
  {
    id: 'us-itin',
    name: 'US ITIN',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'US_ITIN',
    defaultEnabled: false,
    description: 'Detect US Individual Taxpayer Identification Numbers (ITIN).',
  },
  {
    id: 'us-passport',
    name: 'US passport number',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'US_PASSPORT',
    defaultEnabled: false,
    description: 'Detect US passport numbers.',
  },
  {
    id: 'us-driver-license',
    name: 'US driver’s license',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'US_DRIVER_LICENSE',
    defaultEnabled: false,
    description: 'Detect US driver’s license numbers.',
  },
  {
    id: 'uk-nhs',
    name: 'UK NHS number',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'UK_NHS',
    defaultEnabled: false,
    description: 'Detect UK National Health Service (NHS) patient numbers.',
  },
  {
    id: 'au-abn',
    name: 'Australia ABN',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'AU_ABN',
    defaultEnabled: false,
    description: 'Detect Australian Business Numbers (ABN).',
  },
  {
    id: 'au-tfn',
    name: 'Australia TFN',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'AU_TFN',
    defaultEnabled: false,
    description: 'Detect Australian Tax File Numbers (TFN).',
  },
  {
    id: 'es-nif',
    name: 'Spain NIF',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'ES_NIF',
    defaultEnabled: false,
    description: 'Detect Spanish tax identification numbers (NIF).',
  },
  {
    id: 'it-fiscal-code',
    name: 'Italy fiscal code',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'IT_FISCAL_CODE',
    defaultEnabled: false,
    description: 'Detect Italian fiscal codes (codice fiscale).',
  },
  {
    id: 'sg-nric-fin',
    name: 'Singapore NRIC / FIN',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'SG_NRIC_FIN',
    defaultEnabled: false,
    description: 'Detect Singapore NRIC and FIN identity numbers.',
  },
  {
    id: 'in-aadhaar',
    name: 'India Aadhaar',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'IN_AADHAAR',
    defaultEnabled: false,
    description: 'Detect Indian Aadhaar identity numbers.',
  },
  {
    id: 'in-pan',
    name: 'India PAN',
    category: 'Government & Country',
    kind: 'presidio-entity',
    engine: 'presidio',
    entity: 'IN_PAN',
    defaultEnabled: false,
    description: 'Detect Indian Permanent Account Numbers (PAN).',
  },

  // ── Content Safety (Guardrails-AI validators) ─────────────────────────────────────────────────────
  {
    id: 'toxic-language',
    name: 'Block toxic language',
    category: 'Content Safety',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'TOXIC_LANGUAGE',
    hubId: 'guardrails/toxic_language',
    defaultEnabled: true,
    description:
      'Flag toxic or hateful language in inputs and outputs. Recommended to keep responses safe.',
  },
  {
    id: 'profanity-free',
    name: 'Keep it profanity-free',
    category: 'Content Safety',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'PROFANITY_FREE',
    hubId: 'guardrails/profanity_free',
    defaultEnabled: false,
    description: 'Flag profanity in outputs. Turn this on for customer-facing responses.',
  },
  {
    id: 'nsfw-text',
    name: 'Block NSFW content',
    category: 'Content Safety',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'NSFW_TEXT',
    hubId: 'guardrails/nsfw_text',
    defaultEnabled: false,
    description: 'Flag not-safe-for-work text in outputs.',
  },
  {
    id: 'gibberish-text',
    name: 'Reject gibberish',
    category: 'Content Safety',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'GIBBERISH_TEXT',
    hubId: 'guardrails/gibberish_text',
    defaultEnabled: false,
    description: 'Flag nonsensical or gibberish output so broken responses don’t reach users.',
  },

  // ── Prompt Security (Guardrails-AI validators) ────────────────────────────────────────────────────
  {
    id: 'detect-prompt-injection',
    name: 'Block prompt injection / jailbreaks',
    category: 'Prompt Security',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'PROMPT_INJECTION',
    hubId: 'guardrails/detect_jailbreak',
    defaultEnabled: true,
    description:
      'Detect attempts to hijack the model with jailbreak or prompt-injection instructions. Recommended.',
  },
  {
    id: 'secrets-present',
    name: 'Block secrets & API keys',
    category: 'Prompt Security',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'SECRETS_PRESENT',
    hubId: 'guardrails/secrets_present',
    defaultEnabled: true,
    description:
      'Detect API keys, tokens, and other secrets in text so they don’t leak. Recommended.',
  },
  {
    id: 'ban-list',
    name: 'Ban specific words',
    category: 'Prompt Security',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'BAN_LIST',
    hubId: 'guardrails/ban_list',
    defaultEnabled: false,
    description:
      'Flag any of a list of banned words or phrases. Turn this on to enforce your own blocklist.',
  },
  {
    id: 'detect-pii',
    name: 'Detect PII (Guardrails)',
    category: 'Prompt Security',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'DETECT_PII',
    hubId: 'guardrails/detect_pii',
    defaultEnabled: false,
    description:
      'A second-opinion PII check that runs in the Guardrails runtime, alongside Presidio detection.',
  },

  // ── Output Quality (Guardrails-AI validators) ─────────────────────────────────────────────────────
  {
    id: 'competitor-check',
    name: 'Block competitor mentions',
    category: 'Output Quality',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'COMPETITOR_CHECK',
    hubId: 'guardrails/competitor_check',
    defaultEnabled: false,
    description: 'Flag mentions of named competitors in outputs. Turn this on with your list.',
  },
  {
    id: 'restrict-to-topic',
    name: 'Stay on topic',
    category: 'Output Quality',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'RESTRICT_TO_TOPIC',
    hubId: 'guardrails/restrict_to_topic',
    defaultEnabled: false,
    description: 'Flag responses that stray from an allowed set of topics.',
  },
  {
    id: 'valid-json',
    name: 'Require valid JSON',
    category: 'Output Quality',
    kind: 'guardrails-validator',
    engine: 'guardrails-ai',
    entity: 'VALID_JSON',
    hubId: 'guardrails/valid_json',
    defaultEnabled: false,
    description: 'Reject responses that are not valid JSON. Turn this on for structured outputs.',
  },

  // ── LLM Guard scanners (Protect AI, MIT) — one-click, self-hosted ─────────────────────────────────
  // Enforced by the on-prem LLM Guard engine (OFFGRID_ADAPTER_GUARDRAILS=llm-guard). Each maps to a
  // real LLM Guard scanner class; the `entity` is the stable UPPER_SNAKE rule token, `scanner` the
  // exact LLM Guard class name. Copy leads with the capability + outcome (engine named for the
  // operator's clarity, not as the headline).
  {
    id: 'llm-guard-dlp-pii-in',
    name: 'Mask PII in prompts (LLM Guard)',
    category: 'Prompt Security',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_ANONYMIZE',
    scanner: 'Anonymize',
    defaultEnabled: true,
    description:
      'Detect and anonymize personal data (names, emails, cards, national IDs) in prompts before they reach the model. Recommended — stops PII from leaving the box.',
  },
  {
    id: 'llm-guard-secrets',
    name: 'Block secrets & API keys (LLM Guard)',
    category: 'Prompt Security',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_SECRETS',
    scanner: 'Secrets',
    defaultEnabled: true,
    description:
      'Detect API keys, tokens, and credentials in prompts so they never leak into a request. Recommended.',
  },
  {
    id: 'llm-guard-pii-out',
    name: 'Catch PII in responses (LLM Guard)',
    category: 'Prompt Security',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_SENSITIVE',
    scanner: 'Sensitive',
    defaultEnabled: false,
    description:
      'Scan model responses for personal or sensitive data before they reach a user. Turn this on for customer-facing outputs.',
  },
  {
    id: 'llm-guard-prompt-injection',
    name: 'Block prompt injection (LLM Guard)',
    category: 'Prompt Security',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_PROMPT_INJECTION',
    scanner: 'PromptInjection',
    defaultEnabled: true,
    description:
      'Detect attempts to hijack the model with jailbreak or injection instructions. Recommended.',
  },
  {
    id: 'llm-guard-toxicity',
    name: 'Block toxic language (LLM Guard)',
    category: 'Content Safety',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_TOXICITY',
    scanner: 'Toxicity',
    defaultEnabled: true,
    description:
      'Flag toxic or hateful language in prompts and responses. Recommended to keep interactions safe.',
  },
  {
    id: 'llm-guard-bias',
    name: 'Flag biased output (LLM Guard)',
    category: 'Content Safety',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_BIAS',
    scanner: 'Bias',
    defaultEnabled: false,
    description:
      'Flag biased or unbalanced language in model responses. Turn this on for public-facing content.',
  },
  {
    id: 'llm-guard-ban-topics',
    name: 'Keep off banned topics (LLM Guard)',
    category: 'Content Safety',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_BAN_TOPICS',
    scanner: 'BanTopics',
    defaultEnabled: false,
    description:
      'Block prompts or responses that touch topics you disallow. Turn this on with your topic list.',
  },
  {
    id: 'llm-guard-language',
    name: 'Restrict to allowed languages (LLM Guard)',
    category: 'Content Safety',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_LANGUAGE',
    scanner: 'Language',
    defaultEnabled: false,
    description:
      'Detect the language of a prompt or response and flag anything outside your allowed set.',
  },
  {
    id: 'llm-guard-regex',
    name: 'Custom regex match (LLM Guard)',
    category: 'Prompt Security',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_REGEX',
    scanner: 'Regex',
    defaultEnabled: false,
    description:
      'Flag or replace text matching your own regular-expression patterns. Turn this on to enforce a custom rule.',
  },
  {
    id: 'llm-guard-token-limit',
    name: 'Enforce a token limit (LLM Guard)',
    category: 'Output Quality',
    kind: 'llm-guard-scanner',
    engine: 'llm-guard',
    entity: 'LLM_GUARD_TOKEN_LIMIT',
    scanner: 'TokenLimit',
    defaultEnabled: false,
    description:
      'Reject prompts that exceed a maximum token count, before they cost you a call. Turn this on to cap request size.',
  },
];

// ─── Engine availability (PURE) ───────────────────────────────────────────────────────────────────
// Honest per-item availability, given what the operator has actually configured. LLM Guard is THE
// authoritative content-guardrail engine, so a PII-entity item (a presidio-entity toggle) is READY
// when LLM Guard is configured + reachable — LLM Guard's Anonymize scanner detects/masks it, with the
// India recognizers (PAN/Aadhaar/IFSC/UPI) folded into the scanner config the console generates
// (llm-guard-config.ts). An llm-guard-scanner item is likewise READY under LLM Guard. A
// guardrails-validator (a legacy Guardrails-AI second-opinion check) is READY only when that runtime
// is configured. Nothing here does I/O; the caller passes in the engine flags.
export interface EngineStatus {
  /** Kept for back-compat with older callers; PII entities are now enforced by LLM Guard's Anonymize. */
  presidioReady?: boolean;
  /** Guardrails-AI runtime is configured on-prem (legacy second-opinion validators only). */
  guardrailsAiReady: boolean;
  /** LLM Guard — the authoritative engine — is the active guardrails adapter AND configured + reachable. */
  llmGuardReady?: boolean;
}

// Entities the deterministic regex floor still catches on the data-movement path (informational).
export const REGEX_FLOOR_ENTITIES = ['EMAIL_ADDRESS', 'PHONE_NUMBER'] as const;

export type Availability = 'ready' | 'fallback' | 'floor';

export interface ItemAvailability {
  status: Availability;
  detail: string;
}

// The honest availability for one catalog item under the given engine status. Never throws.
export function itemAvailability(
  item: GuardrailCatalogItem,
  status: EngineStatus,
): ItemAvailability {
  // PII-entity toggles + LLM Guard scanners are BOTH enforced by the LLM Guard engine now.
  if (item.kind === 'presidio-entity' || item.kind === 'llm-guard-scanner') {
    if (status.llmGuardReady) {
      return {
        status: 'ready',
        detail:
          item.kind === 'presidio-entity'
            ? 'Detected and masked by LLM Guard’s Anonymize scanner (India recognizers folded in).'
            : 'Enforced by the on-prem LLM Guard engine.',
      };
    }
    return {
      status: 'fallback',
      detail:
        'LLM Guard is not configured or is unreachable. The rule is stored and enforced once the engine is on.',
    };
  }
  // guardrails-validator — the legacy Guardrails-AI second-opinion runtime.
  if (status.guardrailsAiReady) {
    return { status: 'ready', detail: 'Enforced by the on-prem Guardrails-AI runtime.' };
  }
  return {
    status: 'fallback',
    detail:
      'The Guardrails-AI runtime is not configured. The rule is stored and enforced once it’s on.',
  };
}

// ─── Lookup + grouping (PURE) ───────────────────────────────────────────────────────────────────────
export function getGuardrailItem(id: string): GuardrailCatalogItem | null {
  return GUARDRAIL_CATALOG.find((i) => i.id === id) ?? null;
}

export interface GuardrailCategoryGroup {
  category: GuardrailCategory;
  items: GuardrailCatalogItem[];
}

// Group the catalog by category in the canonical order; empty categories are dropped so the browse
// UI never renders an empty heading.
export function catalogByCategory(
  items: GuardrailCatalogItem[] = GUARDRAIL_CATALOG,
): GuardrailCategoryGroup[] {
  return GUARDRAIL_CATEGORIES.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
}

// ─── Search / filter (PURE) — mirrors the eval-catalog-filter seam ────────────────────────────────
export interface CatalogFilter {
  q?: string;
  category?: string;
  kind?: GuardrailKind;
}

export function isFilterActive(filter: CatalogFilter): boolean {
  return Boolean(filter.q?.trim()) || Boolean(filter.category) || Boolean(filter.kind);
}

function matchesQuery(item: GuardrailCatalogItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.name.toLowerCase().includes(needle) ||
    item.description.toLowerCase().includes(needle) ||
    item.entity.toLowerCase().includes(needle)
  );
}

// Apply search + category + kind. Preserves input order. Pure — never mutates the input.
export function filterCatalog(
  items: readonly GuardrailCatalogItem[],
  filter: CatalogFilter,
): GuardrailCatalogItem[] {
  const q = filter.q ?? '';
  return items.filter((i) => {
    if (!matchesQuery(i, q)) return false;
    if (filter.category && i.category !== filter.category) return false;
    if (filter.kind && i.kind !== filter.kind) return false;
    return true;
  });
}

// ─── Enable-payload builder (PURE) ────────────────────────────────────────────────────────────────
// Turn a catalog item + the operator's chosen action into EXACTLY the body the EXISTING guardrails
// rules route expects (POST /api/v1/admin/guardrails/rules → validateRule → createGuardrailRule):
//   { matcher:'entity', pattern:<ENTITY>, action, label, enabled }
// We force matcher='entity' (the token is a stable UPPER_SNAKE name, never a raw regex), default the
// action to 'redact', and write a human label carrying the catalog name + engine so the rules table
// reads clearly. Pure: same inputs → same body, no I/O.

export const ENABLE_ACTIONS = ['redact', 'mask', 'hash', 'allow'] as const;
export type EnableAction = (typeof ENABLE_ACTIONS)[number];

export interface EnableRulePayload {
  matcher: 'entity';
  pattern: string;
  action: EnableAction;
  label: string;
  enabled: boolean;
}

function isEnableAction(v: unknown): v is EnableAction {
  return typeof v === 'string' && (ENABLE_ACTIONS as readonly string[]).includes(v);
}

// Build the rule-create body for enabling a catalog item. `action` defaults to 'redact'; an unknown
// value falls back to 'redact' rather than throwing. The label is stable + operator-readable.
export function buildEnablePayload(
  item: GuardrailCatalogItem,
  action: EnableAction = 'redact',
): EnableRulePayload {
  const act = isEnableAction(action) ? action : 'redact';
  const engineLabel =
    item.engine === 'presidio'
      ? 'Presidio'
      : item.engine === 'llm-guard'
        ? 'LLM Guard'
        : 'Guardrails-AI';
  return {
    matcher: 'entity',
    pattern: item.entity,
    action: act,
    label: `${item.name} (${engineLabel} — from catalog)`,
    enabled: true,
  };
}

// True when a stored rule was produced by enabling THIS catalog item — i.e. its entity token already
// has an entity-matcher rule. Lets the UI show "Enabled" and hide the enable button. Pure.
export function isItemEnabled(
  item: GuardrailCatalogItem,
  rules: readonly { matcher: string; pattern: string }[],
): boolean {
  return rules.some((r) => r.matcher === 'entity' && r.pattern === item.entity);
}
