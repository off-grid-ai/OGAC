// ─── ROI reader — the I/O half of Surfaced ROI (server-only) ──────────────────────────────────────
//
// Assembles the REAL signals (completed run counts + actual AI cost per app, the app→department
// mapping) and hands them to the PURE calc in roi.ts. It never re-implements the arithmetic — it only
// gathers inputs:
//   • runsCompleted + actualAiCost per app  ← computeReportMetrics over the app's runs (app-reports.ts,
//     which already pulls real cost/tokens from each run's provenance/steps) — DRY, one cost rule;
//   • department per app  ← the app owner's first team-with-a-department (same rule the access layer
//     uses, resolved via teams.ts) so ROI rolls up the way the org-chart does;
//   • the two ESTIMATES  ← resolveRoiSettings(app override → org default → hard default).
//
// AI cost from the run trace is priced in USD (the gateway's native unit); ROI is stated in ₹, so we
// convert once here with a single, documented rate constant. The pure calc stays currency-agnostic.

import { computeReportMetrics } from '@/lib/app-reports';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { listApps } from '@/lib/apps-store';
import {
  type AppRoi,
  type RoiRollup,
  computeAppRoi,
  resolveRoiSettings,
  rollupRoi,
} from '@/lib/roi';
import {
  getAppRoiOverride,
  getOrgRoiDefault,
  listAppRoiOverrides,
} from '@/lib/roi-settings-store';
import { listMembershipsForUser, getTeam } from '@/lib/teams';

const DEFAULT_ORG = 'default';

// Single documented USD→₹ conversion for AI cost (the gateway prices in USD). Rounded, indicative —
// the ROI card labels AI cost as ACTUAL spend converted at this rate, not a live FX quote.
export const USD_TO_INR = 83;

// ─── per-app: real run count + real AI cost, from the run trace ───────────────────────────────────
// Reuses computeReportMetrics (the same rollup the Reports tab shows) so run counts + cost never
// drift between ROI and Reports. `completed` is the honest "runs that produced value" numerator.
export interface AppRunFacts {
  runsCompleted: number;
  actualAiCostInr: number;
}

export async function appRunFacts(
  appId: string,
  orgId: string = DEFAULT_ORG,
  limit = 500,
): Promise<AppRunFacts> {
  const runs = await listAppRunsView(appId, orgId, limit);
  const m = computeReportMetrics(runs);
  return {
    runsCompleted: m.completed,
    actualAiCostInr: Math.round(m.totalCostUsd * USD_TO_INR * 100) / 100,
  };
}

// ─── app → department (best-effort; mirrors the access layer's rule) ──────────────────────────────
// The department of the first team the app OWNER belongs to that has one. Null ⇒ Unassigned bucket.
// Never throws — a failed lookup degrades to null. Memoised per (owner,org) by the caller's map.
async function departmentForOwner(ownerId: string, orgId: string): Promise<string | null> {
  try {
    const memberships = await listMembershipsForUser(ownerId, orgId);
    for (const m of memberships) {
      const team = await getTeam(m.teamId, orgId);
      if (team?.department) return team.department;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

// ─── one app's full ROI row (used by the per-app card) ────────────────────────────────────────────
export async function computeAppRoiRow(
  appId: string,
  orgId: string = DEFAULT_ORG,
): Promise<AppRoi | null> {
  const apps = await listApps(orgId);
  const app = apps.find((a) => a.id === appId);
  if (!app) return null;
  const [facts, override, orgDefault] = await Promise.all([
    appRunFacts(appId, orgId),
    getAppRoiOverride(appId, orgId),
    getOrgRoiDefault(orgId),
  ]);
  const settings = resolveRoiSettings(override, orgDefault);
  const department = await departmentForOwner(app.ownerId, orgId);
  return computeAppRoi({
    appId: app.id,
    appTitle: app.title,
    department,
    runsCompleted: facts.runsCompleted,
    actualAiCost: facts.actualAiCostInr,
    settings,
  });
}

// ─── org-wide rollup (used by the Insights ROI view) ──────────────────────────────────────────────
// Builds an AppRoi row for every app in the org, then rolls up by department + org total via the pure
// rollupRoi. Owner→department is memoised so N apps don't cause N× the membership reads.
export async function computeOrgRoiRollup(orgId: string = DEFAULT_ORG): Promise<RoiRollup> {
  const [apps, overrides, orgDefault] = await Promise.all([
    listApps(orgId),
    listAppRoiOverrides(orgId),
    getOrgRoiDefault(orgId),
  ]);

  const deptCache = new Map<string, string | null>();
  const rows: AppRoi[] = [];
  for (const app of apps) {
    const facts = await appRunFacts(app.id, orgId);
    let department = deptCache.get(app.ownerId) ?? null;
    if (!deptCache.has(app.ownerId)) {
      department = await departmentForOwner(app.ownerId, orgId);
      deptCache.set(app.ownerId, department);
    }
    const settings = resolveRoiSettings(overrides.get(app.id) ?? null, orgDefault);
    rows.push(
      computeAppRoi({
        appId: app.id,
        appTitle: app.title,
        department,
        runsCompleted: facts.runsCompleted,
        actualAiCost: facts.actualAiCostInr,
        settings,
      }),
    );
  }

  return rollupRoi(rows);
}
