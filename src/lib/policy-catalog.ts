// ─── PURE org-POLICY value catalog (Task #173, T3) — ZERO I/O ─────────────────────────────────────
//
// The org PolicyEditor (`/governance`) used to accept ANY free-typed string for both "Guardrails" and
// "Allowed models", then POST it org-wide as policy v+1. That is silently-broken governance: a typo
// (or garbage) becomes a rule every enrolled node tries to enforce, and NOTHING catches it. This
// module is the pure allow-list the editor now constrains against — a value the org can't actually
// enforce must never be publishable.
//
// It is DERIVED from the real sources of truth, never a hand-invented list:
//   • GUARDRAILS  → the runtime CHECK registry (src/lib/checks.ts CHECK_IDS: pii · injection ·
//     grounding — the checks that actually RUN on every request), surfaced with friendly labels.
//   • MODELS      → MODEL_CATALOG ids (src/lib/model-catalog.ts) ∪ the live fleet-served routing tags
//     (fleetModelTags / mergeFleetServed). A model not in the catalog and not served by the fleet
//     can't be added — there's nowhere for it to route.
//
// Everything here is total + deterministic → unit-tested in test/policy-catalog.test.ts. No imports
// of db / network — the model set takes the live fleet tags as an argument (the caller does the I/O).

import { CHECK_IDS } from '@/lib/check-ids';
import { MODEL_CATALOG, mergeFleetServed } from '@/lib/model-catalog';

// ─── GUARDRAILS — the runtime checks that actually enforce ────────────────────────────────────────
// One option per real check id. Friendly label + plain-language help for a non-technical operator;
// the VALUE stored in the policy is the raw check id (what checks.ts REGISTRY matches on), so the
// policy stays wired to what actually runs.

export interface GuardrailOption {
  /** The check id stored in the policy — MUST be a real REGISTRY check id. */
  id: string;
  /** Friendly name shown in the picker. */
  label: string;
  /** Plain-language "what it does". */
  hint: string;
}

const GUARDRAIL_LABELS: Record<string, { label: string; hint: string }> = {
  pii: {
    label: 'PII detection & masking',
    hint: 'Detect and mask personal data (names, emails, IDs) before it reaches the model.',
  },
  injection: {
    label: 'Prompt-injection defence',
    hint: 'Block attempts to hijack the model with jailbreak / prompt-injection instructions.',
  },
  grounding: {
    label: 'Grounding check',
    hint: 'Flag answers that are not backed by a cited source.',
  },
};

// Built straight from the runtime registry ids — a friendly entry for every check that runs, and
// (defensively) a fallback entry for any future check id we haven't labelled yet, so the picker can
// never silently drop a real check.
export const GUARDRAIL_OPTIONS: GuardrailOption[] = CHECK_IDS.map((id) => {
  const meta = GUARDRAIL_LABELS[id];
  return meta ? { id, ...meta } : { id, label: id, hint: `Runtime check: ${id}.` };
});

/** The set of enforceable guardrail ids — exactly the runtime REGISTRY check ids. */
export const KNOWN_GUARDRAIL_IDS: readonly string[] = CHECK_IDS;

/** Pure: is this a real, enforceable guardrail (a runtime check id)? Trims; case-insensitive. */
export function isKnownGuardrail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return KNOWN_GUARDRAIL_IDS.some((id) => id.toLowerCase() === v);
}

// ─── MODELS — catalog ids ∪ live fleet-served tags ────────────────────────────────────────────────
// The pickable model set is the union of the curated catalog and whatever the fleet actually serves.
// mergeFleetServed already reconciles the two (and surfaces live tags with no catalog entry), so the
// known-model set is exactly the ids of that merge.

export interface ModelOption {
  /** The routing tag / id stored in the policy. */
  id: string;
  /** Human display name. */
  name: string;
  /** Family for grouping in the picker. */
  family: string;
  /** True when the on-prem fleet actually serves it right now. */
  servedOnFleet: boolean;
}

/**
 * The full pickable model set: MODEL_CATALOG ids reconciled against the live fleet routing tags.
 * Pass the live tags (from fleetModelTags(nodes)); an empty list just yields the catalog. Pure.
 */
export function modelOptions(fleetModelTagsList: readonly string[] = []): ModelOption[] {
  return mergeFleetServed(MODEL_CATALOG, [...fleetModelTagsList]).map((m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    servedOnFleet: m.servedOnFleet,
  }));
}

/** The set of allowable model ids for the given live fleet tags. */
export function knownModelIds(fleetModelTagsList: readonly string[] = []): string[] {
  return modelOptions(fleetModelTagsList).map((m) => m.id);
}

/**
 * Pure: is this a real, routable model — in the curated catalog OR served by the fleet right now?
 * Trims; case-insensitive. A value that's neither can't be added (nowhere for it to route).
 */
export function isKnownModel(value: string, fleetModelTagsList: readonly string[] = []): boolean {
  const v = value.trim().toLowerCase();
  return knownModelIds(fleetModelTagsList).some((id) => id.toLowerCase() === v);
}

// ─── Sanitisers — drop unknowns from an incoming list (used on the write path) ────────────────────
// Belt-and-suspenders for the POST route: even if a client bypasses the picker, only enforceable
// values survive. Preserves input order, de-dupes, never throws.

export function sanitizeGuardrails(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (!t || !isKnownGuardrail(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function sanitizeModels(
  values: readonly string[],
  fleetModelTagsList: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (!t || !isKnownModel(t, fleetModelTagsList)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
