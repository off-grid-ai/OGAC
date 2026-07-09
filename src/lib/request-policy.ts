// ─── PURE first-party REQUEST-POLICY rules — ZERO imports of db/IO, exhaustively unit-testable ──────
//
// Two deterministic, in-path pre-checks that gate a model call BEFORE it leaves the box. Unlike the
// ML guardrails (Presidio / LLM Guard, which classify FREE TEXT), these are config checks over the
// request's STRUCTURE — the numeric/string request parameters and the resolved model id. They are
// cheap, deterministic, and never touch the network, so they run first and cannot fail-open silently.
//
// They compose the SAME pipeline contract the egress leash uses (pipeline-enforcement.ts), read from
// two NEW optional slices on the contract:
//   • requestParamsPolicy — max_tokens ceiling, temperature/top_p bounds, a banned-params list;
//   • modelRules          — an allowlist / denylist the resolved model must satisfy.
// Both are OPTIONAL: an absent slice ⇒ the check is a no-op PASS (the ADDITIVE guarantee — a pipeline
// that never configured params/model rules behaves exactly as before). This module owns NO I/O; the
// thin run path (pipeline-execute.ts / the run route) calls these and enforces the verdict + audit.
//
// SOLID: this is the decision layer only. It NEVER re-implements the egress leash / overlay merge
// (that stays in pipeline-enforcement.ts) — it is a DISJOINT slice of the same contract.

// ─── the two policy slices (a DB-free snapshot the resolver hands in) ───────────────────────────────

/** Ceilings + bounds a pipeline imposes on the request's model parameters. All fields OPTIONAL. */
export interface RequestParamsPolicy {
  /** Hard ceiling on max_tokens. A request above it is CLAMPED down to the ceiling (never blocked). */
  maxTokensCeiling?: number;
  /** Inclusive [min,max] the request's `temperature` must fall within. Out of range ⇒ BLOCK. */
  temperatureRange?: { min: number; max: number };
  /** Inclusive [min,max] the request's `top_p` must fall within. Out of range ⇒ BLOCK. */
  topPRange?: { min: number; max: number };
  /** Parameter names the pipeline forbids entirely (e.g. `logprobs`, `n`). Present ⇒ BLOCK. */
  bannedParams?: string[];
}

/** A pipeline's model allowlist / denylist. Both OPTIONAL; denylist wins over allowlist. */
export interface ModelRules {
  /** If non-empty, the resolved model MUST be one of these (case-insensitive). Else BLOCK. */
  allowlist?: string[];
  /** If the resolved model is in here (case-insensitive) it is BLOCKED, even if allowlisted. */
  denylist?: string[];
}

// ─── verdicts ──────────────────────────────────────────────────────────────────────────────────────

/** Verdict for the request-parameters check. */
export interface RequestParamsVerdict {
  /** true ⇒ the call may proceed (possibly with clamped params); false ⇒ it is BLOCKED. */
  allow: boolean;
  /**
   * The parameters AFTER clamping — the run path should send THESE to the gateway, not the raw ones.
   * Only keys that were present on the input appear here; a clamped value is the ceiling.
   */
  params: Record<string, unknown>;
  /** The params that were clamped (name → {from,to}) — for the audit trail. */
  clamped: { param: string; from: number; to: number }[];
  /** Human reason (for the governed error + audit detail). */
  reason: string;
  /** true when NO params policy was configured → no-op pass (legacy behaviour). */
  noPolicy: boolean;
}

/** Verdict for the model-rules check. */
export interface ModelRulesVerdict {
  /** true ⇒ the resolved model is permitted; false ⇒ BLOCKED (denylisted or not on the allowlist). */
  allow: boolean;
  /** The model that was evaluated, echoed for the audit trail. */
  model: string;
  /** Human reason (for the governed error + audit detail). */
  reason: string;
  /** true when NO model rules were configured → no-op pass (legacy behaviour). */
  noRules: boolean;
}

// ─── helpers (pure) ──────────────────────────────────────────────────────────────────────────────────

/** A finite number, or undefined. Rejects NaN/Infinity/strings so a garbage param can't slip through. */
function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Case-insensitive membership over a trimmed string list. Empty/absent list ⇒ false. */
function includesCI(list: readonly string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return false;
  const needle = value.trim().toLowerCase();
  return list.some((x) => x.trim().toLowerCase() === needle);
}

/** True when a range is a sane, ordered [min,max] pair of finite numbers. */
function validRange(
  r: { min: number; max: number } | undefined,
): r is { min: number; max: number } {
  return !!r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.min <= r.max;
}

// ─── 1. Request Parameters Check ─────────────────────────────────────────────────────────────────────

/**
 * Validate (and where policy allows, CLAMP) a request's model parameters against the pipeline policy.
 * PURE. The decision matrix, in order:
 *   • banned param PRESENT on the request ⇒ BLOCK (an explicit forbidden knob was set).
 *   • temperature / top_p OUT OF RANGE ⇒ BLOCK (a hard bound the operator set; we don't silently
 *     rewrite a safety-relevant sampling parameter — we refuse so the caller learns).
 *   • max_tokens ABOVE the ceiling ⇒ CLAMP down to the ceiling (a cost/latency guard the operator
 *     wants enforced transparently, not a refusal) and ALLOW.
 * `params` is the caller-supplied request params (a plain object). The returned `params` is the
 * effective set the run path must forward (with max_tokens clamped when it applied). A null/absent
 * policy is a no-op PASS echoing the input params unchanged (additive).
 */
export function checkRequestParams(
  policy: RequestParamsPolicy | null | undefined,
  params: Record<string, unknown>,
): RequestParamsVerdict {
  const input = params && typeof params === 'object' ? params : {};
  if (!policy) {
    return {
      allow: true,
      params: { ...input },
      clamped: [],
      reason: 'no request-parameter policy configured — parameters pass unchanged',
      noPolicy: true,
    };
  }

  // (a) banned parameters — an explicitly forbidden knob present on the request is a hard block.
  const banned = (policy.bannedParams ?? []).map((p) => p.trim()).filter(Boolean);
  const bannedHit = banned.find((p) => Object.prototype.hasOwnProperty.call(input, p));
  if (bannedHit) {
    return {
      allow: false,
      params: { ...input },
      clamped: [],
      reason: `request sets banned parameter "${bannedHit}" — denied by pipeline policy`,
      noPolicy: false,
    };
  }

  // (b) temperature / top_p bounds — out of range is a hard block (don't silently rewrite sampling).
  const temp = asFiniteNumber(input.temperature);
  if (validRange(policy.temperatureRange) && temp !== undefined) {
    const { min, max } = policy.temperatureRange;
    if (temp < min || temp > max) {
      return {
        allow: false,
        params: { ...input },
        clamped: [],
        reason: `temperature ${temp} is outside the allowed range [${min}, ${max}] — denied`,
        noPolicy: false,
      };
    }
  }
  const topP = asFiniteNumber(input.top_p);
  if (validRange(policy.topPRange) && topP !== undefined) {
    const { min, max } = policy.topPRange;
    if (topP < min || topP > max) {
      return {
        allow: false,
        params: { ...input },
        clamped: [],
        reason: `top_p ${topP} is outside the allowed range [${min}, ${max}] — denied`,
        noPolicy: false,
      };
    }
  }

  // (c) max_tokens ceiling — CLAMP (transparent cost guard), never block.
  const out: Record<string, unknown> = { ...input };
  const clamped: { param: string; from: number; to: number }[] = [];
  const ceiling = asFiniteNumber(policy.maxTokensCeiling);
  const maxTokens = asFiniteNumber(input.max_tokens);
  if (ceiling !== undefined && ceiling >= 0 && maxTokens !== undefined && maxTokens > ceiling) {
    out.max_tokens = ceiling;
    clamped.push({ param: 'max_tokens', from: maxTokens, to: ceiling });
  }

  return {
    allow: true,
    params: out,
    clamped,
    reason: clamped.length
      ? `parameters accepted; clamped ${clamped
          .map((c) => `${c.param} ${c.from}→${c.to}`)
          .join(', ')}`
      : 'parameters within policy',
    noPolicy: false,
  };
}

// ─── 2. Model Rules ────────────────────────────────────────────────────────────────────────────────

/**
 * Enforce a pipeline's model allowlist / denylist against the RESOLVED model. PURE, deny-overrides:
 *   • denylisted model ⇒ BLOCK (even if it is also on the allowlist — denylist wins).
 *   • a NON-EMPTY allowlist that does NOT contain the model ⇒ BLOCK.
 *   • otherwise ALLOW.
 * Comparison is case-insensitive + trimmed. Absent/empty rules ⇒ no-op PASS (additive). An empty
 * resolved model id is a BLOCK when any rule is configured (nothing to authorize).
 */
export function checkModelRules(
  rules: ModelRules | null | undefined,
  model: string,
): ModelRulesVerdict {
  const m = (model ?? '').trim();
  const hasAllow = !!rules?.allowlist && rules.allowlist.length > 0;
  const hasDeny = !!rules?.denylist && rules.denylist.length > 0;

  if (!rules || (!hasAllow && !hasDeny)) {
    return { allow: true, model: m, reason: 'no model rules configured', noRules: true };
  }

  if (!m) {
    return {
      allow: false,
      model: m,
      reason: 'no model resolved for the call — denied by pipeline model rules',
      noRules: false,
    };
  }

  if (includesCI(rules.denylist, m)) {
    return {
      allow: false,
      model: m,
      reason: `model "${m}" is denylisted by the pipeline`,
      noRules: false,
    };
  }

  if (hasAllow && !includesCI(rules.allowlist, m)) {
    return {
      allow: false,
      model: m,
      reason: `model "${m}" is not on the pipeline allowlist`,
      noRules: false,
    };
  }

  return {
    allow: true,
    model: m,
    reason: `model "${m}" is permitted by the pipeline model rules`,
    noRules: false,
  };
}

// ─── composition — the single pre-check the run path calls ───────────────────────────────────────────

/** The combined first-party request pre-check verdict. */
export interface RequestPreCheck {
  /** true ⇒ both checks passed; false ⇒ at least one BLOCKED the call. */
  allow: boolean;
  params: RequestParamsVerdict;
  modelRules: ModelRulesVerdict;
  /** The first blocking reason (params first, then model), or a combined ok reason. */
  reason: string;
}

/**
 * Run BOTH deterministic pre-checks and fold them into one verdict. PURE. Params are checked first
 * (they gate the request shape), then the resolved model. `allow` is the AND of both. The effective
 * (clamped) params live on `params.params` for the run path to forward.
 */
export function checkRequestPolicy(
  paramsPolicy: RequestParamsPolicy | null | undefined,
  modelRules: ModelRules | null | undefined,
  params: Record<string, unknown>,
  model: string,
): RequestPreCheck {
  const p = checkRequestParams(paramsPolicy, params);
  const mr = checkModelRules(modelRules, model);
  const allow = p.allow && mr.allow;
  const reason = !p.allow ? p.reason : !mr.allow ? mr.reason : `${p.reason}; ${mr.reason}`;
  return { allow, params: p, modelRules: mr, reason };
}

// ─── parsers — read the two slices out of a stored overlay JSON blob (PURE) ──────────────────────────
//
// The console stores per-pipeline governance as loosely-typed JSON overlays. These parsers narrow the
// relevant keys into the strongly-typed slices ABOVE, tolerating any missing/garbage shape (→ undefined,
// which the checks treat as a no-op pass). Keeping the parse PURE + unit-tested means the I/O resolver
// (pipeline-contract.ts) stays a thin "load blob → parse → attach" bridge with no logic of its own.

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return list.length > 0 ? list : undefined;
}

function rangeOrUndef(v: unknown): { min: number; max: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { min?: unknown; max?: unknown };
  const min = numOrUndef(o.min);
  const max = numOrUndef(o.max);
  if (min === undefined || max === undefined || min > max) return undefined;
  return { min, max };
}

/**
 * Parse a `requestParams` slice out of an overlay blob. Recognizes `maxTokensCeiling`,
 * `temperatureRange {min,max}`, `topPRange {min,max}`, `bannedParams: string[]`. Returns undefined
 * when NONE of them are present/valid (so the check no-ops). PURE.
 */
export function parseRequestParamsPolicy(raw: unknown): RequestParamsPolicy | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const policy: RequestParamsPolicy = {};
  const maxTokensCeiling = numOrUndef(o.maxTokensCeiling);
  if (maxTokensCeiling !== undefined) policy.maxTokensCeiling = maxTokensCeiling;
  const temperatureRange = rangeOrUndef(o.temperatureRange);
  if (temperatureRange) policy.temperatureRange = temperatureRange;
  const topPRange = rangeOrUndef(o.topPRange);
  if (topPRange) policy.topPRange = topPRange;
  const bannedParams = stringList(o.bannedParams);
  if (bannedParams) policy.bannedParams = bannedParams;
  return Object.keys(policy).length > 0 ? policy : undefined;
}

/**
 * Parse a `modelRules` slice out of an overlay blob. Recognizes `allowlist: string[]` +
 * `denylist: string[]`. Returns undefined when neither is present (so the check no-ops). PURE.
 */
export function parseModelRules(raw: unknown): ModelRules | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const allowlist = stringList(o.allowlist);
  const denylist = stringList(o.denylist);
  if (!allowlist && !denylist) return undefined;
  const rules: ModelRules = {};
  if (allowlist) rules.allowlist = allowlist;
  if (denylist) rules.denylist = denylist;
  return rules;
}
