import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_LOADED_COST_PER_HOUR,
  DEFAULT_MINUTES_SAVED_PER_RUN,
  UNASSIGNED_ROI_DEPARTMENT,
  type AppRoi,
  computeAppRoi,
  computeRoi,
  formatHours,
  formatInr,
  resolveRoiSettings,
  rollupRoi,
  validateRoiSettingsInput,
} from '../src/lib/roi.ts';

// PURE unit tests for the Surfaced-ROI calc. The model is honest arithmetic:
//   hoursSaved = runs × mins/60 ; grossValue = hoursSaved × rate ; netValue = gross − actualAiCost.
// The bar cases: normal, zero-runs, missing/negative estimate, rollup-sum equals the parts.

// ─── computeRoi — normal ─────────────────────────────────────────────────────────────────────────
test('computeRoi: normal — 100 runs × 15 min @ ₹1500/hr minus ₹500 cost', () => {
  const r = computeRoi({
    runsCompleted: 100,
    minutesSavedPerRun: 15,
    loadedCostPerHour: 1500,
    actualAiCost: 500,
  });
  assert.equal(r.runsCompleted, 100);
  assert.equal(r.hoursSaved, 25); // 100×15/60
  assert.equal(r.grossValue, 37500); // 25×1500
  assert.equal(r.actualAiCost, 500);
  assert.equal(r.netValue, 37000); // 37500−500
  assert.equal(r.roiMultiple, 75); // 37500/500
});

// insurer actuarial-pricing sanity: the headline ~13,520 hrs/yr the docs quote is reproducible.
test('computeRoi: reproduces a large hours-saved headline honestly', () => {
  // 54,080 runs × 15 min = 13,520 hrs.
  const r = computeRoi({
    runsCompleted: 54080,
    minutesSavedPerRun: 15,
    loadedCostPerHour: 2000,
    actualAiCost: 0,
  });
  assert.equal(r.hoursSaved, 13520);
  assert.equal(r.grossValue, 27040000);
  assert.equal(r.roiMultiple, null); // no cost → no multiple, not Infinity
});

// ─── zero runs → honest zeros, never NaN ──────────────────────────────────────────────────────────
test('computeRoi: zero runs → all-zero, roiMultiple null (no NaN/Infinity)', () => {
  const r = computeRoi({
    runsCompleted: 0,
    minutesSavedPerRun: 15,
    loadedCostPerHour: 1500,
    actualAiCost: 0,
  });
  assert.equal(r.runsCompleted, 0);
  assert.equal(r.hoursSaved, 0);
  assert.equal(r.grossValue, 0);
  assert.equal(r.netValue, 0);
  assert.equal(r.roiMultiple, null);
});

// ─── missing / bad estimate inputs → sanitised to zero ────────────────────────────────────────────
test('computeRoi: missing estimate (NaN/negative/non-number) → 0, no NaN', () => {
  const r = computeRoi({
    runsCompleted: 50,
    minutesSavedPerRun: NaN,
    loadedCostPerHour: -100,
    actualAiCost: Number.POSITIVE_INFINITY,
  });
  assert.equal(r.hoursSaved, 0); // NaN mins → 0
  assert.equal(r.grossValue, 0); // negative rate → 0
  assert.equal(r.actualAiCost, 0); // Infinity → 0
  assert.equal(r.netValue, 0);
  assert.equal(r.roiMultiple, null);
});

test('computeRoi: fractional runs truncated; cost exceeding value → negative net', () => {
  const r = computeRoi({
    runsCompleted: 10.9,
    minutesSavedPerRun: 6,
    loadedCostPerHour: 600,
    actualAiCost: 5000,
  });
  assert.equal(r.runsCompleted, 10); // truncated
  assert.equal(r.hoursSaved, 1); // 10×6/60
  assert.equal(r.grossValue, 600);
  assert.equal(r.netValue, -4400); // negative net is honest, not floored
  assert.equal(r.roiMultiple, 0.12);
});

// ─── resolveRoiSettings — precedence: app override → org default → hard default ───────────────────
test('resolveRoiSettings: hard defaults when nothing set', () => {
  const s = resolveRoiSettings(null, null);
  assert.equal(s.minutesSavedPerRun, DEFAULT_MINUTES_SAVED_PER_RUN);
  assert.equal(s.loadedCostPerHour, DEFAULT_LOADED_COST_PER_HOUR);
});

test('resolveRoiSettings: org default overrides hard default', () => {
  const s = resolveRoiSettings(null, { minutesSavedPerRun: 30, loadedCostPerHour: 2500 });
  assert.equal(s.minutesSavedPerRun, 30);
  assert.equal(s.loadedCostPerHour, 2500);
});

test('resolveRoiSettings: app override wins per-field; empty field falls through', () => {
  const s = resolveRoiSettings(
    { minutesSavedPerRun: 45, loadedCostPerHour: null },
    { minutesSavedPerRun: 30, loadedCostPerHour: 2500 },
  );
  assert.equal(s.minutesSavedPerRun, 45); // app wins
  assert.equal(s.loadedCostPerHour, 2500); // app null → org default
});

test('resolveRoiSettings: non-positive/NaN overrides ignored, fall through', () => {
  const s = resolveRoiSettings(
    { minutesSavedPerRun: 0, loadedCostPerHour: NaN },
    { minutesSavedPerRun: -5, loadedCostPerHour: 0 },
  );
  assert.equal(s.minutesSavedPerRun, DEFAULT_MINUTES_SAVED_PER_RUN);
  assert.equal(s.loadedCostPerHour, DEFAULT_LOADED_COST_PER_HOUR);
});

// ─── computeAppRoi — carries id/title/dept + settings; null dept → Unassigned ─────────────────────
test('computeAppRoi: attaches identity + resolved estimates; null dept → Unassigned', () => {
  const a = computeAppRoi({
    appId: 'app_1',
    appTitle: 'Actuarial Pricing',
    department: null,
    runsCompleted: 20,
    actualAiCost: 100,
    settings: { minutesSavedPerRun: 30, loadedCostPerHour: 2000 },
  });
  assert.equal(a.appId, 'app_1');
  assert.equal(a.appTitle, 'Actuarial Pricing');
  assert.equal(a.department, UNASSIGNED_ROI_DEPARTMENT);
  assert.equal(a.minutesSavedPerRun, 30);
  assert.equal(a.loadedCostPerHour, 2000);
  assert.equal(a.hoursSaved, 10); // 20×30/60
  assert.equal(a.grossValue, 20000);
  assert.equal(a.netValue, 19900);
});

test('computeAppRoi: whitespace department collapses to Unassigned', () => {
  const a = computeAppRoi({
    appId: 'x',
    appTitle: 'X',
    department: '   ',
    runsCompleted: 0,
    actualAiCost: 0,
    settings: { minutesSavedPerRun: 15, loadedCostPerHour: 1500 },
  });
  assert.equal(a.department, UNASSIGNED_ROI_DEPARTMENT);
});

// ─── rollupRoi — sum of parts equals the whole; ordering value-forward; Unassigned last ───────────
function appRoi(overrides: Partial<AppRoi> & { appId: string; department: string }): AppRoi {
  return computeAppRoi({
    appId: overrides.appId,
    appTitle: overrides.appTitle ?? overrides.appId,
    department: overrides.department,
    runsCompleted: overrides.runsCompleted ?? 0,
    actualAiCost: overrides.actualAiCost ?? 0,
    settings: {
      minutesSavedPerRun: overrides.minutesSavedPerRun ?? 60,
      loadedCostPerHour: overrides.loadedCostPerHour ?? 1000,
    },
  });
}

test('rollupRoi: department + org totals equal the sum of app rows', () => {
  const apps = [
    appRoi({ appId: 'a1', department: 'Actuarial', runsCompleted: 10, actualAiCost: 100 }), // 10h → ₹10000, net 9900
    appRoi({ appId: 'a2', department: 'Actuarial', runsCompleted: 5, actualAiCost: 50 }), // 5h → ₹5000, net 4950
    appRoi({ appId: 'a3', department: 'Underwriting', runsCompleted: 2, actualAiCost: 0 }), // 2h → ₹2000, net 2000
    appRoi({ appId: 'a4', department: UNASSIGNED_ROI_DEPARTMENT, runsCompleted: 0, actualAiCost: 0 }),
  ];
  const r = rollupRoi(apps);

  // Org totals = sum of parts.
  assert.equal(r.totals.appCount, 4);
  assert.equal(r.totals.runsCompleted, 17);
  assert.equal(r.totals.hoursSaved, 17); // 10+5+2+0
  assert.equal(r.totals.grossValue, 17000);
  assert.equal(r.totals.actualAiCost, 150);
  assert.equal(r.totals.netValue, 16850);

  // Actuarial dept aggregates its two apps.
  const act = r.byDepartment.find((d) => d.department === 'Actuarial')!;
  assert.equal(act.appCount, 2);
  assert.equal(act.hoursSaved, 15);
  assert.equal(act.grossValue, 15000);
  assert.equal(act.netValue, 14850);

  // Department net values sum to the org net.
  const deptNetSum = r.byDepartment.reduce((s, d) => s + d.netValue, 0);
  assert.equal(Math.round(deptNetSum), r.totals.netValue);

  // Value-forward ordering: Actuarial (14850) before Underwriting (2000); Unassigned last.
  assert.equal(r.byDepartment[0].department, 'Actuarial');
  assert.equal(r.byDepartment.at(-1)!.department, UNASSIGNED_ROI_DEPARTMENT);

  // topApps richest-first.
  assert.equal(r.topApps[0].appId, 'a1');
});

test('rollupRoi: empty input → all-zero totals, empty groups, null multiple', () => {
  const r = rollupRoi([]);
  assert.equal(r.totals.appCount, 0);
  assert.equal(r.totals.hoursSaved, 0);
  assert.equal(r.totals.netValue, 0);
  assert.equal(r.totals.roiMultiple, null);
  assert.deepEqual(r.byDepartment, []);
  assert.deepEqual(r.topApps, []);
});

test('rollupRoi: single named department, no Unassigned present', () => {
  const r = rollupRoi([appRoi({ appId: 'a1', department: 'Ops', runsCompleted: 1, actualAiCost: 10 })]);
  assert.equal(r.byDepartment.length, 1);
  assert.equal(r.byDepartment[0].department, 'Ops');
  assert.equal(r.byDepartment[0].roiMultiple, 100); // 1000/10
});

// ─── formatting helpers ────────────────────────────────────────────────────────────────────────────
test('formatInr: Indian grouping, ₹ prefix, negative sign', () => {
  assert.equal(formatInr(123456), '₹1,23,456');
  assert.equal(formatInr(0), '₹0');
  assert.equal(formatInr(-4400), '−₹4,400');
  assert.equal(formatInr(NaN), '₹0');
});

test('formatHours: one decimal + hrs suffix', () => {
  assert.equal(formatHours(13520), '13,520.0 hrs');
  assert.equal(formatHours(0), '0.0 hrs');
  assert.equal(formatHours(NaN), '0.0 hrs');
});

// ─── validateRoiSettingsInput ──────────────────────────────────────────────────────────────────────
test('validateRoiSettingsInput: valid body → normalised override', () => {
  const r = validateRoiSettingsInput({ minutesSavedPerRun: 30, loadedCostPerHour: 2000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { minutesSavedPerRun: 30, loadedCostPerHour: 2000 });
});

test('validateRoiSettingsInput: string numbers coerced', () => {
  const r = validateRoiSettingsInput({ minutesSavedPerRun: '45', loadedCostPerHour: '1500' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { minutesSavedPerRun: 45, loadedCostPerHour: 1500 });
});

test('validateRoiSettingsInput: omitted/empty fields → null (inherit)', () => {
  const r = validateRoiSettingsInput({ minutesSavedPerRun: '', loadedCostPerHour: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { minutesSavedPerRun: null, loadedCostPerHour: null });
});

test('validateRoiSettingsInput: non-object body rejected', () => {
  assert.equal(validateRoiSettingsInput(null).ok, false);
  assert.equal(validateRoiSettingsInput(42).ok, false);
});

test('validateRoiSettingsInput: non-numeric / non-positive / over-max rejected', () => {
  assert.equal(validateRoiSettingsInput({ minutesSavedPerRun: 'abc' }).ok, false);
  assert.equal(validateRoiSettingsInput({ minutesSavedPerRun: 0 }).ok, false);
  assert.equal(validateRoiSettingsInput({ loadedCostPerHour: -1 }).ok, false);
  assert.equal(validateRoiSettingsInput({ minutesSavedPerRun: 999999 }).ok, false);
  assert.equal(validateRoiSettingsInput({ loadedCostPerHour: 9_999_999 }).ok, false);
  const both = validateRoiSettingsInput({ minutesSavedPerRun: NaN, loadedCostPerHour: 'x' });
  assert.equal(both.ok, false);
  assert.equal(both.errors.length, 2);
});
