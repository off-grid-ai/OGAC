// ─── An agent may not reason about data no step reads — pure ──────────────────────────────────────
//
// B3.1. Compiling "…read the claim, check that employee's remaining reimbursement quota, decide whether
// it is within quota…" produced this:
//
//   s1 connector-query  expense claims
//   s2 agent            "Determine if the claim amount exceeds the employee's remaining quota"
//   s3 human            s4 output
//
// The quota is never read. The agent is instructed to compare against a number it was never given, the
// spec validates, the app runs, and it answers confidently from data it does not have — with `gaps: []`,
// so nothing warns the author. That is the same defect class as the earlier `(no output)` and the
// twenty-unrelated-rows read: a confident answer built on absent data.
//
// The decomposition is allowed to be imperfect — a model turned a data clause into a reasoning step, and
// the heuristic path happens to get this one right. What is NOT acceptable is shipping the inconsistency
// silently. So after decomposition we check every agent step against the org's DECLARED domains:
//
//   • the phrase resolves to a declared domain, and no earlier step reads it  → INSERT the read.
//     The domain is declared and unambiguous (resolveDomain is no-guess), so the author's intent is
//     unmistakable and fetching it is strictly better than reasoning without it.
//   • the phrase looks like data but resolves to nothing → record a GAP, never invent a source.
//
// This is deliberately conservative: it only fires on phrases the org's own domain resolver confidently
// binds. It cannot fabricate a connector, and it cannot silently widen what an app reads.

import type { AppStep } from '@/lib/app-model';
import type { DataDomain } from '@/lib/data-domains';
import { resolveQualifiedPhrase } from '@/lib/phrase-qualifier';

/**
 * Compare labels on a lightly stemmed form.
 *
 * The specialisation check has to survive plural/singular: the step label "Read Expense Claim" reduces to
 * "expense claim" while the sibling domain is labelled "claims", and neither string contains the other —
 * so without stemming the guard silently failed and the insurance table was still added. Dropping a
 * trailing "s" per word is crude but exactly sufficient here, and it cannot merge unrelated nouns.
 */
function norm(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

/** A step reduced to what this rule needs. Structural, so it is testable without the whole AppSpec. */
export interface DependencyStep {
  id: string;
  kind: string;
  label?: string;
  domain?: string;
  inlineAgent?: { systemPrompt?: string } | null;
}

/**
 * Noun phrases an agent step might be referring to, drawn from its label and prompt.
 *
 * Kept to 2–4 word windows: a single word is too weak to bind confidently (and "claim" is exactly the
 * mis-binding that motivated the qualifier work), while anything longer stops resembling a domain name.
 */
export function candidatePhrases(step: DependencyStep): string[] {
  const text = `${step.label ?? ''} ${step.inlineAgent?.systemPrompt ?? ''}`.toLowerCase();
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set<string>();
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      out.add(words.slice(i, i + n).join(' '));
    }
  }
  return [...out];
}

export interface DependencyFix {
  /** Steps with any missing reads inserted, in order. */
  steps: DependencyStep[];
  /** Domain ids that were inserted, for the caller to report. */
  inserted: { domainId: string; domainLabel: string; beforeStepId: string }[];
}

/**
 * Insert a read for any declared domain an agent step reasons about but nothing fetches.
 *
 * `resolve` is the caller's real resolution rule, injected so this module stays pure and the no-guess
 * semantics live in one place. `makeRead` builds the caller's own connector-query step so this module
 * does not need to know the AppStep shape.
 */
export function ensureAgentDataReads(
  steps: readonly DependencyStep[],
  description: string,
  resolve: (phrase: string) => DataDomain | null,
  makeRead: (domain: DataDomain, id: string) => DependencyStep,
): DependencyFix {
  const out: DependencyStep[] = [];
  const inserted: DependencyFix['inserted'] = [];
  // Domains already read by an EARLIER step. Order matters: a read after the agent does not help it.
  const readSoFar = new Set<string>();
  const labelsRead: string[] = [];
  let synthetic = 0;

  /**
   * Is this domain already covered by something read earlier?
   *
   * Not just by id — also by SPECIALISATION. The live case: an expense-claim app already reads
   * "expense claims", and the agent's prompt says "if the claim amount exceeds…". The phrase "the claim
   * amount" fuzzily resolves to the org's separate INSURANCE "claims" table, so the pass helpfully added
   * a read of insurance claims to an expense-claim app — reintroducing the very mis-binding that
   * phrase-qualifier.ts exists to prevent.
   *
   * A domain whose label is a substring of one already read is the broader sibling of the same noun
   * ("claims" ⊂ "expense claims"). The specific one is what the author meant; adding the general one on
   * top is never the intent, and reading an unrelated table is worse than reading nothing.
   */
  const alreadyCovered = (d: DataDomain): boolean => {
    if (readSoFar.has(d.id)) return true;
    const label = norm(d.label);
    return labelsRead.some((seen) => seen.includes(label) || label.includes(seen));
  };
  const markRead = (id: string, label: string) => {
    readSoFar.add(id);
    labelsRead.push(norm(label));
  };

  for (const step of steps) {
    if (step.kind === 'connector-query' && step.domain) {
      // The label is needed for the specialisation check, so prefer the domain's own label when the
      // caller's step carries the "Read <label>" form.
      markRead(step.domain, (step.label ?? '').replace(/^read\s+/i, ''));
      out.push(step);
      continue;
    }
    if (step.kind !== 'agent') {
      out.push(step);
      continue;
    }

    // Longest phrases first, so a specific reading ("remaining reimbursement quota") is preferred over a
    // vaguer one that happens to also resolve.
    const phrases = candidatePhrases(step).sort((a, b) => b.length - a.length);
    const needed: DataDomain[] = [];
    for (const phrase of phrases) {
      const { resolved } = resolveQualifiedPhrase(phrase, description, resolve);
      if (!resolved || alreadyCovered(resolved) || needed.some((d) => d.id === resolved.id)) continue;
      // A broader sibling of something we are about to add is equally unwanted.
      if (needed.some((d) => {
        const a = norm(d.label);
        const b = norm(resolved.label);
        return a.includes(b) || b.includes(a);
      })) continue;
      needed.push(resolved);
    }

    for (const domain of needed) {
      synthetic += 1;
      const read = makeRead(domain, `dep${synthetic}`);
      out.push(read);
      markRead(domain.id, domain.label);
      inserted.push({ domainId: domain.id, domainLabel: domain.label, beforeStepId: step.id });
    }
    out.push(step);
  }

  return { steps: out, inserted };
}

/** The line the author sees when a read was added on their behalf — never a silent change. */
export function insertionNote(domainLabel: string, agentLabel: string): string {
  return `Added a read of "${domainLabel}" before "${agentLabel}" — that step reasons about it, and nothing was fetching it.`;
}
