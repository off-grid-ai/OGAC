// Budget enforcement toggle (per-org) — the "clear flag so it can't surprise the demo" from the
// Phase-0 budget-enforcement gap. Enforcement is ON by default; an operator can turn the hard stop
// OFF (alerts still fire, inference continues) at three levels of precedence:
//   1. Env kill-switch:  OFFGRID_BUDGET_ENFORCE=false   (deployment-wide, highest precedence)
//   2. Per-org override:  flag `budget.enforce:<org>`   (this ONE org, overrides the global default)
//   3. Global flag:       flag `budget.enforce`          (per-deployment default, admin-editable)
//
// The env switch wins so a demo instance can force a known posture regardless of DB state. Below it,
// a per-org override lets one tenant differ from the deployment default (e.g. enforce for everyone
// but exempt a trial tenant, or the reverse). Absent all three, enforcement defaults to ON — the
// governance promise ("we can prove spend limits are enforced") must hold by default, not by opt-in.
//
// The pure decision (`checkBudget`) lives in finops.ts; this module is only the I/O-touching config
// read (env + flag store), kept as a thin, separately-testable seam. The org-resolution rule itself
// (`resolveEnforce`) is pure and unit-tested against the three inputs.

import { isEnabled } from '@/lib/store';

export const BUDGET_ENFORCE_FLAG = 'budget.enforce';

// The flag key carrying a single org's enforce override, e.g. `budget.enforce:acme`. Blank/whitespace
// orgs have no per-org key (they fall through to the global flag). Returns null when there is no
// meaningful per-org scope, so callers know to skip the per-org store read entirely.
export function orgEnforceFlagKey(org?: string): string | null {
  const o = (org ?? '').trim();
  return o ? `${BUDGET_ENFORCE_FLAG}:${o}` : null;
}

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

// Pure org-scoped resolution. Given the three resolved inputs — the env tri-state, the per-org
// override (true/false when the org has an explicit override, undefined when it has none), and the
// global flag value — decide whether enforcement is active. Precedence: env (if set) → per-org
// override (if present) → global flag. Backward compatible: with no per-org override (undefined),
// the result is identical to the old env→global behavior.
export function resolveEnforce(
  env: 'on' | 'off' | 'unset',
  orgOverride: boolean | undefined,
  globalFlag: boolean,
): boolean {
  if (env !== 'unset') return env === 'on';
  if (orgOverride !== undefined) return orgOverride;
  return globalFlag;
}

// Read a per-org override from the flag store, if one exists. Returns undefined for a blank org or
// when no per-org flag row is set, so `resolveEnforce` falls through to the global flag. We probe
// "does this org's flag mean ON?" and "does it mean OFF?" against opposite fallbacks: if the two
// answers disagree, the row is absent (each read just returned its own fallback) → no override.
async function orgEnforceOverride(org?: string): Promise<boolean | undefined> {
  const key = orgEnforceFlagKey(org);
  if (!key) return undefined;
  const asOn = await isEnabled(key, true);
  const asOff = await isEnabled(key, false);
  if (asOn !== asOff) return undefined; // no row set → both reads returned their fallback
  return asOn; // row present (both reads agree on the stored value)
}

// Is hard budget enforcement active for THIS org right now? Env wins deployment-wide; else a per-org
// override for this tenant; else the global flag store, default ON. A blank/undefined org resolves
// exactly like the old global behavior (no per-org override in play).
export async function budgetEnforced(org?: string): Promise<boolean> {
  const env = envEnforceState(process.env.OFFGRID_BUDGET_ENFORCE);
  // Short-circuit: when the env kill-switch is decisive, no flag reads are needed at all.
  if (env !== 'unset') return env === 'on';
  const orgOverride = await orgEnforceOverride(org);
  const globalFlag = await isEnabled(BUDGET_ENFORCE_FLAG, true); // default ON
  return resolveEnforce(env, orgOverride, globalFlag);
}
