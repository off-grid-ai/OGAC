// ─── PURE LiteLLM virtual-key policy: validation, request-body building, list shaping ──────────────
//
// The console manages LiteLLM's virtual keys (create/update/delete/list) to govern spend + rate on
// the gateway — LiteLLM's native FinOps (per-key max_budget + rpm/tpm). This module is the zero-I/O
// decision layer: validate operator input, build the exact snake_case body LiteLLM's /key/* API
// wants, and shape /key/list rows into a safe view. The I/O caller (litellm.ts) feeds it real data.

export interface KeyInput {
  keyAlias?: string | null;
  /** $ ceiling; null/undefined ⇒ unbounded. */
  maxBudget?: number | null;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  /** Models this key may call; empty ⇒ all configured models. */
  models?: string[];
  /** Optional budget reset window, e.g. "30d", "1mo" (LiteLLM budget_duration). */
  budgetDuration?: string | null;
}

export interface KeyValidation {
  ok: boolean;
  errors: string[];
}

/** Validate operator key input. PURE. Budgets/limits must be non-negative finite numbers or unset. */
export function validateKeyInput(input: KeyInput): KeyValidation {
  const errors: string[] = [];
  const nonNeg = (v: number | null | undefined, name: string): void => {
    if (v === null || v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      errors.push(`${name} must be a non-negative number`);
    }
  };
  nonNeg(input.maxBudget, 'maxBudget');
  nonNeg(input.rpmLimit, 'rpmLimit');
  nonNeg(input.tpmLimit, 'tpmLimit');
  if (input.keyAlias !== undefined && input.keyAlias !== null && typeof input.keyAlias !== 'string') {
    errors.push('keyAlias must be a string');
  }
  if (input.models !== undefined && !Array.isArray(input.models)) {
    errors.push('models must be an array');
  }
  return { ok: errors.length === 0, errors };
}

/** Only include a field when it was actually provided, so /key/update never nulls an unspecified one. */
function put(body: Record<string, unknown>, key: string, v: unknown): void {
  if (v !== undefined) body[key] = v;
}

/** Build the /key/generate request body (snake_case) from validated input. PURE. */
export function buildKeyGenerateBody(input: KeyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  put(body, 'key_alias', input.keyAlias ?? undefined);
  put(body, 'max_budget', input.maxBudget ?? undefined);
  put(body, 'rpm_limit', input.rpmLimit ?? undefined);
  put(body, 'tpm_limit', input.tpmLimit ?? undefined);
  put(body, 'budget_duration', input.budgetDuration ?? undefined);
  if (input.models && input.models.length > 0) body.models = input.models;
  return body;
}

/** Build the /key/update body — includes the target key + only the changed fields. PURE. */
export function buildKeyUpdateBody(key: string, input: KeyInput): Record<string, unknown> {
  const body = buildKeyGenerateBody(input);
  body.key = key;
  return body;
}

export interface KeyView {
  /** The key token (already masked by LiteLLM's /key/list as sk-…abcd). */
  token: string;
  keyAlias: string | null;
  spend: number;
  maxBudget: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  models: string[];
  /** true ⇒ spend has reached/exceeded the budget ceiling. */
  overBudget: boolean;
  /** 0..100 budget utilization, or null when unbounded. */
  budgetPct: number | null;
}

interface RawKeyRow {
  token?: string;
  key_name?: string;
  key_alias?: string | null;
  spend?: number;
  max_budget?: number | null;
  rpm_limit?: number | null;
  tpm_limit?: number | null;
  models?: unknown;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** Shape one /key/list row → the console view (defensive). PURE. */
export function shapeKeyRow(raw: RawKeyRow): KeyView {
  const spend = num(raw.spend) ?? 0;
  const maxBudget = num(raw.max_budget);
  return {
    token: raw.token ?? raw.key_name ?? '—',
    keyAlias: raw.key_alias ?? null,
    spend,
    maxBudget,
    rpmLimit: num(raw.rpm_limit),
    tpmLimit: num(raw.tpm_limit),
    models: Array.isArray(raw.models) ? raw.models.filter((m): m is string => typeof m === 'string') : [],
    overBudget: maxBudget !== null && maxBudget > 0 && spend >= maxBudget,
    budgetPct: maxBudget !== null && maxBudget > 0 ? Math.round((spend / maxBudget) * 100) : null,
  };
}

/** Shape a /key/list response (array or {keys:[…]}) → view rows. PURE. */
export function shapeKeyList(raw: unknown): KeyView[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { keys?: unknown[] })?.keys)
      ? (raw as { keys: unknown[] }).keys
      : [];
  return rows
    .filter((r): r is RawKeyRow => !!r && typeof r === 'object')
    .map(shapeKeyRow);
}
