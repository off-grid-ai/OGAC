// ─── Prove the run list's Data column end to end ────────────────────────────────────────────────────
//
// The column rendered, the filters worked, and every row showed a dash — because NO run had happened
// since the stamp was added, and separately because dataClassification was missing from the app-runs
// VIEW entirely. An empty column is not proof of anything, and "the filter returned nothing" looked
// identical to "the filter is broken".
//
// So: run a real app end to end through the real executor, then read the run back through the SAME
// view the list reads, and check the grade and basis actually arrive.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/prove-run-list-stamp.mts

import { listApps } from '../src/lib/apps-store.ts';
import { listAppRunsView } from '../src/lib/app-runs-view-reader.ts';
import { listAllRuns } from '../src/lib/runs-monitor-reader.ts';
import { filterRuns } from '../src/lib/runs-monitor.ts';

const ORG = 'org_bharat';
const fails: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(label);
};

// Pick an app that actually binds a declared data domain — one that reads nothing would "pass" with
// nulls and prove the opposite of what is being tested.
const apps = await listApps(ORG);
const withData = apps
  .map((a) => ({
    app: a,
    domains: (a.steps ?? [])
      .filter((s: { kind?: string }) => s.kind === 'connector-query')
      .map((s: { domain?: string }) => s.domain)
      .filter((d): d is string => Boolean(d)),
  }))
  .filter((x) => x.domains.length > 0);

console.log(`${apps.length} apps · ${withData.length} bind a declared domain`);
if (!withData.length) {
  console.log('FAILED: no app in this tenant binds a data domain, so the stamp cannot be proven here');
  process.exit(1);
}
const target = withData[0];
console.log(`running "${target.app.title}" (${target.app.id}) · binds ${target.domains.join(', ')}\n`);

// runApp takes the SPEC and an explicit runId (it does not mint one) — checked against the signature
// rather than guessed, since a wrong shape here would throw and read as "the stamp does not work".
const { runApp } = await import('../src/lib/app-run.ts');
const runId = `run_proof_${Date.now().toString(36)}`;
const outcome = await runApp(target.app, {}, { orgId: ORG, actor: 'proof-script', runId }).catch(
  (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
);
console.log(`run ${runId} → ${JSON.stringify(outcome).slice(0, 220)}\n`);
check('the app run completed without throwing', !(outcome as { error?: string }).error, (outcome as { error?: string }).error ?? '');

// Read it back through the VIEW the list reads — not the raw row. The view was the broken link.
const view = (await listAppRunsView(undefined, ORG, 50)).find((r) => r.id === runId);
check('the run is visible through the app-runs view', Boolean(view));
console.log(
  `  view: classification=${view?.dataClassification} policy=v${view?.policyVersion} basis=${JSON.stringify(view?.lawfulBasis)}`,
);
check('the view carries the classification', Boolean(view?.dataClassification), String(view?.dataClassification));
check('the view carries the policy version', (view?.policyVersion ?? 0) > 0, String(view?.policyVersion));
check('the view carries the lawful basis', Boolean(view?.lawfulBasis), String(view?.lawfulBasis));

// And through the unified read model the run LIST actually renders.
const rows = await listAllRuns(ORG);
const row = rows.find((r) => r.id === runId);
check('the run reaches the unified run list', Boolean(row));
console.log(
  `  row : classification=${row?.dataClassification} basisGap=${row?.basisGap} basis=${JSON.stringify(row?.lawfulBasis)}`,
);
check('the list row carries the grade', Boolean(row?.dataClassification), String(row?.dataClassification));

// The FILTER is the feature — it has to select this run, and not select it under the wrong grade.
const grade = String(row?.dataClassification);
const byGrade = filterRuns(rows, { sensitivity: grade });
check(`?sensitivity=${grade} selects it`, byGrade.some((r) => r.id === runId), `${byGrade.length} rows`);
const wrongGrade = grade === 'confidential' ? 'public' : 'confidential';
check(`?sensitivity=${wrongGrade} does NOT select it`, !filterRuns(rows, { sensitivity: wrongGrade }).some((r) => r.id === runId));

// basisGap must reflect reality either way — a gap only when the stamp names an ungrounded source.
const gapExpected = /no basis|no lawful basis/i.test(row?.lawfulBasis ?? '');
check('basisGap matches what the basis actually says', row?.basisGap === gapExpected, `basisGap=${row?.basisGap} basis="${row?.lawfulBasis}"`);
check(
  `?basis=missing ${gapExpected ? 'selects' : 'excludes'} it`,
  filterRuns(rows, { basis: 'missing' }).some((r) => r.id === runId) === gapExpected,
);

console.log(`\n${fails.length ? `FAILED (${fails.length}): ${fails.join(' | ')}` : 'ALL CHECKS PASSED'}`);
process.exit(fails.length ? 1 : 0);
