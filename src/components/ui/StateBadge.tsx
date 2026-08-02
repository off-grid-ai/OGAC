import { describeState, type HonestState } from '@/lib/honest-state';

// ─── The ONE badge for the seven honest states (ROADMAP §11) ───────────────────────────────────────
//
// "The UI must distinguish: production-ready, experimental, degraded, not configured, failed open,
// failed closed, awaiting approval — and must never imply that a control is active when it is not."
//
// Every surface that shows the health of a control renders THIS, so the same state cannot be a green
// dot on one page and an amber pill on another. The wording comes from the pure descriptor, so the
// sentence a reviewer reads on hover is identical everywhere too.
//
// FAILED OPEN is styled as the loudest state in the set, louder than failed closed, because it is the
// only one that means work continued unchecked — the distinction a compliance reviewer is looking for.

const TONE: Record<string, string> = {
  good: 'border-primary/40 bg-primary/10 text-primary',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500',
  bad: 'border-destructive/50 bg-destructive/10 text-destructive',
  neutral: 'border-border bg-muted text-muted-foreground',
};

export function StateBadge({
  state,
  subject,
  className = '',
}: Readonly<{
  state: HonestState;
  /** What the state is ABOUT, for the tooltip — "Guardrails", "Data quality", … */
  subject?: string;
  className?: string;
}>) {
  const d = describeState(state);
  return (
    <span
      title={subject ? `${subject} — ${d.meaning}` : d.meaning}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TONE[d.tone]} ${className}`}
    >
      {d.unprotected ? <span aria-hidden>⚠</span> : null}
      {d.label}
    </span>
  );
}

/** The badge plus its sentence, for a status row where there is space to explain. */
export function StateLine({
  state,
  subject,
}: Readonly<{ state: HonestState; subject: string }>) {
  const d = describeState(state);
  return (
    <div className="flex items-start gap-2">
      <StateBadge state={state} subject={subject} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{subject}</p>
        <p className="text-[11px] text-muted-foreground">{d.meaning}</p>
      </div>
    </div>
  );
}
