// ─── AUTO-SUGGEST GUARDRAILS + EVALS for a draft pipeline — PURE, ZERO-IO ─────────────────────────
//
// M5. A non-technical operator describes a pipeline in plain language ("summarise customer support
// tickets for the credit-cards team") and picks its data allowlist. They should NOT then have to
// know which of ~35 guardrails and ~22 eval templates matter. This maps the pipeline's PURPOSE TEXT
// + DATA ALLOWLIST → a starter set of catalog items the builder can one-click apply.
//
// Rule-based, deterministic, explainable: every suggestion carries a plain-language `reason` and a
// `confidence`. The gateway can OPTIONALLY refine the ranking (see copilot-gateway.ts), but the base
// suggestion never depends on the model being up — the catalogs are the source of truth, and we only
// ever suggest items that EXIST in them (never fabricate an id).
//
// Signals we read from the text/allowlist (keyword → concept), each mapped to catalog ids:
//   • PII/identity, financial, contact, medical, government → Presidio entity guardrails + PII evals
//   • "customer", "support", "chat", "answer" → answer-relevancy + faithfulness evals
//   • RAG signals ("document", "knowledge", "retrieve", "search") → RAG eval suite
//   • any external/user-facing text → toxicity + prompt-injection guardrails + safety evals
//   • defaultEnabled catalog items are always in the recommended floor.

import {
  GUARDRAIL_CATALOG,
  type GuardrailCatalogItem,
} from './guardrails-catalog';
import { EVAL_TEMPLATES, type EvalTemplate } from './eval-templates';

/** The draft-pipeline descriptor the suggester reads. Pure input — no IDs into the DB. */
export interface PipelineDraft {
  /** Plain-language purpose/goal text the operator wrote. */
  purpose: string;
  /** Data domains/tables the pipeline is allowed to touch (the allowlist chips). */
  allowlist?: string[];
}

export type SuggestionConfidence = 'recommended' | 'suggested' | 'optional';

export interface GuardrailSuggestion {
  id: string;
  name: string;
  category: string;
  /** UPPER_SNAKE token to write when applied (the catalog item's `entity`). */
  entity: string;
  confidence: SuggestionConfidence;
  reason: string;
}

export interface EvalSuggestion {
  id: string;
  name: string;
  category: string;
  engine: string;
  defaultThreshold: number;
  confidence: SuggestionConfidence;
  reason: string;
}

export interface ControlSuggestions {
  guardrails: GuardrailSuggestion[];
  evals: EvalSuggestion[];
  /** The concepts detected in the draft — surfaced so the UI can explain WHY. */
  signals: string[];
}

// ─── Concept detection — keyword sets → a normalized concept. Kept small + auditable. ─────────────
interface Concept {
  id: string;
  /** lowercase substrings that fire this concept. */
  keywords: string[];
}

const CONCEPTS: Concept[] = [
  { id: 'pii', keywords: ['customer', 'user', 'personal', 'name', 'contact', 'profile', 'identity', 'pii', 'person'] },
  { id: 'financial', keywords: ['payment', 'card', 'bank', 'invoice', 'transaction', 'loan', 'credit', 'account', 'finance', 'ifsc', 'upi', 'iban'] },
  { id: 'medical', keywords: ['patient', 'health', 'medical', 'clinical', 'diagnosis', 'phi'] },
  { id: 'government', keywords: ['passport', 'aadhaar', 'pan', 'ssn', 'license', 'national id', 'tax id'] },
  { id: 'rag', keywords: ['document', 'knowledge', 'retrieve', 'search', 'kb', 'wiki', 'manual', 'policy doc', 'faq', 'context'] },
  { id: 'support', keywords: ['support', 'ticket', 'help', 'answer', 'question', 'respond', 'reply', 'assist', 'chat'] },
  { id: 'summarize', keywords: ['summar', 'digest', 'brief', 'condense', 'tl;dr'] },
  { id: 'external', keywords: ['customer', 'public', 'external', 'user-facing', 'chatbot', 'assistant', 'respond', 'reply', 'email'] },
];

/** Detect the concepts present in a draft's purpose + allowlist. Pure, order-stable. */
export function detectConcepts(draft: PipelineDraft): string[] {
  const hay = [draft.purpose, ...(draft.allowlist ?? [])].join(' ').toLowerCase();
  const found: string[] = [];
  for (const c of CONCEPTS) {
    if (c.keywords.some((k) => hay.includes(k))) found.push(c.id);
  }
  return found;
}

// Which guardrail CATEGORIES a concept implies. We suggest the concrete catalog items in those
// categories (favouring defaultEnabled ones as "recommended").
const CONCEPT_GUARDRAIL_CATEGORIES: Record<string, GuardrailCatalogItem['category'][]> = {
  pii: ['Identity', 'Contact'],
  financial: ['Financial'],
  medical: ['Medical'],
  government: ['Government & Country'],
  external: ['Content Safety', 'Prompt Security'],
};

// Which eval template IDS a concept implies. Only ids that exist in EVAL_TEMPLATES survive.
const CONCEPT_EVAL_IDS: Record<string, string[]> = {
  rag: ['faithfulness', 'answer_relevancy', 'context_precision', 'context_recall'],
  support: ['answer_relevancy', 'correctness'],
  summarize: ['faithfulness'],
  external: ['toxicity', 'prompt_injection', 'refusal'],
  pii: ['pii_leakage'],
  medical: ['pii_leakage'],
  financial: ['pii_leakage'],
};

const CONCEPT_REASON: Record<string, string> = {
  pii: 'the pipeline handles people / customer data',
  financial: 'the pipeline touches financial data',
  medical: 'the pipeline touches health / clinical data',
  government: 'the pipeline touches government-issued identifiers',
  rag: 'the pipeline answers from documents / knowledge (RAG)',
  support: 'the pipeline answers questions / handles support',
  summarize: 'the pipeline summarises content',
  external: 'the pipeline produces user-facing / external output',
};

function guardrailConfidence(item: GuardrailCatalogItem): SuggestionConfidence {
  return item.defaultEnabled ? 'recommended' : 'suggested';
}

/**
 * Suggest a starter set of guardrails + evals for a draft pipeline. Pure + deterministic. Always
 * includes the catalog's defaultEnabled guardrail floor (the protections everyone wants), then adds
 * concept-driven items. De-duped, stable order. Only real catalog ids are ever returned.
 */
export function suggestControls(draft: PipelineDraft): ControlSuggestions {
  const signals = detectConcepts(draft);

  // ── Guardrails ──────────────────────────────────────────────────────────────────────────────
  const grById = new Map<string, GuardrailSuggestion>();

  // 1. The always-on floor: every defaultEnabled catalog item.
  for (const item of GUARDRAIL_CATALOG) {
    if (item.defaultEnabled) {
      grById.set(item.id, {
        id: item.id,
        name: item.name,
        category: item.category,
        entity: item.entity,
        confidence: 'recommended',
        reason: 'a standard protection recommended for every pipeline',
      });
    }
  }

  // 2. Concept-driven categories.
  for (const concept of signals) {
    const cats = CONCEPT_GUARDRAIL_CATEGORIES[concept];
    if (!cats) continue;
    for (const item of GUARDRAIL_CATALOG) {
      if (!cats.includes(item.category)) continue;
      if (grById.has(item.id)) continue; // floor item already stronger-labelled
      grById.set(item.id, {
        id: item.id,
        name: item.name,
        category: item.category,
        entity: item.entity,
        confidence: guardrailConfidence(item),
        reason: `because ${CONCEPT_REASON[concept]}`,
      });
    }
  }

  // ── Evals ───────────────────────────────────────────────────────────────────────────────────
  const evalById = new Map<string, EvalSuggestion>();
  const templateById = new Map<string, EvalTemplate>(EVAL_TEMPLATES.map((t) => [t.id, t]));

  for (const concept of signals) {
    const ids = CONCEPT_EVAL_IDS[concept];
    if (!ids) continue;
    for (const id of ids) {
      const t = templateById.get(id);
      if (!t || evalById.has(t.id)) continue;
      evalById.set(t.id, {
        id: t.id,
        name: t.name,
        category: t.category,
        engine: t.engine,
        defaultThreshold: t.defaultThreshold,
        confidence: 'suggested',
        reason: `because ${CONCEPT_REASON[concept]}`,
      });
    }
  }

  // Floor: if NOTHING matched (a bare description), still suggest a general quality + safety pair so
  // the operator is never handed an empty set for a real pipeline.
  if (evalById.size === 0 && draft.purpose.trim().length > 0) {
    for (const id of ['answer_relevancy', 'toxicity']) {
      const t = templateById.get(id);
      if (t) {
        evalById.set(t.id, {
          id: t.id,
          name: t.name,
          category: t.category,
          engine: t.engine,
          defaultThreshold: t.defaultThreshold,
          confidence: 'optional',
          reason: 'a sensible default check for any pipeline',
        });
      }
    }
  }

  // Rank: recommended > suggested > optional, then by name for stability.
  const order: Record<SuggestionConfidence, number> = { recommended: 0, suggested: 1, optional: 2 };
  const rank = <T extends { confidence: SuggestionConfidence; name: string }>(a: T, b: T) =>
    order[a.confidence] - order[b.confidence] || a.name.localeCompare(b.name);

  return {
    guardrails: [...grById.values()].sort(rank),
    evals: [...evalById.values()].sort(rank),
    signals: signals.map((s) => CONCEPT_REASON[s] ?? s),
  };
}
