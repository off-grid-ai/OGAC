// ─── The canonical runtime GUARDRAIL CHECK ids — PURE, zero-import ────────────────────────────────
//
// The ids of the guardrail checks that actually RUN on every request. This is the single source of
// truth for "which guardrails exist", split out from checks.ts so it carries NO I/O: checks.ts wires
// each id to its adapter (Presidio / injection scanner / grounding scorer — importing tenancy /
// next/headers via the registry), while this list can be imported by CLIENT code (the org
// PolicyEditor's constrained picker, via policy-catalog.ts) without dragging server-only modules into
// the browser bundle.
//
// checks.ts asserts its REGISTRY matches this list exactly, so the two can never drift.

export const CHECK_IDS = ['pii', 'injection', 'grounding'] as const;

export type CheckId = (typeof CHECK_IDS)[number];
