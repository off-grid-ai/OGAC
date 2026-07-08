// PURE edge-WAF intent logic — zero I/O, unit-testable. The console reads the LIVE Caddy edge
// (see edge-log.ts) but CANNOT safely reload Caddy from inside the app, so operator changes to the
// WAF (turn it on/off, add/edit/remove a custom rule) are recorded as *intent*: a persisted desired
// state that "applies on next edge reload". This module owns the rules of that intent — validation,
// normalization, and the diff against what's live — with no database or filesystem access.
//
// The I/O seam (persist/read the intent, plus the audited write routes) lives in store.ts and the
// route handlers. Keeping this split means the WAF rules stay testable without a DB.

export interface WafRule {
  /** Stable id (slugified name; caller may supply). */
  id: string;
  /** Human label shown in the block reason (Caddy `msg:'…'`). */
  name: string;
  /** What the rule matches — a short human description of the pattern (path/UA/etc.). */
  pattern: string;
  /** Whether this rule is armed. A disarmed rule is kept but not enforced. */
  enabled: boolean;
}

export interface EdgeIntent {
  /** Desired WAF on/off. */
  wafEnabled: boolean;
  /** Operator-authored custom rules layered on top of the baseline Caddy ruleset. */
  rules: WafRule[];
  /** ISO timestamp of the last intent change (audit / "pending since"). */
  updatedAt: string;
}

/** The default (never-configured) intent: WAF on, no custom rules. */
export function defaultIntent(now: () => Date = () => new Date()): EdgeIntent {
  return { wafEnabled: true, rules: [], updatedAt: now().toISOString() };
}

// Slugify a name into a stable, filename/id-safe rule id. Lowercase, alnum + dashes, collapsed.
export function ruleIdFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export interface RuleInput {
  id?: string;
  name?: string;
  pattern?: string;
  enabled?: boolean;
}

export type RuleValidation = { ok: true; rule: WafRule } | { ok: false; error: string };

// Validate + normalize a rule payload from the API into a WafRule. Pure — no persistence.
export function validateRule(input: RuleInput): RuleValidation {
  const name = (input.name ?? '').trim();
  if (name.length < 2) return { ok: false, error: 'name must be at least 2 characters' };
  if (name.length > 80) return { ok: false, error: 'name must be 80 characters or fewer' };
  const pattern = (input.pattern ?? '').trim();
  if (pattern.length < 1) return { ok: false, error: 'pattern is required' };
  if (pattern.length > 200) return { ok: false, error: 'pattern must be 200 characters or fewer' };
  const id = (input.id ?? '').trim() || ruleIdFromName(name);
  if (!id) return { ok: false, error: 'could not derive a rule id from the name' };
  return {
    ok: true,
    rule: { id, name, pattern, enabled: input.enabled !== false },
  };
}

// Upsert a rule into the intent's rule list (match by id), returning a NEW intent. Pure.
export function upsertRule(intent: EdgeIntent, rule: WafRule, now: () => Date = () => new Date()): EdgeIntent {
  const idx = intent.rules.findIndex((r) => r.id === rule.id);
  const rules = idx >= 0
    ? intent.rules.map((r, i) => (i === idx ? rule : r))
    : [...intent.rules, rule];
  return { ...intent, rules, updatedAt: now().toISOString() };
}

// Remove a rule by id, returning a NEW intent. `changed` reports whether anything was removed. Pure.
export function removeRule(
  intent: EdgeIntent,
  id: string,
  now: () => Date = () => new Date(),
): { intent: EdgeIntent; changed: boolean } {
  const rules = intent.rules.filter((r) => r.id !== id);
  const changed = rules.length !== intent.rules.length;
  return {
    intent: changed ? { ...intent, rules, updatedAt: now().toISOString() } : intent,
    changed,
  };
}

// Set the WAF on/off flag, returning a NEW intent. Pure.
export function setWafEnabled(
  intent: EdgeIntent,
  enabled: boolean,
  now: () => Date = () => new Date(),
): EdgeIntent {
  if (intent.wafEnabled === enabled) return intent;
  return { ...intent, wafEnabled: enabled, updatedAt: now().toISOString() };
}

/**
 * Compare the operator's desired intent against what Caddy is LIVE-enforcing right now, so the UI
 * can honestly show "pending — applies on next edge reload" vs "in sync". Pure: the caller passes
 * the live state read from edge-log.ts.
 */
export interface LiveEdgeState {
  wafEnabled: boolean;
  /** The rule messages Caddy currently enforces (from the parsed Caddyfile). */
  liveRuleNames: string[];
}

export interface IntentDiff {
  /** True when the desired state matches what's live (nothing pending). */
  inSync: boolean;
  /** WAF on/off differs. */
  wafPending: boolean;
  /** Enabled custom rules whose name isn't present live yet. */
  pendingRules: string[];
  /** Live rule names no operator-enabled rule accounts for (would be dropped on reload). */
  removedRules: string[];
}

export function diffIntent(intent: EdgeIntent, live: LiveEdgeState): IntentDiff {
  const wafPending = intent.wafEnabled !== live.wafEnabled;
  const enabledNames = new Set(intent.rules.filter((r) => r.enabled).map((r) => r.name));
  const liveNames = new Set(live.liveRuleNames);
  const pendingRules = [...enabledNames].filter((n) => !liveNames.has(n));
  const removedRules = [...liveNames].filter((n) => !enabledNames.has(n));
  return {
    inSync: !wafPending && pendingRules.length === 0 && removedRules.length === 0,
    wafPending,
    pendingRules,
    removedRules,
  };
}
