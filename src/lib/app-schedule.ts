// ─── App SCHEDULE model (Builder Gap #1) — PURE, zero-IO, unit-testable ───────────────────────────
//
// A schedule-triggered app carries WHEN it fires under `trigger.config`: a cron expression, an IANA
// timezone, and an enabled flag. Before this module the builder let a user PICK "schedule" but gave
// no way to configure the cron/timezone or see the next fire — a silent dead-end (a scheduled app
// that never ran). This is the ONE pure authority for that config: it normalizes an untrusted config
// object into a validated ScheduleConfig, decides validity + WHY it's invalid, and computes the next
// fire time from a cron spec + timezone WITHOUT any I/O or a cron dependency (a small deterministic
// 5-field cron evaluator). The I/O bridge (app-schedules.ts) registers the schedule with the durable
// runtime; the builder UI reads THIS to render the cron/timezone form + the live "next fire" preview.
//
// SOLID: zero imports of db/network — every function here is a pure decision over its inputs, so the
// whole surface is exhaustively unit-testable (test/app-schedule.test.ts). It REUSES isValidCron from
// temporal-schedules.ts for the shape check (single source of truth for "is this cron accepted") and
// ADDS the parts that layer needs but doesn't have: timezone validation, the enabled flag, a plain-
// language description, and a real next-fire computation.

import { isValidCron } from '@/lib/temporal-schedules';

// ─── ScheduleConfig — the normalized shape stored under trigger.config ────────────────────────────
export interface ScheduleConfig {
  /** 5- or 6-field cron, or an @macro (@daily …). Empty string ⇒ not yet configured. */
  cron: string;
  /** IANA timezone (e.g. "Asia/Kolkata"). Defaults to "UTC" when absent/invalid. */
  timezone: string;
  /** Whether the schedule is armed. false ⇒ saved but paused (never fires until enabled). */
  enabled: boolean;
}

export const DEFAULT_TIMEZONE = 'UTC';

// ─── isValidTimezone — a real IANA tz check via Intl (PURE, no config data table) ─────────────────
// Uses the runtime's own IANA database through Intl.DateTimeFormat: an unknown zone throws a
// RangeError, a known one constructs fine. No hardcoded list to drift. "UTC" is always valid.
export function isValidTimezone(tz: string): boolean {
  const t = (tz ?? '').trim();
  if (!t) return false;
  if (t.toUpperCase() === 'UTC') return true;
  try {
    // Throws RangeError for an invalid time zone identifier.
    new Intl.DateTimeFormat('en-US', { timeZone: t });
    return true;
  } catch {
    return false;
  }
}

// ─── normalizeScheduleConfig — coerce an untrusted trigger.config into a ScheduleConfig (PURE) ────
// The builder / route hand raw JSON. This clamps it to the safe shape: a string cron (trimmed, or
// ''), a valid IANA timezone (else DEFAULT_TIMEZONE), and an enabled flag (default TRUE — a user who
// sets a cron means to run it; they disable explicitly). Accepts the legacy `.schedule`/`.expression`
// aliases for the cron so an app authored by the trigger picker resolves the same way app-schedules
// reads it (cronFromTrigger).
export function normalizeScheduleConfig(raw: Record<string, unknown> | null | undefined): ScheduleConfig {
  const c = raw ?? {};
  const cronRaw = c.cron ?? c.schedule ?? c.expression;
  const cron = typeof cronRaw === 'string' ? cronRaw.trim() : '';
  const tzRaw = typeof c.timezone === 'string' ? c.timezone.trim() : '';
  const timezone = isValidTimezone(tzRaw) ? tzRaw : DEFAULT_TIMEZONE;
  // enabled defaults to true; only an explicit `false` disables (so an omitted flag arms it).
  const enabled = c.enabled === false ? false : true;
  return { cron, timezone, enabled };
}

// ─── ScheduleValidity — the validated verdict + a plain-language reason ───────────────────────────
export interface ScheduleValidity {
  ok: boolean;
  /** Why it's invalid (empty when ok). One line, non-technical. */
  reason: string;
}

// ─── validateScheduleConfig — is this schedule runnable? (PURE) ───────────────────────────────────
// A schedule is valid iff it carries a non-empty, well-formed cron AND a valid timezone. An empty
// cron is the "picked schedule but didn't set a time" dead-end — reported honestly, not as ok.
export function validateScheduleConfig(cfg: ScheduleConfig): ScheduleValidity {
  if (!cfg.cron) {
    return { ok: false, reason: 'No schedule set yet — choose how often this runs.' };
  }
  if (!isValidCron(cfg.cron)) {
    return {
      ok: false,
      reason: `"${cfg.cron}" is not a valid schedule — use a 5-field cron (min hour day month weekday) or a preset like @daily.`,
    };
  }
  if (!isValidTimezone(cfg.timezone)) {
    return { ok: false, reason: `"${cfg.timezone}" is not a known timezone.` };
  }
  return { ok: true, reason: '' };
}

// ─── describeSchedule — a one-line plain-language summary for the non-technical operator (PURE) ───
// e.g. "Runs @daily (Asia/Kolkata) — armed" / "Runs 0 9 * * 1 (UTC) — paused" / "No schedule set".
export function describeSchedule(cfg: ScheduleConfig): string {
  if (!cfg.cron) return 'No schedule set — this app will not run on its own until you set a time.';
  const state = cfg.enabled ? 'armed' : 'paused';
  return `Runs ${cfg.cron} (${cfg.timezone}) — ${state}`;
}

// ─── PRESETS — friendly cron choices for the builder's picker (data, kept here so it's testable) ──
export const SCHEDULE_PRESETS: { cron: string; label: string }[] = [
  { cron: '@hourly', label: 'Every hour' },
  { cron: '@daily', label: 'Every day at midnight' },
  { cron: '0 9 * * *', label: 'Every day at 9am' },
  { cron: '0 9 * * 1', label: 'Every Monday at 9am' },
  { cron: '0 9 1 * *', label: 'First of every month at 9am' },
  { cron: '@weekly', label: 'Every week' },
  { cron: '@monthly', label: 'Every month' },
];

// ─── nextFireTimes — compute the next N fire times for a cron + timezone (PURE) ───────────────────
// A real, dependency-free evaluator over standard 5-field cron (min hour dom month dow) plus the
// @macros. It walks forward minute-by-minute from `from` (bounded) and returns the ISO timestamps
// (UTC instants) of the next matches, interpreting the cron fields in the given IANA timezone. This is
// what powers the builder's "next fire: …" preview — the operator sees WHEN it will run before saving,
// so a schedule is never a silent no-op. Returns [] for an invalid cron/timezone (caller shows the
// validity reason instead). Bounded to a ~400-day horizon so a never-matching spec can't loop forever.
/**
 * Walk forward minute by minute collecting the next `count` matches. PURE (given a fixed `from`).
 *
 * Bounded at ~400 days so an unsatisfiable-but-valid cron (Feb 30) terminates instead of spinning.
 * 400 rather than 366 because a "1st of the month" spec evaluated late in a month still needs a full
 * year of headroom to collect several fires.
 */
function walkFireTimes(
  fields: CronFields,
  timezone: string,
  count: number,
  from: Date,
): string[] {
  const out: string[] = [];
  // Start at the next whole minute after `from` — a cron fires on minute boundaries.
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const MAX_MINUTES = 400 * 24 * 60;
  for (let i = 0; i < MAX_MINUTES && out.length < count; i++) {
    const parts = zonedParts(cursor, timezone);
    if (parts && matchesCron(fields, parts)) out.push(cursor.toISOString());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return out;
}

export function nextFireTimes(cfg: ScheduleConfig, count = 3, from: Date = new Date()): string[] {
  if (validateScheduleConfig(cfg).ok !== true) return [];
  const fields = expandCron(cfg.cron);
  if (!fields) return [];

  return walkFireTimes(fields, cfg.timezone, count, from);
}

// ─── ScheduleView — everything the builder's Schedule tab + the API render (PURE) ─────────────────
// One shaping function so the route stays thin AND the UI never recomputes validity/next-fire from
// raw config. `runtimeConfigured` is the honest "will this actually fire?" bit the route fills from
// the durable-runtime check (a valid schedule on an un-configured runtime is saved but dormant).
export interface ScheduleView {
  object: 'app_schedule';
  appId: string;
  config: ScheduleConfig;
  valid: boolean;
  reason: string;
  description: string;
  /** Next fire times (ISO, UTC instants) for a valid+enabled schedule; [] otherwise. */
  nextFires: string[];
  /** Whether the durable runner is configured to actually fire schedules (filled by the route). */
  runtimeConfigured: boolean;
}

export function buildScheduleView(
  appId: string,
  cfg: ScheduleConfig,
  runtimeConfigured: boolean,
  from: Date = new Date(),
): ScheduleView {
  const validity = validateScheduleConfig(cfg);
  // Only preview fire times for a valid, ENABLED schedule (a paused one won't fire, so previewing
  // "next fire" would be misleading — describeSchedule reports the paused state instead).
  const nextFires = validity.ok && cfg.enabled ? nextFireTimes(cfg, 3, from) : [];
  return {
    object: 'app_schedule',
    appId,
    config: cfg,
    valid: validity.ok,
    reason: validity.reason,
    description: describeSchedule(cfg),
    nextFires,
    runtimeConfigured,
  };
}

// ─── cron expansion (PURE) ────────────────────────────────────────────────────────────────────────
interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>; // day-of-month 1..31
  month: Set<number>; // 1..12
  dow: Set<number>; // day-of-week 0..6 (0 = Sunday)
  /** true when BOTH dom and dow are restricted — standard cron ORs them in that case. */
  domAndDowRestricted: boolean;
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

// Expand a cron string into per-field allowed-value sets. Strips an optional CRON_TZ/TZ prefix and a
// leading seconds field (6-field cron) — the seconds granularity isn't used by the minute walker.
// Returns null for anything the evaluator can't represent (caller falls back to []).
/**
 * Normalise any accepted cron spelling down to exactly five fields, or null. PURE.
 *
 * Handles the three things a spec can carry before the fields themselves: a CRON_TZ/TZ prefix
 * (stripped — the timezone is passed separately), an @macro, and an optional leading SECONDS field.
 * The seconds field is DROPPED rather than honoured because the scheduler walks at minute
 * granularity; pretending to support per-second firing would promise precision we do not have.
 */
function cronFields(spec: string): string[] | null {
  let body = (spec ?? '').trim().replace(/^(CRON_TZ|TZ)=\S+\s+/, '').trim();
  if (!body) return null;
  if (body.startsWith('@')) {
    const macro = MACROS[body.toLowerCase()];
    if (!macro) return null;
    body = macro;
  }
  const fields = body.split(/\s+/);
  const withoutSeconds = fields.length === 6 ? fields.slice(1) : fields;
  return withoutSeconds.length === 5 ? withoutSeconds : null;
}

export function expandCron(spec: string): CronFields | null {
  const fields = cronFields(spec);
  if (!fields) return null;

  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dom = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  // day-of-week: accept 0..7 (both 0 and 7 mean Sunday, per standard cron) then fold 7→0.
  const dow = parseField(fields[4], 0, 7, (n) => (n === 7 ? 0 : n));
  if (!minute || !hour || !dom || !month || !dow) return null;

  const domAndDowRestricted = fields[2].trim() !== '*' && fields[4].trim() !== '*';
  return { minute, hour, dom, month, dow, domAndDowRestricted };
}

/**
 * One comma-separated cron part — a wildcard, a step, a single value, a range, or a stepped range —
 * as an inclusive span plus its step. PURE.
 *
 * Returns null for anything malformed OR out of range, and the caller then rejects the WHOLE field.
 * Skipping a bad part would silently produce a schedule that fires on a subset of what the operator
 * wrote — a cron that runs at the wrong times is worse than one that is refused.
 */
function parseCronPart(
  part: string,
  min: number,
  max: number,
): { lo: number; hi: number; step: number } | null {
  const [rangePart, stepPart] = part.split('/');
  const step = stepPart === undefined ? 1 : Number(stepPart);
  if (!Number.isInteger(step) || step < 1) return null;

  const [lo, hi] = cronBounds(rangePart, min, max);
  return inRange(lo, hi, min, max) ? { lo, hi, step } : null;
}

/** A well-formed, in-range, non-inverted span. */
function inRange(lo: number, hi: number, min: number, max: number): boolean {
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false;
  return lo >= min && hi <= max && lo <= hi;
}

/** The inclusive bounds a range expression covers: "*" is the whole field, "a-b" a range, "n" itself. */
function cronBounds(rangePart: string, min: number, max: number): [number, number] {
  if (rangePart === '*') return [min, max];
  if (rangePart.includes('-')) {
    const [a, b] = rangePart.split('-');
    return [Number(a), Number(b)];
  }
  const n = Number(rangePart);
  return [n, n];
}

// Parse one cron field ("*", "*/5", "1,2,3", "1-5", "1-10/2") into the set of matching values.
function parseField(
  raw: string,
  min: number,
  max: number,
  map: (n: number) => number = (n) => n,
): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const span = parseCronPart(part, min, max);
    if (!span) return null; // ANY unparseable part invalidates the field — never a partial schedule
    for (let v = span.lo; v <= span.hi; v += span.step) out.add(map(v));
  }
  return out.size ? out : null;
}

// ─── zoned time parts — interpret a UTC instant in an IANA timezone (PURE via Intl) ───────────────
export interface TimeParts {
  minute: number;
  hour: number;
  dom: number;
  month: number;
  dow: number; // 0 = Sunday
}

function zonedParts(instant: Date, timezone: string): TimeParts | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone === 'UTC' ? 'UTC' : timezone,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    const map: Record<string, string> = {};
    for (const p of fmt.formatToParts(instant)) map[p.type] = p.value;
    const hour = Number(map.hour) === 24 ? 0 : Number(map.hour); // Intl can emit "24" for midnight
    const dowNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      minute: Number(map.minute),
      hour,
      dom: Number(map.day),
      month: Number(map.month),
      dow: dowNames[map.weekday] ?? 0,
    };
  } catch {
    return null;
  }
}

function matchesCron(f: CronFields, t: TimeParts): boolean {
  if (!f.minute.has(t.minute)) return false;
  if (!f.hour.has(t.hour)) return false;
  if (!f.month.has(t.month)) return false;
  // Standard cron: when BOTH day-of-month and day-of-week are restricted, a match on EITHER fires.
  const domMatch = f.dom.has(t.dom);
  const dowMatch = f.dow.has(t.dow);
  if (f.domAndDowRestricted) return domMatch || dowMatch;
  return domMatch && dowMatch;
}
