import type { ServiceHealth } from '@/lib/service-health';
import {
  READINESS_GATES,
  type ReadinessState,
  type ReadinessSummary,
} from '@/lib/service-topology';

export const GATE_LABEL: Record<(typeof READINESS_GATES)[number], string> = {
  deployed: 'Deployed',
  reachable: 'Reachable',
  functional: 'Functional',
  seeded: 'Seeded',
  'console-used': 'Console-used',
};

export const READINESS_UI: Record<ReadinessState, string> = {
  pass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  fail: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  unknown: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  'not-applicable': 'border-border bg-muted/40 text-muted-foreground',
};

export function withLiveReachability(
  readiness: ReadinessSummary,
  health: ServiceHealth | null | undefined,
): ReadinessSummary {
  if (!health) return readiness;
  if (health.status === 'up' || health.status === 'embedded') {
    return { ...readiness, reachable: 'pass' };
  }
  if (health.status === 'down') return { ...readiness, reachable: 'fail' };
  return readiness;
}

export function ReadinessStrip({
  readiness,
  health,
}: Readonly<{ readiness: ReadinessSummary; health?: ServiceHealth | null }>) {
  const effective = withLiveReachability(readiness, health);
  return (
    <div className="grid grid-cols-5 gap-1" aria-label="Readiness gates">
      {READINESS_GATES.map((gate) => (
        <span
          key={gate}
          className={`truncate rounded border px-1.5 py-1 text-center text-[9px] uppercase tracking-tight ${READINESS_UI[effective[gate]]}`}
          title={`${GATE_LABEL[gate]}: ${effective[gate]}`}
        >
          {GATE_LABEL[gate]}
        </span>
      ))}
    </div>
  );
}
