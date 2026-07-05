// Budget enforcement toggle (per-org) — the "clear flag so it can't surprise the demo" from the
// Phase-0 budget-enforcement gap. Enforcement is ON by default; an operator can turn the hard stop
// OFF (alerts still fire, inference continues) two ways:
//   1. Env kill-switch:  OFFGRID_BUDGET_ENFORCE=false   (deployment-wide, highest precedence)
//   2. Feature flag:      budget.enforce = false          (per-deployment, admin-editable in the UI)
//
// The env switch wins so a demo instance can force a known posture regardless of DB state. Absent
// both, enforcement defaults to ON — the governance promise ("we can prove spend limits are
// enforced") must hold by default, not by opt-in.
//
// The pure decision (`checkBudget`) lives in finops.ts; this module is only the I/O-touching config
// read (env + flag store), kept as a thin, separately-testable seam.

import { isEnabled } from '@/lib/store';

export const BUDGET_ENFORCE_FLAG = 'budget.enforce';

// Pure resolution of the env kill-switch → tri-state. Exported for unit testing without the DB.
//   'off'   → OFFGRID_BUDGET_ENFORCE explicitly disables (false/0/no/off)
//   'on'    → explicitly enables (true/1/yes/on)
//   'unset' → defer to the flag store (default ON)
export function envEnforceState(raw: string | undefined): 'on' | 'off' | 'unset' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return 'unset';
  if (['false', '0', 'no', 'off'].includes(v)) return 'off';
  if (['true', '1', 'yes', 'on'].includes(v)) return 'on';
  return 'unset'; // an unrecognized value defers to the flag (fail toward the safe default)
}

// Is hard budget enforcement active for this org right now? Env wins; else the flag store with a
// default of ON. (org is accepted for a future per-org flag; the current flag store is global.)
export async function budgetEnforced(_org?: string): Promise<boolean> {
  const env = envEnforceState(process.env.OFFGRID_BUDGET_ENFORCE);
  if (env !== 'unset') return env === 'on';
  return isEnabled(BUDGET_ENFORCE_FLAG, true); // default ON
}
