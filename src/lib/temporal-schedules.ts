// Pure validation + shaping for Temporal SCHEDULES (recurring agent runs). Zero-import, zero-I/O,
// unit-testable in isolation (like agent-run-durable.ts). The I/O adapter that actually creates /
// lists / pauses / deletes schedules against a live cluster (via @temporalio/client ScheduleClient)
// lives in src/lib/adapters/agentruntime.ts and calls these functions to validate input + shape
// the client's ScheduleDescription responses into JSON-safe rows.
//
// A schedule fires the SAME AgentRunWorkflow on a cron spec, so "scheduled/cron agent runs" become
// real: each fire is a durable agent run with a fresh runId (Temporal appends the scheduled time).

import type { AgentRunWorkflowInput } from './agent-run-durable';

// ── Create input ──────────────────────────────────────────────────────────────────────────────

/** Raw create-schedule request (from the admin route body). */
export interface CreateScheduleRequest {
  scheduleId?: unknown;
  cron?: unknown;
  agentId?: unknown;
  query?: unknown;
  caller?: unknown;
  requireReview?: unknown;
  orgId?: unknown;
  /** Optional human note stored as the schedule memo. */
  note?: unknown;
  /** Start paused (default false). */
  paused?: unknown;
}

/** A validated, normalized schedule creation spec — everything the adapter needs to call create(). */
export interface ScheduleSpec {
  scheduleId: string;
  orgId: string;
  cron: string;
  /** The workflow input each fire runs. The per-fire runId is derived at fire time (see runIdSeed). */
  input: Omit<AgentRunWorkflowInput, 'runId'>;
  note?: string;
  paused: boolean;
}

/** Schedule-id charset: Temporal ids must be printable + we keep them URL/-safe. */
export function sanitizeScheduleId(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 128);
}

export type ScheduleKind = 'agent' | 'app';

function stableOrgHash(orgId: string): string {
  let hash = 0x811c9dc5;
  for (const char of orgId) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Opaque, stable tenant/kind prefix used for ownership checks before Temporal I/O. */
export function scheduleNamespace(orgId: string, kind: ScheduleKind): string {
  return `og-${kind}-${stableOrgHash(orgId.trim() || 'default')}-`;
}

export function namespacedScheduleId(
  orgId: string,
  kind: ScheduleKind,
  requestedId: string,
): string {
  const prefix = scheduleNamespace(orgId, kind);
  const suffix = sanitizeScheduleId(requestedId) || 'schedule';
  return `${prefix}${suffix}`.slice(0, 128);
}

export function ownsSchedule(scheduleId: string, orgId: string, kind: ScheduleKind): boolean {
  return scheduleId.startsWith(scheduleNamespace(orgId, kind));
}

/**
 * Very light cron-spec validation. Temporal accepts standard 5- or 6-field cron plus @-macros
 * (@daily, @hourly, …) and optional `CRON_TZ=`/`TZ=` prefixes. We don't fully parse cron here — we
 * just reject empties and obviously malformed field counts so the operator gets a clear error
 * before we hit the cluster. The cluster is still the source of truth for cron correctness.
 */
export function isValidCron(spec: string): boolean {
  const s = spec.trim();
  if (!s) return false;
  // Strip an optional timezone prefix: "CRON_TZ=America/New_York 0 9 * * *".
  const body = s.replace(/^(CRON_TZ|TZ)=\S+\s+/, '').trim();
  if (body.startsWith('@')) {
    return [
      '@yearly',
      '@annually',
      '@monthly',
      '@weekly',
      '@daily',
      '@midnight',
      '@hourly',
    ].includes(body.toLowerCase());
  }
  const fields = body.split(/\s+/);
  return fields.length === 5 || fields.length === 6;
}

/** Validate + normalize a create request into a ScheduleSpec. Throws on invalid input. */
export function toScheduleSpec(raw: CreateScheduleRequest, orgId: string): ScheduleSpec {
  if (!orgId.trim()) throw new Error('orgId required');
  if (typeof raw.agentId !== 'string' || !raw.agentId.trim()) throw new Error('agentId required');
  if (typeof raw.query !== 'string' || !raw.query.trim()) throw new Error('query required');
  if (typeof raw.cron !== 'string' || !isValidCron(raw.cron)) {
    throw new Error('valid cron spec required (5- or 6-field cron, or an @macro)');
  }
  const requestedId =
    typeof raw.scheduleId === 'string' && raw.scheduleId.trim()
      ? sanitizeScheduleId(raw.scheduleId)
      : sanitizeScheduleId(`agentsched-${raw.agentId}-${Date.now().toString(36)}`);
  if (!requestedId) throw new Error('scheduleId resolved empty after sanitization');
  return {
    scheduleId: namespacedScheduleId(orgId, 'agent', requestedId),
    orgId,
    cron: raw.cron.trim(),
    input: {
      agentId: raw.agentId,
      query: raw.query,
      caller: typeof raw.caller === 'string' && raw.caller.trim() ? raw.caller : undefined,
      requireReview: raw.requireReview === true,
      orgId,
    },
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined,
    paused: raw.paused === true,
  };
}

/**
 * Derive the per-fire runId seed for a scheduled workflow. Temporal appends the scheduled timestamp
 * to the workflow id automatically (workflowId + '-' + <nominal time>) — so the AgentRunWorkflow
 * input needs a base runId that's stable per schedule; the fire time makes each execution distinct.
 */
export function scheduleRunIdSeed(scheduleId: string): string {
  return `sched_${scheduleId}`;
}

// ── Describe shaping (list / detail) ───────────────────────────────────────────────────────────

/** Subset of @temporalio/client ScheduleSummary / ScheduleDescription we read. */
export interface RawScheduleDescription {
  scheduleId: string;
  /** Whether the schedule is paused. */
  paused?: boolean;
  note?: string;
  /** Cron expressions from the spec (spec.cronExpressions), when cron-based. */
  cronExpressions?: string[];
  /** The workflow type the action starts (should be AgentRunWorkflow). */
  workflowType?: string;
  /** Recent action times (ISO), most recent first. */
  recentActions?: (Date | string | number)[];
  /** Upcoming action times (ISO). */
  nextActions?: (Date | string | number)[];
  /** How many times it has fired. */
  numActionsTaken?: number | bigint;
}

export interface ScheduleRow {
  scheduleId: string;
  paused: boolean;
  note?: string;
  cron: string[];
  workflowType?: string;
  recentActions: string[];
  nextActions: string[];
  numActionsTaken?: number;
}

function isoList(xs: (Date | string | number)[] | undefined): string[] {
  if (!xs) return [];
  const out: string[] = [];
  for (const x of xs) {
    const d = x instanceof Date ? x : new Date(x);
    if (!Number.isNaN(d.getTime())) out.push(d.toISOString());
  }
  return out;
}

export function shapeSchedule(raw: RawScheduleDescription): ScheduleRow {
  return {
    scheduleId: raw.scheduleId,
    paused: raw.paused === true,
    note: raw.note,
    cron: raw.cronExpressions ?? [],
    workflowType: raw.workflowType,
    recentActions: isoList(raw.recentActions),
    nextActions: isoList(raw.nextActions),
    numActionsTaken: raw.numActionsTaken == null ? undefined : Number(raw.numActionsTaken),
  };
}

export interface SchedulesView {
  object: 'temporal_schedules';
  configured: boolean;
  reachable: boolean;
  note?: string;
  schedules: ScheduleRow[];
}

type SchedulesViewOpts = { configured: boolean; reachable: boolean; note?: string };
const DEFAULT_SCHEDULES_OPTS: SchedulesViewOpts = { configured: false, reachable: false };

export function buildSchedulesView(
  raws: RawScheduleDescription[],
  opts: SchedulesViewOpts = DEFAULT_SCHEDULES_OPTS,
): SchedulesView {
  return {
    object: 'temporal_schedules',
    configured: opts.configured,
    reachable: opts.reachable,
    note: opts.note,
    schedules: raws.map(shapeSchedule),
  };
}
