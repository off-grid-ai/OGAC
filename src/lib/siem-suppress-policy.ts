// PURE suppression logic for the SIEM feed — ZERO imports beyond types, ZERO I/O, so it is fully
// unit-testable. A suppression rule mutes noisy security events (a known scanner IP, a service
// account, a health-probe path) so the feed stays signal. The DB adapter lives in siem-suppress.ts;
// this file is the rule shape, its validation gate, and the apply function.

import type { SiemEvent, SiemOutcome, SiemView } from '@/lib/siem-view';

export type SuppressionKind = 'actor' | 'ip' | 'action';

export interface SuppressionInput {
  kind: SuppressionKind;
  pattern: string;
  note?: string;
}

export interface SuppressionRule extends SuppressionInput {
  id: string;
  note: string; // always a string once persisted (DB default '')
  createdAt: string;
}

export interface ValidationResult {
  ok: boolean;
  value?: SuppressionInput;
  error?: string;
}

const KINDS: SuppressionKind[] = ['actor', 'ip', 'action'];

export function validateSuppression(input: Partial<SuppressionInput> | null | undefined): ValidationResult {
  if (!input) return { ok: false, error: 'missing body' };
  const kind = input.kind;
  if (!kind || !KINDS.includes(kind)) {
    return { ok: false, error: 'kind must be actor | ip | action' };
  }
  const pattern = (input.pattern ?? '').trim();
  if (!pattern) return { ok: false, error: 'pattern is required' };
  if (pattern.length > 200) return { ok: false, error: 'pattern too long (max 200)' };
  return {
    ok: true,
    value: { kind, pattern, note: (input.note ?? '').trim().slice(0, 300) },
  };
}

function fieldFor(e: SiemEvent, kind: SuppressionKind): string {
  if (kind === 'actor') return e.actor;
  if (kind === 'ip') return e.ip;
  return e.action;
}

/** True if any rule suppresses this event (case-insensitive substring match on the rule's field). */
export function isSuppressed(e: SiemEvent, rules: SuppressionRule[]): boolean {
  return rules.some((r) => {
    const hay = fieldFor(e, r.kind).toLowerCase();
    return hay.length > 0 && hay.includes(r.pattern.toLowerCase());
  });
}

/**
 * Apply suppression rules to a SiemView: drop matching events and re-derive every aggregate
 * (total, byOutcome, topActors, blockedDenied) from the survivors, so the whole view stays
 * internally consistent. Pure — returns a new view, never mutates the input.
 */
export function applySuppressions(view: SiemView, rules: SuppressionRule[]): SiemView {
  if (rules.length === 0) return view;
  const events = view.events.filter((e) => !isSuppressed(e, rules));

  const outcomeCounts = new Map<SiemOutcome, number>();
  const actorCounts = new Map<string, number>();
  let blockedDenied = 0;
  for (const e of events) {
    outcomeCounts.set(e.outcome, (outcomeCounts.get(e.outcome) ?? 0) + 1);
    if (e.actor) actorCounts.set(e.actor, (actorCounts.get(e.actor) ?? 0) + 1);
    if (e.outcome === 'blocked' || e.outcome === 'denied') blockedDenied += 1;
  }

  return {
    total: events.length,
    events,
    byOutcome: [...outcomeCounts.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count),
    topActors: [...actorCounts.entries()]
      .map(([actor, count]) => ({ actor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    blockedDenied,
  };
}
