// Guardrails masking-rules management — console-owned CRUD over PII/masking rules.
//
// SOLID seam: the validation + normalization below is pure and dependency-free (no Next / auth /
// DB / aliases), so it unit-tests in isolation with no mocks — the same seam as tenancy-policy.ts
// and guardrails-view.ts's normalizer. The I/O (the idempotent table ensure + the CRUD queries)
// is the thin adapter at the bottom, keyed off `@/db`.
//
// This table is SEPARATE from the data-module's `masking_rules` (kind/action only): a guardrails
// rule adds a matcher dimension (a named entity type OR a raw regex pattern) and a fuller action
// set (redact | mask | hash | allow), so operators can express both "redact all US_SSN" and
// "hash anything matching /\bACME-\d+\b/". Created idempotently on first use so it deploys over
// SSH with no migration step (like ensureChatSchema / ensureFileSchema).

// ─── Pure policy (zero-import, unit-testable) ───────────────────────────────

export const RULE_MATCHERS = ['entity', 'regex'] as const;
export const RULE_ACTIONS = ['redact', 'mask', 'hash', 'allow'] as const;

export type RuleMatcher = (typeof RULE_MATCHERS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];

export interface GuardrailRule {
  id: string;
  matcher: RuleMatcher; // 'entity' → `pattern` is an entity-type name; 'regex' → `pattern` is a regex
  pattern: string; // the entity-type name (e.g. US_SSN) or the raw regex source
  action: RuleAction;
  label: string; // operator-facing description
  enabled: boolean;
  createdAt: string;
}

// The loose, caller-supplied draft (from a JSON body). Every field is unknown so a malformed body
// degrades to a validation error rather than throwing.
export interface RuleDraft {
  matcher?: unknown;
  pattern?: unknown;
  action?: unknown;
  label?: unknown;
  enabled?: unknown;
}

export interface NormalizedRule {
  matcher: RuleMatcher;
  pattern: string;
  action: RuleAction;
  label: string;
  enabled: boolean;
}

export type ValidationResult =
  | { ok: true; value: NormalizedRule }
  | { ok: false; error: string };

function isMatcher(v: unknown): v is RuleMatcher {
  return typeof v === 'string' && (RULE_MATCHERS as readonly string[]).includes(v);
}
function isAction(v: unknown): v is RuleAction {
  return typeof v === 'string' && (RULE_ACTIONS as readonly string[]).includes(v);
}

// Validate that a `regex` matcher's pattern actually compiles — a bad pattern would otherwise
// throw at scan time. Returns the error message on failure, or null when valid.
export function regexError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'invalid regular expression';
  }
}

// Pure validation + normalization of a rule draft. Trims strings, upper-cases entity names (the
// entity catalog is upper-snake, e.g. US_SSN), defaults `enabled` to true, and compiles a regex
// matcher's pattern to reject a rule that can never run. Never throws.
export function validateRule(draft: RuleDraft | null | undefined): ValidationResult {
  const d = draft && typeof draft === 'object' ? draft : {};

  if (!isMatcher(d.matcher)) {
    return { ok: false, error: `matcher must be one of ${RULE_MATCHERS.join(' | ')}` };
  }
  if (!isAction(d.action)) {
    return { ok: false, error: `action must be one of ${RULE_ACTIONS.join(' | ')}` };
  }
  const rawPattern = typeof d.pattern === 'string' ? d.pattern.trim() : '';
  if (!rawPattern) {
    return { ok: false, error: 'pattern is required' };
  }
  // Entity names are a stable upper-snake token; regex sources are kept verbatim.
  const pattern = d.matcher === 'entity' ? rawPattern.toUpperCase() : rawPattern;
  if (d.matcher === 'entity' && !/^[A-Z][A-Z0-9_]*$/.test(pattern)) {
    return { ok: false, error: 'entity name must be UPPER_SNAKE (e.g. US_SSN)' };
  }
  if (d.matcher === 'regex') {
    const err = regexError(pattern);
    if (err) return { ok: false, error: `invalid regex: ${err}` };
  }

  const label = typeof d.label === 'string' ? d.label.trim().slice(0, 200) : '';
  // enabled defaults to true; only an explicit `false` disables.
  const enabled = d.enabled === undefined ? true : d.enabled !== false;

  return { ok: true, value: { matcher: d.matcher, pattern, action: d.action, label, enabled } };
}

// ─── Thin adapter (I/O) ─────────────────────────────────────────────────────

// Lazily imported so the pure exports above stay free of DB/runtime deps for the unit tests.
let ensurePromise: Promise<void> | null = null;
export async function ensureGuardrailRulesSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS guardrails_rules (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        matcher text NOT NULL,
        pattern text NOT NULL,
        action text NOT NULL,
        label text NOT NULL DEFAULT '',
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface RuleRow {
  id: string;
  matcher: string;
  pattern: string;
  action: string;
  label: string;
  enabled: boolean;
  created_at: Date | string;
}

function rowToRule(r: RuleRow): GuardrailRule {
  return {
    id: r.id,
    matcher: (RULE_MATCHERS as readonly string[]).includes(r.matcher)
      ? (r.matcher as RuleMatcher)
      : 'entity',
    pattern: r.pattern,
    action: (RULE_ACTIONS as readonly string[]).includes(r.action)
      ? (r.action as RuleAction)
      : 'redact',
    label: r.label ?? '',
    enabled: r.enabled === true,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function listGuardrailRules(orgId = 'default'): Promise<GuardrailRule[]> {
  await ensureGuardrailRulesSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    SELECT id, matcher, pattern, action, label, enabled, created_at
    FROM guardrails_rules WHERE org_id = ${orgId} ORDER BY created_at DESC;
  `);
  return (res.rows as unknown as RuleRow[]).map(rowToRule);
}

export async function createGuardrailRule(
  value: NormalizedRule,
  orgId = 'default',
): Promise<GuardrailRule> {
  await ensureGuardrailRulesSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const { randomUUID } = await import('crypto');
  const id = `grr_${randomUUID().slice(0, 8)}`;
  const res = await db.execute(sql`
    INSERT INTO guardrails_rules (id, org_id, matcher, pattern, action, label, enabled)
    VALUES (${id}, ${orgId}, ${value.matcher}, ${value.pattern}, ${value.action}, ${value.label}, ${value.enabled})
    RETURNING id, matcher, pattern, action, label, enabled, created_at;
  `);
  return rowToRule((res.rows as unknown as RuleRow[])[0]);
}

export async function updateGuardrailRule(
  id: string,
  value: NormalizedRule,
  orgId = 'default',
): Promise<GuardrailRule | null> {
  await ensureGuardrailRulesSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    UPDATE guardrails_rules
    SET matcher = ${value.matcher}, pattern = ${value.pattern}, action = ${value.action},
        label = ${value.label}, enabled = ${value.enabled}
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id, matcher, pattern, action, label, enabled, created_at;
  `);
  const rows = res.rows as unknown as RuleRow[];
  return rows.length ? rowToRule(rows[0]) : null;
}

export async function setGuardrailRuleEnabled(
  id: string,
  enabled: boolean,
  orgId = 'default',
): Promise<GuardrailRule | null> {
  await ensureGuardrailRulesSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    UPDATE guardrails_rules SET enabled = ${enabled}
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id, matcher, pattern, action, label, enabled, created_at;
  `);
  const rows = res.rows as unknown as RuleRow[];
  return rows.length ? rowToRule(rows[0]) : null;
}

export async function deleteGuardrailRule(id: string, orgId = 'default'): Promise<boolean> {
  await ensureGuardrailRulesSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    DELETE FROM guardrails_rules WHERE id = ${id} AND org_id = ${orgId} RETURNING id;
  `);
  return (res.rows as unknown[]).length > 0;
}
