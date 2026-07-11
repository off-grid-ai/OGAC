// ─── Builder fix-it analysis (Builder Epic #115) — PURE, zero-IO ─────────────────────────────────
//
// The founder's #1 complaint was "unusable — IDK how to use it." The compiler already returns honest
// gap STRINGS ("No data source declared for 'invoices' …") and the spec already flags unbound steps,
// but a wall of prose is not usable. This module turns those two inputs — the compiler's gap strings
// AND the AppSpec — into STRUCTURED, actionable fix-it items the builder renders as inline buttons:
// "Wire a data source", "Write instructions", "Pick a data source", etc. Each item names the step it
// concerns (when it can) so the UI can scroll to / highlight it.
//
// SOLID: this is pure decision logic (string+spec → FixIt[]), unit-tested in test/builder-gaps.test.ts.
// The React builder is a thin caller that renders a button per FixIt and wires its `action` to a
// handler. No fabrication: a data-source gap becomes a "create a data-domain" affordance, never a fake
// binding — mirrors the compiler's honesty bar.

import type { AppSpec, AppStep } from '@/lib/app-model';

// ─── FixIt — one actionable thing the operator must resolve ──────────────────────────────────────
export type FixItAction =
  | 'wire-data-source' // a data phrase had no declared domain → offer to create one (carries `phrase`)
  | 'bind-step' // a connector-query step is unbound → offer the domain picker on that step
  | 'add-instructions' // an inline agent step has no system prompt → focus its instructions box
  | 'pick-agent' // an agent step references nothing → pick/write on that step
  | 'review'; // a generic gap with no automatic remedy → surface for the operator to read

export interface FixIt {
  /** Stable key for React lists + de-dupe. */
  id: string;
  /** The kind of remedy the UI should offer. */
  action: FixItAction;
  /** One-line, plain-language description of what to do. */
  title: string;
  /** The step this concerns, when it maps to a concrete step (so the UI can scroll to it). */
  stepId?: string;
  /** For wire-data-source: the data phrase that had no source, prefilled into the create form. */
  phrase?: string;
  /** Severity — a `blocker` prevents save/run; `advisory` is a nudge. */
  severity: 'blocker' | 'advisory';
}

// The compiler's data-source gap wording (see app-compile.ts bindDataPhrase):
//   `No data source declared for "<phrase>" — add a data-domain mapping to wire this step.`
const NO_SOURCE_RE = /No data source declared for "([^"]+)"/i;

// ─── analyzeGaps — the compiler's gap strings → structured items ─────────────────────────────────
// Parses each free-text gap into a FixIt. A "No data source declared for X" gap becomes a
// wire-data-source action carrying the phrase (so the inline create panel can prefill the label).
// Anything else is surfaced as an advisory `review` item so nothing is hidden — the operator still
// sees it, it just has no one-click remedy.
//
// SEVERITY (the save-with-gap fix, #128): a wire-data-source gap is ADVISORY, not a blocker. Here's
// why that's honest — when the compiler can't bind a data phrase it DROPS that connector-query step,
// so the saved spec is fully valid and runnable; it just doesn't read that source yet. A first-time,
// non-technical user with zero declared sources MUST be able to save their app and wire the source
// later (from this gap, or the app's own screens) — not hit a wall on step one. The genuinely
// BLOCKING case is a connector-query step that IS in the spec but carries no domain (analyzeSpec →
// bind-step): that step would error at run time, so it stays a blocker.
export function analyzeGaps(gaps: string[]): FixIt[] {
  const out: FixIt[] = [];
  gaps.forEach((raw, i) => {
    const g = (raw ?? '').trim();
    if (!g) return;
    const m = NO_SOURCE_RE.exec(g);
    if (m) {
      const phrase = m[1].trim();
      out.push({
        id: `gap-source-${i}`,
        action: 'wire-data-source',
        title: `Not reading a source for "${phrase}" yet`,
        phrase,
        severity: 'advisory',
      });
      return;
    }
    out.push({ id: `gap-${i}`, action: 'review', title: g, severity: 'advisory' });
  });
  return out;
}

// ─── analyzeSpec — the CURRENT spec → structured items for unbound/unfinished steps ──────────────
// Independent of the compiler: as the operator edits, a connector-query step with no domain, or an
// inline agent step with an empty prompt, is a blocker. This is what keeps the fix-it panel live
// after the initial compile (the gaps strings are a one-shot; the spec is the source of truth).
export function analyzeSpec(spec: AppSpec | null): FixIt[] {
  if (!spec) return [];
  const out: FixIt[] = [];
  for (const step of spec.steps) {
    const fix = fixForStep(step);
    if (fix) out.push(fix);
  }
  return out;
}

function fixForStep(step: AppStep): FixIt | null {
  switch (step.kind) {
    case 'connector-query':
      if (!step.domain?.trim()) {
        return {
          id: `step-${step.id}-unbound`,
          action: 'bind-step',
          title: `"${step.label}" has no data source`,
          stepId: step.id,
          severity: 'blocker',
        };
      }
      return null;
    case 'agent':
      if (!step.agentId && !step.inlineAgent?.systemPrompt?.trim()) {
        return {
          id: `step-${step.id}-noprompt`,
          action: step.inlineAgent ? 'add-instructions' : 'pick-agent',
          title: `"${step.label}" needs instructions or an agent`,
          stepId: step.id,
          severity: 'blocker',
        };
      }
      return null;
    default:
      return null;
  }
}

// ─── mergeFixIts — combine compiler gaps + live spec analysis, de-duped, blockers first ──────────
// The builder shows ONE list. The spec-derived items are the live source of truth for unbound steps,
// so if a wire-data-source gap (from the compiler, phrase-based) and a bind-step item (from the spec,
// step-based) both point at the same unresolved data need, we keep BOTH only while they're distinct —
// they offer different remedies (create a domain vs. pick an existing one). We de-dupe purely on id.
// Ordering: blockers before advisories, otherwise stable.
export function mergeFixIts(fromGaps: FixIt[], fromSpec: FixIt[]): FixIt[] {
  const seen = new Set<string>();
  const all: FixIt[] = [];
  for (const f of [...fromGaps, ...fromSpec]) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    all.push(f);
  }
  return all.sort((a, b) => rank(a.severity) - rank(b.severity));
}

function rank(sev: FixIt['severity']): number {
  return sev === 'blocker' ? 0 : 1;
}

// ─── blockerCount — how many fix-its actually block save/run ─────────────────────────────────────
export function blockerCount(items: FixIt[]): number {
  return items.filter((i) => i.severity === 'blocker').length;
}
