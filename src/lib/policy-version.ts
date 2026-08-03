import { createHash } from 'node:crypto';

// ─── What the policy SAID, at the moment a decision was made ───────────────────────────────────────
//
// policy_rules is a live table an admin edits in place. That is fine for enforcement and useless for
// audit: a regulator asking "under what rule was this claim auto-approved in March?" gets today's
// rules, which may have been rewritten twice since. There was no history at all.
//
// So every change to the ruleset mints an immutable VERSION, and each governed run records the
// version number in force when it ran. This module is the pure half — hashing, versioning, and
// turning two rule sets into a change list a compliance officer can read. Zero IO.

/** The subset of a rule that changes MEANING. Ordering, ids and timestamps deliberately excluded. */
export interface VersionedRule {
  name: string;
  attribute: string;
  operator: string;
  value: string;
  effect: string;
  priority: number;
  enabled: boolean;
}

export interface RuleChange {
  kind: 'added' | 'removed' | 'changed' | 'enabled' | 'disabled';
  rule: string;
  /** Operator language, not a field dump — "denies instead of allows", not "effect: allow→deny". */
  detail: string;
}

/** Stable identity of a rule across edits. Renaming a rule reads as remove + add, which is honest. */
function keyOf(r: VersionedRule): string {
  return r.name.trim().toLowerCase();
}

function canonical(rules: readonly VersionedRule[]): VersionedRule[] {
  return rules
    .map((r) => ({
      name: r.name.trim(),
      attribute: r.attribute.trim(),
      operator: r.operator.trim(),
      value: r.value.trim(),
      effect: r.effect.trim(),
      priority: r.priority,
      enabled: r.enabled,
    }))
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/**
 * Content hash of a ruleset. Two rulesets that enforce the same thing hash the same, so re-saving a
 * rule without changing it does NOT mint a version — a history full of no-op versions is a history
 * nobody reads.
 */
export function digestRules(rules: readonly VersionedRule[]): string {
  return createHash('sha256').update(JSON.stringify(canonical(rules))).digest('hex').slice(0, 16);
}

const OPERATOR_WORDS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  nin: 'is not one of',
  contains: 'contains',
  gt: 'is above',
  lt: 'is below',
};

/** One rule as a sentence — this is what a compliance officer reads in the history, not JSON. */
export function describeRule(r: VersionedRule): string {
  const op = OPERATOR_WORDS[r.operator] ?? r.operator;
  const verb = r.effect === 'allow' ? 'Allow' : 'Deny';
  return `${verb} when ${r.attribute} ${op} ${r.value}`;
}

/** What changed between two versions, in operator language. Empty means the two are equivalent. */
export function diffRuleSets(
  before: readonly VersionedRule[],
  after: readonly VersionedRule[],
): RuleChange[] {
  const prev = new Map(canonical(before).map((r) => [keyOf(r), r]));
  const next = new Map(canonical(after).map((r) => [keyOf(r), r]));
  const changes: RuleChange[] = [];

  for (const [k, r] of next) {
    const old = prev.get(k);
    if (!old) {
      changes.push({ kind: 'added', rule: r.name, detail: `New rule — ${describeRule(r)}` });
      continue;
    }
    // Turning a rule off is the change most worth calling out on its own: the rule still exists, so
    // a reader scanning names sees no difference, but nothing is being enforced.
    if (old.enabled !== r.enabled) {
      changes.push(
        r.enabled
          ? { kind: 'enabled', rule: r.name, detail: 'Switched back on — it is enforced again' }
          : { kind: 'disabled', rule: r.name, detail: 'Switched off — it stopped being enforced' },
      );
    }
    if (old.effect !== r.effect) {
      changes.push({
        kind: 'changed',
        rule: r.name,
        detail: `Now ${r.effect === 'allow' ? 'allows' : 'denies'} where it previously ${old.effect === 'allow' ? 'allowed' : 'denied'}`,
      });
    }
    if (old.attribute !== r.attribute || old.operator !== r.operator || old.value !== r.value) {
      changes.push({
        kind: 'changed',
        rule: r.name,
        detail: `Condition changed — was "${describeRule(old)}", now "${describeRule(r)}"`,
      });
    }
    if (old.priority !== r.priority) {
      changes.push({
        kind: 'changed',
        rule: r.name,
        detail:
          r.priority < old.priority
            ? 'Moved earlier — it now settles cases other rules used to'
            : 'Moved later — other rules now settle cases it used to',
      });
    }
  }

  for (const [k, r] of prev) {
    if (!next.has(k)) {
      changes.push({ kind: 'removed', rule: r.name, detail: `Removed — it no longer ${r.effect === 'allow' ? 'allows' : 'blocks'} anything` });
    }
  }

  return changes;
}

/** A one-line summary for the history row. */
export function summariseChanges(changes: readonly RuleChange[]): string {
  if (!changes.length) return 'No change to what is enforced';
  const n = (k: RuleChange['kind']) => changes.filter((c) => c.kind === k).length;
  const parts: string[] = [];
  const add = (count: number, word: string) => {
    if (count) parts.push(`${count} rule${count === 1 ? '' : 's'} ${word}`);
  };
  add(n('added'), 'added');
  add(n('removed'), 'removed');
  add(n('changed'), 'changed');
  add(n('disabled'), 'switched off');
  add(n('enabled'), 'switched back on');
  return parts.join(', ');
}

/**
 * The version in force at a given moment — the newest version created at or before it. Returns null
 * when the instant predates any recorded version, which must be reported as "not recorded", never
 * silently attributed to version 1.
 */
export function versionInForceAt<T extends { version: number; createdAt: Date }>(
  history: readonly T[],
  at: Date,
): T | null {
  let best: T | null = null;
  for (const v of history) {
    if (v.createdAt.getTime() > at.getTime()) continue;
    if (!best || v.version > best.version) best = v;
  }
  return best;
}
