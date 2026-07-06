// insights-stats — PURE, zero-IO builders for the value-forward stat bands on the Insights
// surfaces (SIEM, Drift, Audit). Each function turns an already-computed view-model into a small
// array of `StatTile`s the shared `<StatBand>` renders as a responsive grid. Keeping the shaping
// here (not inline in the RSC page) is the SOLID seam: the rule is unit-testable in isolation and
// the page stays a thin I/O shell. No React, no fetch, no env — safe to test exhaustively.

export type StatTone = 'default' | 'good' | 'warn' | 'bad';

export interface StatTile {
  label: string;
  value: string;
  tone: StatTone;
}

// ── SIEM summary band ───────────────────────────────────────────────────────────────────────────
// Value-forward version of the security-events header: total events, how many were stopped
// (blocked/denied — the number an operator triages), distinct actors, distinct outcomes. The
// "stopped" tile turns bad only when something was actually stopped, so a quiet feed reads calm.
export interface SiemSummaryInput {
  total: number;
  blockedDenied: number;
  distinctActors: number;
  distinctOutcomes: number;
}

export function buildSiemStats(input: SiemSummaryInput): StatTile[] {
  return [
    { label: 'Events', value: fmtInt(input.total), tone: 'default' },
    {
      label: 'Blocked / denied',
      value: fmtInt(input.blockedDenied),
      tone: input.blockedDenied > 0 ? 'bad' : 'good',
    },
    { label: 'Distinct actors', value: fmtInt(input.distinctActors), tone: 'default' },
    { label: 'Outcomes', value: fmtInt(input.distinctOutcomes), tone: 'default' },
  ];
}

// ── Drift summary band ──────────────────────────────────────────────────────────────────────────
// Verdict-forward: the overall status (colored by severity), the numeric drift score, how many
// features drifted, and the sample windows compared. Mirrors the tone mapping the badges already
// use so the band and the verdict card agree.
export interface DriftSummaryInput {
  status: 'stable' | 'warning' | 'drift';
  driftScore: number | null;
  features: { drifted: boolean }[];
  baseline: number;
  current: number;
}

const DRIFT_TONE: Record<DriftSummaryInput['status'], StatTone> = {
  stable: 'good',
  warning: 'warn',
  drift: 'bad',
};

export function buildDriftStats(input: DriftSummaryInput): StatTile[] {
  const driftedCount = input.features.filter((f) => f.drifted).length;
  return [
    { label: 'Verdict', value: input.status, tone: DRIFT_TONE[input.status] },
    {
      label: 'Drift score',
      value: input.driftScore === null ? '—' : String(input.driftScore),
      tone: 'default',
    },
    {
      label: 'Drifted features',
      value: `${fmtInt(driftedCount)}/${fmtInt(input.features.length)}`,
      tone: driftedCount > 0 ? 'warn' : 'good',
    },
    {
      label: 'Samples (base / now)',
      value: `${fmtInt(input.baseline)} / ${fmtInt(input.current)}`,
      tone: 'default',
    },
  ];
}

// ── Audit summary band ──────────────────────────────────────────────────────────────────────────
// The audit log had no summary at all — only a table. This gives the operator the shape of the
// filtered result set at a glance: how many events matched, and how many distinct actors, actions,
// and projects are represented in the current view.
export interface AuditSummaryInput {
  total: number;
  distinctActors: number;
  distinctActions: number;
  distinctProjects: number;
}

export function buildAuditStats(input: AuditSummaryInput): StatTile[] {
  return [
    { label: 'Events', value: fmtInt(input.total), tone: 'default' },
    { label: 'Actors', value: fmtInt(input.distinctActors), tone: 'default' },
    { label: 'Actions', value: fmtInt(input.distinctActions), tone: 'default' },
    { label: 'Projects', value: fmtInt(input.distinctProjects), tone: 'default' },
  ];
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.trunc(n).toLocaleString() : '—';
}
