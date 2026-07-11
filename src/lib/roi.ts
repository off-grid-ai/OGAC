// ─── ROI calc (SURFACED ROI) — PURE, zero-IO ─────────────────────────────────────────────────────
//
// The renewal + internal-budget-justification lever. It answers, per app and per department:
// "this automation saved X hours / $Y this period, at Z actual AI cost → net $N."
//
// The model is deliberately SIMPLE and HONEST — no faked precision:
//   hoursSaved = runsCompleted × (minutesSavedPerRun / 60)          ← an ESTIMATE
//   grossValue = hoursSaved × loadedCostPerHour                     ← an ESTIMATE ($)
//   netValue   = grossValue − actualAiCost                          ← est. value MINUS actual cost
//
// `runsCompleted` and `actualAiCost` are REAL (run counts from app_runs; cost from the gateway/FinOps
// pricing). `minutesSavedPerRun` and `loadedCostPerHour` are per-app/org ESTIMATES the creator sets —
// the UI labels them as such. Every input is sanitised (non-finite/negative → 0) so a missing estimate
// or a zero-run app yields honest zeros, never NaN/Infinity.
//
// This is the ONE place the ROI arithmetic lives (DRY): the per-app card, the department rollup, and
// any future export all call these functions. No React, no fetch, no env — unit-testable in isolation.

// ─── defaults (sensible, editable, clearly an estimate in the UI) ────────────────────────────────
/** Default minutes saved per completed run when the creator hasn't set an estimate. Conservative. */
export const DEFAULT_MINUTES_SAVED_PER_RUN = 15;
/** Default fully-loaded cost per staff hour, in $ (USD) — a sensible knowledge-worker rate. */
export const DEFAULT_LOADED_COST_PER_HOUR = 75;

// ─── input / output shapes ───────────────────────────────────────────────────────────────────────
export interface RoiInput {
  /** Real count of completed runs in the period. */
  runsCompleted: number;
  /** ESTIMATE: minutes of manual work each completed run replaces. */
  minutesSavedPerRun: number;
  /** ESTIMATE: fully-loaded cost of one staff hour, in $. */
  loadedCostPerHour: number;
  /** REAL: the actual AI/gateway cost attributed to this app's runs this period, in $. */
  actualAiCost: number;
}

export interface RoiResult {
  /** Real runs counted (echoed back, sanitised). */
  runsCompleted: number;
  /** ESTIMATE: total hours of manual work saved. */
  hoursSaved: number;
  /** ESTIMATE: gross value of the time saved, in $ (hoursSaved × loadedCostPerHour). */
  grossValue: number;
  /** REAL: actual AI cost, in $ (echoed back, sanitised). */
  actualAiCost: number;
  /** est. gross value − actual AI cost, in $. Can be negative (cost outran estimated value). */
  netValue: number;
  /** grossValue / actualAiCost — the "×" multiple; null when there is no cost (avoid ÷0). */
  roiMultiple: number | null;
}

// A number that is finite and strictly positive; anything else (NaN, Infinity, ≤0, non-number) → 0.
// This is what makes zero/missing inputs honest zeros rather than NaN.
function clean(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── computeRoi — the master calc (pure) ─────────────────────────────────────────────────────────
// No runs (or no estimate) → hoursSaved/grossValue/netValue collapse toward zero honestly. netValue
// is NOT floored — a period where actual cost exceeds estimated value shows a real negative net.
export function computeRoi(input: RoiInput): RoiResult {
  const runsCompleted = Math.trunc(clean(input.runsCompleted));
  const minutesSavedPerRun = clean(input.minutesSavedPerRun);
  const loadedCostPerHour = clean(input.loadedCostPerHour);
  const actualAiCost = clean(input.actualAiCost);

  const hoursSaved = round2((runsCompleted * minutesSavedPerRun) / 60);
  const grossValue = round2(hoursSaved * loadedCostPerHour);
  const netValue = round2(grossValue - actualAiCost);
  const roiMultiple = actualAiCost > 0 ? round2(grossValue / actualAiCost) : null;

  return { runsCompleted, hoursSaved, grossValue, actualAiCost, netValue, roiMultiple };
}

// ─── per-app ROI settings (the two ESTIMATES a creator sets) ──────────────────────────────────────
// The org sets defaults; an app may override either. `resolveRoiSettings` applies the precedence:
// per-app override → org default → hard default. Pure so both the card and the rollup agree.
export interface RoiSettings {
  minutesSavedPerRun: number;
  loadedCostPerHour: number;
}

export interface RoiSettingsOverride {
  minutesSavedPerRun?: number | null;
  loadedCostPerHour?: number | null;
}

/** Resolve the effective estimates for an app: app override → org default → hard default. */
export function resolveRoiSettings(
  appOverride: RoiSettingsOverride | null | undefined,
  orgDefault: RoiSettingsOverride | null | undefined,
): RoiSettings {
  const pick = (
    a: number | null | undefined,
    b: number | null | undefined,
    fallback: number,
  ): number => {
    const av = clean(a);
    if (av > 0) return av;
    const bv = clean(b);
    if (bv > 0) return bv;
    return fallback;
  };
  return {
    minutesSavedPerRun: pick(
      appOverride?.minutesSavedPerRun,
      orgDefault?.minutesSavedPerRun,
      DEFAULT_MINUTES_SAVED_PER_RUN,
    ),
    loadedCostPerHour: pick(
      appOverride?.loadedCostPerHour,
      orgDefault?.loadedCostPerHour,
      DEFAULT_LOADED_COST_PER_HOUR,
    ),
  };
}

// ─── per-app ROI row — one app's real counts + resolved estimates → its RoiResult ────────────────
export interface AppRoiInput {
  appId: string;
  appTitle: string;
  /** The department this app rolls up under (null ⇒ Unassigned). */
  department: string | null;
  runsCompleted: number;
  actualAiCost: number;
  settings: RoiSettings;
}

export interface AppRoi extends RoiResult {
  appId: string;
  appTitle: string;
  department: string;
  minutesSavedPerRun: number;
  loadedCostPerHour: number;
}

/** The display bucket for an app with no department. */
export const UNASSIGNED_ROI_DEPARTMENT = 'Unassigned';

/** Compute one app's ROI row from its real counts + resolved estimate settings. */
export function computeAppRoi(input: AppRoiInput): AppRoi {
  const roi = computeRoi({
    runsCompleted: input.runsCompleted,
    minutesSavedPerRun: input.settings.minutesSavedPerRun,
    loadedCostPerHour: input.settings.loadedCostPerHour,
    actualAiCost: input.actualAiCost,
  });
  const dept = (input.department ?? '').trim() || UNASSIGNED_ROI_DEPARTMENT;
  return {
    ...roi,
    appId: input.appId,
    appTitle: input.appTitle,
    department: dept,
    minutesSavedPerRun: input.settings.minutesSavedPerRun,
    loadedCostPerHour: input.settings.loadedCostPerHour,
  };
}

// ─── department + org rollup ──────────────────────────────────────────────────────────────────────
export interface DepartmentRoi {
  department: string;
  appCount: number;
  runsCompleted: number;
  hoursSaved: number;
  grossValue: number;
  actualAiCost: number;
  netValue: number;
  roiMultiple: number | null;
  /** Apps in this department, richest (net value) first. */
  apps: AppRoi[];
}

export interface RoiRollup {
  totals: {
    appCount: number;
    runsCompleted: number;
    hoursSaved: number;
    grossValue: number;
    actualAiCost: number;
    netValue: number;
    roiMultiple: number | null;
  };
  /** Departments, richest (net value) first; the Unassigned bucket sorts last. */
  byDepartment: DepartmentRoi[];
  /** All app rows, richest (net value) first — feeds the "top apps by value" table. */
  topApps: AppRoi[];
}

// Roll a set of app-ROI rows up by department and to an org total. PURE — the sum of the parts equals
// the whole by construction (each field summed once). Ordering is value-forward: departments and apps
// sort by net value descending; the Unassigned department is pinned last regardless of value.
export function rollupRoi(apps: AppRoi[]): RoiRollup {
  const byDeptMap = new Map<string, AppRoi[]>();
  for (const a of apps) {
    const list = byDeptMap.get(a.department) ?? [];
    list.push(a);
    byDeptMap.set(a.department, list);
  }

  const byDepartment: DepartmentRoi[] = [...byDeptMap.entries()].map(([department, rows]) => {
    const sorted = [...rows].sort((x, y) => y.netValue - x.netValue);
    const runsCompleted = sum(sorted.map((r) => r.runsCompleted));
    const hoursSaved = round2(sum(sorted.map((r) => r.hoursSaved)));
    const grossValue = round2(sum(sorted.map((r) => r.grossValue)));
    const actualAiCost = round2(sum(sorted.map((r) => r.actualAiCost)));
    const netValue = round2(grossValue - actualAiCost);
    return {
      department,
      appCount: sorted.length,
      runsCompleted,
      hoursSaved,
      grossValue,
      actualAiCost,
      netValue,
      roiMultiple: actualAiCost > 0 ? round2(grossValue / actualAiCost) : null,
      apps: sorted,
    };
  });

  byDepartment.sort((x, y) => {
    // Unassigned pinned last.
    if (x.department === UNASSIGNED_ROI_DEPARTMENT && y.department !== UNASSIGNED_ROI_DEPARTMENT)
      return 1;
    if (y.department === UNASSIGNED_ROI_DEPARTMENT && x.department !== UNASSIGNED_ROI_DEPARTMENT)
      return -1;
    return y.netValue - x.netValue;
  });

  const grossValue = round2(sum(apps.map((a) => a.grossValue)));
  const actualAiCost = round2(sum(apps.map((a) => a.actualAiCost)));
  return {
    totals: {
      appCount: apps.length,
      runsCompleted: sum(apps.map((a) => a.runsCompleted)),
      hoursSaved: round2(sum(apps.map((a) => a.hoursSaved))),
      grossValue,
      actualAiCost,
      netValue: round2(grossValue - actualAiCost),
      roiMultiple: actualAiCost > 0 ? round2(grossValue / actualAiCost) : null,
    },
    byDepartment,
    topApps: [...apps].sort((x, y) => y.netValue - x.netValue),
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// ─── validateRoiSettingsInput — parse a create/update body into a clean override (pure) ───────────
// Both estimates are OPTIONAL (a null/omitted field means "clear ⇒ inherit"). When present, a value
// must be a finite number > 0 (minutes) / ≥ 0 (rate is > 0 too — a $0/hr rate is meaningless). Bounds
// keep a fat-fingered value from producing an absurd headline. Returns the errors and, when ok, the
// normalised override the store persists. The route stays a thin validator+persist shell.
export interface RoiSettingsValidation {
  ok: boolean;
  errors: string[];
  value?: RoiSettingsOverride;
}

const MAX_MINUTES_SAVED_PER_RUN = 100_000; // ~69 days/run — a generous ceiling; anything above is a typo.
const MAX_LOADED_COST_PER_HOUR = 100_000; // $100k/hr ceiling — anything above is a typo.

// A field is: undefined/null ⇒ cleared (inherit); else must be a finite number in (0, max].
function validateEstimateField(
  v: unknown,
  label: string,
  max: number,
): { errors: string[]; value: number | null } {
  if (v === undefined || v === null || v === '') return { errors: [], value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { errors: [`${label} must be a number`], value: null };
  }
  if (n <= 0) return { errors: [`${label} must be greater than 0`], value: null };
  if (n > max) return { errors: [`${label} must be ${max.toLocaleString()} or less`], value: null };
  return { errors: [], value: n };
}

export function validateRoiSettingsInput(body: unknown): RoiSettingsValidation {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, errors: ['body must be an object'] };
  }
  const b = body as Record<string, unknown>;
  const mins = validateEstimateField(
    b.minutesSavedPerRun,
    'minutesSavedPerRun',
    MAX_MINUTES_SAVED_PER_RUN,
  );
  const rate = validateEstimateField(
    b.loadedCostPerHour,
    'loadedCostPerHour',
    MAX_LOADED_COST_PER_HOUR,
  );
  const errors = [...mins.errors, ...rate.errors];
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: { minutesSavedPerRun: mins.value, loadedCostPerHour: rate.value },
  };
}

// ─── formatting helpers ($ / hours) — shared by every ROI surface so units read consistently ──────
/** Compact $ (USD) formatting: $1,234 with en-US grouping; negatives shown with a leading −. */
export function formatUsd(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  const abs = Math.abs(v).toLocaleString('en-US');
  return v < 0 ? `−$${abs}` : `$${abs}`;
}

/** Hours with one decimal + a thousands separator (en-US grouping), e.g. "13,520.0 hrs". */
export function formatHours(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hrs`;
}
