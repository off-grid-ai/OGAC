// Presidio custom recognizers + deny lists + per-entity thresholds — the DEEP guardrails layer.
//
// SOLID seam: everything above the "Thin adapter (I/O)" divider is PURE and dependency-free (no
// Next / auth / DB / aliases) so it unit-tests in isolation with no mocks — the same seam as
// tenancy-policy.ts and guardrails-rules.ts. Two pure jobs live here:
//
//   1. validateRecognizer — a loose caller draft → a normalized, storable custom recognizer
//      (a regex-pattern recognizer OR a deny-list recognizer, both org-scoped in the console DB).
//   2. buildAnalyzeRequest / recognizerToAdHoc / applyThresholds — translate stored recognizers +
//      thresholds into a Presidio `/analyze` request body (using Presidio's `ad_hoc_recognizers`,
//      which take effect per-request with NO server-side Presidio config) and filter the analyzer's
//      results by a global and/or per-entity `score_threshold`.
//
// The I/O (the idempotent table ensure + the CRUD queries) is the thin adapter at the bottom,
// keyed off `@/db`, created idempotently on first use so it deploys over SSH with no migration step.

// ─── Pure policy (zero-import, unit-testable) ───────────────────────────────

// A custom recognizer is either a `pattern` recognizer (regex + optional context words that boost
// score when they appear nearby) or a `deny_list` recognizer (a fixed set of literal terms). Both
// map onto Presidio's PatternRecognizer via `ad_hoc_recognizers`.
export const RECOGNIZER_KINDS = ['pattern', 'deny_list'] as const;
export type RecognizerKind = (typeof RECOGNIZER_KINDS)[number];

export interface CustomRecognizer {
  id: string;
  kind: RecognizerKind;
  // The Presidio entity type this recognizer emits (UPPER_SNAKE, e.g. EMPLOYEE_ID).
  entity: string;
  name: string; // operator-facing recognizer name
  // For 'pattern': the regex source. For 'deny_list': ignored (terms carry the match).
  regex: string;
  // For 'pattern': context words that raise confidence when found near a match.
  context: string[];
  // For 'deny_list': the literal terms to flag.
  denyList: string[];
  // Confidence score assigned to a raw pattern/deny-list hit (0..1). Presidio default is 0.5–0.85.
  score: number;
  enabled: boolean;
  createdAt: string;
}

export interface RecognizerDraft {
  kind?: unknown;
  entity?: unknown;
  name?: unknown;
  regex?: unknown;
  context?: unknown;
  denyList?: unknown;
  score?: unknown;
  enabled?: unknown;
}

export interface NormalizedRecognizer {
  kind: RecognizerKind;
  entity: string;
  name: string;
  regex: string;
  context: string[];
  denyList: string[];
  score: number;
  enabled: boolean;
}

export type ValidationResult =
  | { ok: true; value: NormalizedRecognizer }
  | { ok: false; error: string };

function isKind(v: unknown): v is RecognizerKind {
  return typeof v === 'string' && (RECOGNIZER_KINDS as readonly string[]).includes(v);
}

// Verify a regex compiles — a bad pattern would otherwise throw at analyze time. Null when valid.
export function regexError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'invalid regular expression';
  }
}

// Parse a loose "list of strings" input — accepts a real array or a comma/newline-separated string
// (what a textarea/CSV field yields). Trims, drops blanks, dedupes, caps length so a malformed body
// can't balloon the payload.
export function parseStringList(v: unknown, cap = 100): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

// A score in [0,1]; falls back to a sensible default when absent/out-of-range.
export function clampScore(v: unknown, fallback = 0.6): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Pure validation + normalization of a recognizer draft. Never throws.
//  - entity is normalized to UPPER_SNAKE (Presidio entity catalog convention).
//  - 'pattern' requires a compilable regex; context words are optional.
//  - 'deny_list' requires at least one term; the regex field is cleared.
export function validateRecognizer(draft: RecognizerDraft | null | undefined): ValidationResult {
  const d = draft && typeof draft === 'object' ? draft : {};

  if (!isKind(d.kind)) {
    return { ok: false, error: `kind must be one of ${RECOGNIZER_KINDS.join(' | ')}` };
  }

  const rawEntity = typeof d.entity === 'string' ? d.entity.trim().toUpperCase() : '';
  if (!rawEntity) return { ok: false, error: 'entity is required' };
  if (!/^[A-Z][A-Z0-9_]*$/.test(rawEntity)) {
    return { ok: false, error: 'entity must be UPPER_SNAKE (e.g. EMPLOYEE_ID)' };
  }

  const name =
    typeof d.name === 'string' && d.name.trim()
      ? d.name.trim().slice(0, 120)
      : `${rawEntity.toLowerCase()}_recognizer`;

  const context = parseStringList(d.context);
  const score = clampScore(d.score);
  const enabled = d.enabled === undefined ? true : d.enabled !== false;

  if (d.kind === 'pattern') {
    const regex = typeof d.regex === 'string' ? d.regex.trim() : '';
    if (!regex) return { ok: false, error: 'regex is required for a pattern recognizer' };
    const err = regexError(regex);
    if (err) return { ok: false, error: `invalid regex: ${err}` };
    return {
      ok: true,
      value: { kind: 'pattern', entity: rawEntity, name, regex, context, denyList: [], score, enabled },
    };
  }

  // deny_list
  const denyList = parseStringList(d.denyList);
  if (denyList.length === 0) {
    return { ok: false, error: 'at least one term is required for a deny-list recognizer' };
  }
  return {
    ok: true,
    value: { kind: 'deny_list', entity: rawEntity, name, regex: '', context, denyList, score, enabled },
  };
}

// ─── Threshold policy (pure) ────────────────────────────────────────────────

export interface ThresholdConfig {
  // Applies when no per-entity threshold covers a given entity type. Presidio accepts this as the
  // request-level `score_threshold`; we ALSO enforce it locally so filtering is correct even if the
  // service ignores it.
  global: number;
  // Per-entity overrides, keyed by UPPER_SNAKE entity type → minimum score.
  perEntity: Record<string, number>;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = { global: 0, perEntity: {} };

// Normalize a loose thresholds draft (from a JSON body or a persisted blob). Never throws.
export function normalizeThresholds(raw: unknown): ThresholdConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const global = clampScore(o.global, 0);
  const perEntity: Record<string, number> = {};
  const pe =
    o.perEntity && typeof o.perEntity === 'object' ? (o.perEntity as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(pe)) {
    const key = k.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    perEntity[key] = clampScore(v, 0);
  }
  return { global, perEntity };
}

// The effective minimum score for an entity type: its per-entity override, else the global floor.
export function thresholdFor(cfg: ThresholdConfig, entity: string): number {
  const key = entity.toUpperCase();
  return key in cfg.perEntity ? cfg.perEntity[key] : cfg.global;
}

export interface AnalyzedEntity {
  entity_type: string;
  start: number;
  end: number;
  score?: number;
}

// Drop analyzer results that fall below the effective threshold for their entity type. Results
// with no score are kept (the analyzer is asserting a hit with no confidence to compare).
export function applyThresholds<T extends AnalyzedEntity>(results: T[], cfg: ThresholdConfig): T[] {
  return results.filter((r) => {
    if (typeof r.score !== 'number') return true;
    return r.score >= thresholdFor(cfg, r.entity_type);
  });
}

// ─── Presidio /analyze payload builder (pure) ───────────────────────────────

// A Presidio PatternRecognizer, the shape `ad_hoc_recognizers` expects. Fields mirror
// presidio-analyzer's PatternRecognizer.to_dict(): a `pattern` recognizer carries `patterns`
// [{ name, regex, score }] and optional `context`; a `deny_list` recognizer carries `deny_list`.
export interface AdHocRecognizer {
  name: string;
  supported_entity: string;
  supported_language: string;
  patterns?: { name: string; regex: string; score: number }[];
  deny_list?: string[];
  context?: string[];
}

// One stored recognizer → the Presidio ad-hoc recognizer dict. Disabled recognizers should be
// filtered out by the caller (buildAnalyzeRequest does this).
export function recognizerToAdHoc(r: NormalizedRecognizer, language = 'en'): AdHocRecognizer {
  const base = {
    name: r.name,
    supported_entity: r.entity,
    supported_language: language,
    ...(r.context.length ? { context: r.context } : {}),
  };
  if (r.kind === 'deny_list') {
    return { ...base, deny_list: r.denyList };
  }
  return {
    ...base,
    patterns: [{ name: `${r.name}_pattern`, regex: r.regex, score: r.score }],
  };
}

export interface AnalyzeRequest {
  text: string;
  language: string;
  ad_hoc_recognizers?: AdHocRecognizer[];
  score_threshold?: number;
}

// ─── Default recognizer set — Indian BFSI (G-F2) ─────────────────────────────
// Presidio ships built-in IN_PAN / IN_AADHAAR recognizers, but they're only active if the analyzer
// is configured to load them server-side — and there is NO built-in for IFSC or UPI. Rather than
// depend on the server config, we always ship these as `ad_hoc_recognizers` on every /analyze call.
// Ad-hoc recognizers are ADDITIVE (they don't disable Presidio's own), so if the built-ins ARE
// enabled the duplicate entity types simply merge — no harm — and if they're NOT, this is the only
// thing that detects them. Patterns mirror the regex floor in pii-regex.ts so both paths agree.
//
// The scores are deliberately high (0.85) because each pattern is format-anchored and low-FP; the
// `context` words nudge confidence higher when the surrounding text confirms the entity, and they
// let per-entity thresholds treat these like any other recognizer.
export const DEFAULT_RECOGNIZERS: NormalizedRecognizer[] = [
  {
    kind: 'pattern',
    entity: 'IN_PAN',
    name: 'in_pan_default',
    regex: '\\b[A-Z]{5}[0-9]{4}[A-Z]\\b',
    context: ['pan', 'permanent account number', 'income tax'],
    denyList: [],
    score: 0.85,
    enabled: true,
  },
  {
    kind: 'pattern',
    entity: 'IN_AADHAAR',
    name: 'in_aadhaar_default',
    // 4-4-4 (spaced/hyphenated) OR a bare 12-digit run; leading digit 2–9 as UIDAI issues.
    regex: '\\b[2-9][0-9]{3}[ -][0-9]{4}[ -][0-9]{4}\\b|\\b[2-9][0-9]{11}\\b',
    context: ['aadhaar', 'aadhar', 'uidai', 'uid'],
    denyList: [],
    score: 0.85,
    enabled: true,
  },
  {
    kind: 'pattern',
    entity: 'IN_IFSC',
    name: 'in_ifsc_default',
    regex: '\\b[A-Z]{4}0[A-Z0-9]{6}\\b',
    context: ['ifsc', 'branch', 'neft', 'rtgs', 'imps'],
    denyList: [],
    score: 0.85,
    enabled: true,
  },
  {
    kind: 'pattern',
    entity: 'UPI_ID',
    // PSP part is letters-only (no dot) so real emails aren't captured as UPI.
    name: 'upi_id_default',
    regex: '\\b[a-zA-Z0-9](?:[a-zA-Z0-9.\\-_]*[a-zA-Z0-9])?@[a-zA-Z]{2,}\\b',
    context: ['upi', 'vpa', 'virtual payment address', 'collect'],
    denyList: [],
    score: 0.8,
    enabled: true,
  },
];

// Merge the always-on default set with the org's stored recognizers. A stored recognizer that
// covers the same entity type WINS (the operator's tuning overrides our default), so an org can
// relax/replace a default by defining its own recognizer for that entity.
export function mergeWithDefaults(stored: NormalizedRecognizer[]): NormalizedRecognizer[] {
  const storedEntities = new Set(stored.map((r) => r.entity.toUpperCase()));
  const defaults = DEFAULT_RECOGNIZERS.filter((d) => !storedEntities.has(d.entity.toUpperCase()));
  return [...defaults, ...stored];
}

// Build the full `/analyze` request body: the text, the enabled custom recognizers translated to
// ad-hoc recognizers, and the global threshold as Presidio's request-level `score_threshold`.
// Per-entity thresholds can't ride in the request body (Presidio has no per-entity request knob),
// so they're enforced locally via applyThresholds after the response — the global floor is sent so
// the service can prune early too. Pure: same inputs → same body, no I/O.
export function buildAnalyzeRequest(
  text: string,
  recognizers: NormalizedRecognizer[],
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS,
  language = 'en',
): AnalyzeRequest {
  // Always fold in the Indian-BFSI default recognizers (PAN/Aadhaar/IFSC/UPI) so the Presidio path
  // detects them even when the server has no built-ins and the org has stored none. A stored
  // recognizer for the same entity overrides the default (see mergeWithDefaults).
  const enabled = mergeWithDefaults(recognizers).filter((r) => r.enabled);
  const req: AnalyzeRequest = { text, language };
  if (enabled.length) {
    req.ad_hoc_recognizers = enabled.map((r) => recognizerToAdHoc(r, language));
  }
  if (thresholds.global > 0) {
    req.score_threshold = thresholds.global;
  }
  return req;
}

// ─── Thin adapter (I/O) ─────────────────────────────────────────────────────

// Lazily imported so the pure exports above stay free of DB/runtime deps for the unit tests.
let ensurePromise: Promise<void> | null = null;
export async function ensureRecognizersSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    // Custom recognizers (regex/deny-list), org-scoped. Lists stored as JSONB.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS presidio_recognizers (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        kind text NOT NULL,
        entity text NOT NULL,
        name text NOT NULL DEFAULT '',
        regex text NOT NULL DEFAULT '',
        context jsonb NOT NULL DEFAULT '[]'::jsonb,
        deny_list jsonb NOT NULL DEFAULT '[]'::jsonb,
        score double precision NOT NULL DEFAULT 0.6,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    // Per-org threshold config — a single row per org holding the global floor + per-entity blob.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS presidio_thresholds (
        org_id text PRIMARY KEY,
        global_threshold double precision NOT NULL DEFAULT 0,
        per_entity jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface RecognizerRow {
  id: string;
  kind: string;
  entity: string;
  name: string;
  regex: string;
  context: unknown;
  deny_list: unknown;
  score: number | string;
  enabled: boolean;
  created_at: Date | string;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToRecognizer(r: RecognizerRow): CustomRecognizer {
  return {
    id: r.id,
    kind: (RECOGNIZER_KINDS as readonly string[]).includes(r.kind)
      ? (r.kind as RecognizerKind)
      : 'pattern',
    entity: r.entity,
    name: r.name ?? '',
    regex: r.regex ?? '',
    context: asStringArray(r.context),
    denyList: asStringArray(r.deny_list),
    score: typeof r.score === 'number' ? r.score : Number(r.score) || 0.6,
    enabled: r.enabled === true,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function listRecognizers(orgId = 'default'): Promise<CustomRecognizer[]> {
  await ensureRecognizersSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    SELECT id, kind, entity, name, regex, context, deny_list, score, enabled, created_at
    FROM presidio_recognizers WHERE org_id = ${orgId} ORDER BY created_at DESC;
  `);
  return (res.rows as unknown as RecognizerRow[]).map(rowToRecognizer);
}

export async function createRecognizer(
  value: NormalizedRecognizer,
  orgId = 'default',
): Promise<CustomRecognizer> {
  await ensureRecognizersSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const { randomUUID } = await import('crypto');
  const id = `rec_${randomUUID().slice(0, 8)}`;
  const res = await db.execute(sql`
    INSERT INTO presidio_recognizers (id, org_id, kind, entity, name, regex, context, deny_list, score, enabled)
    VALUES (${id}, ${orgId}, ${value.kind}, ${value.entity}, ${value.name}, ${value.regex},
            ${JSON.stringify(value.context)}::jsonb, ${JSON.stringify(value.denyList)}::jsonb,
            ${value.score}, ${value.enabled})
    RETURNING id, kind, entity, name, regex, context, deny_list, score, enabled, created_at;
  `);
  return rowToRecognizer((res.rows as unknown as RecognizerRow[])[0]);
}

export async function updateRecognizer(
  id: string,
  value: NormalizedRecognizer,
  orgId = 'default',
): Promise<CustomRecognizer | null> {
  await ensureRecognizersSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    UPDATE presidio_recognizers
    SET kind = ${value.kind}, entity = ${value.entity}, name = ${value.name}, regex = ${value.regex},
        context = ${JSON.stringify(value.context)}::jsonb, deny_list = ${JSON.stringify(value.denyList)}::jsonb,
        score = ${value.score}, enabled = ${value.enabled}
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id, kind, entity, name, regex, context, deny_list, score, enabled, created_at;
  `);
  const rows = res.rows as unknown as RecognizerRow[];
  return rows.length ? rowToRecognizer(rows[0]) : null;
}

export async function setRecognizerEnabled(
  id: string,
  enabled: boolean,
  orgId = 'default',
): Promise<CustomRecognizer | null> {
  await ensureRecognizersSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    UPDATE presidio_recognizers SET enabled = ${enabled}
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id, kind, entity, name, regex, context, deny_list, score, enabled, created_at;
  `);
  const rows = res.rows as unknown as RecognizerRow[];
  return rows.length ? rowToRecognizer(rows[0]) : null;
}

export async function deleteRecognizer(id: string, orgId = 'default'): Promise<boolean> {
  await ensureRecognizersSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    DELETE FROM presidio_recognizers WHERE id = ${id} AND org_id = ${orgId} RETURNING id;
  `);
  return (res.rows as unknown[]).length > 0;
}

// ─── Thresholds I/O ─────────────────────────────────────────────────────────

interface ThresholdRow {
  global_threshold: number | string;
  per_entity: unknown;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export async function getThresholds(orgId = 'default'): Promise<ThresholdConfig> {
  await ensureRecognizersSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    SELECT global_threshold, per_entity FROM presidio_thresholds WHERE org_id = ${orgId};
  `);
  const rows = res.rows as unknown as ThresholdRow[];
  if (!rows.length) return DEFAULT_THRESHOLDS;
  const pe = typeof rows[0].per_entity === 'string' ? safeParse(rows[0].per_entity) : rows[0].per_entity;
  return normalizeThresholds({ global: rows[0].global_threshold, perEntity: pe });
}

// Upsert the org's threshold config. Returns the normalized, persisted config.
export async function setThresholds(raw: unknown, orgId = 'default'): Promise<ThresholdConfig> {
  await ensureRecognizersSchema();
  const cfg = normalizeThresholds(raw);
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    INSERT INTO presidio_thresholds (org_id, global_threshold, per_entity, updated_at)
    VALUES (${orgId}, ${cfg.global}, ${JSON.stringify(cfg.perEntity)}::jsonb, now())
    ON CONFLICT (org_id) DO UPDATE
      SET global_threshold = ${cfg.global}, per_entity = ${JSON.stringify(cfg.perEntity)}::jsonb, updated_at = now();
  `);
  return cfg;
}
