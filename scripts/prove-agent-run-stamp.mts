// ─── Prove the agent-run governance stamp resolves against REAL tenant data ────────────────────────
//
// The stamp only lands on NEW agent runs, so a screenshot of existing runs proves nothing about it.
// This exercises the actual resolver against the demo tenants' real domains, and confirms the columns
// exist and the readers do not throw on them (every agent_runs read selects *, so a missing column
// would break the whole runs list rather than just the stamp).
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/prove-agent-run-stamp.mts

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { listDomains } from '../src/lib/data-domains-store.ts';
import { listAgentRuns } from '../src/lib/agentrun.ts';
import { resolveGovernanceStamp } from '../src/lib/run-governance-stamp.ts';

const ORG = 'org_bharat';
const fails: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(label);
};

// The readers must survive the new columns — this is the failure that would take out the runs list.
const runs = await listAgentRuns(5, ORG);
check('agent runs still read after the migration', Array.isArray(runs), `${runs.length} rows`);
const cols = await db.execute<{ column_name: string }>(sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'agent_runs'
    AND column_name IN ('data_classification','policy_version','lawful_basis')`);
check('all three columns were self-provisioned', cols.rows.length === 3, cols.rows.map((r) => r.column_name).join(','));

const domains = await listDomains(ORG);
const pick = (re: RegExp) => domains.find((d) => re.test(d.label));

// A GROUNDED, sensitive source: the stamp must carry both the grade and the basis.
const customers = pick(/^customers$/i) ?? pick(/customer/i);
const grounded = await resolveGovernanceStamp([customers!.id], ORG);
console.log(`\n  "${customers!.label}" → ${JSON.stringify(grounded)}`);
check('a graded source yields its classification', grounded.dataClassification === 'confidential', String(grounded.dataClassification));
check('a grounded source yields a real basis', /contract|Performing a contract/i.test(grounded.lawfulBasis ?? ''), String(grounded.lawfulBasis));
check('the policy version in force is stamped', (grounded.policyVersion ?? 0) > 0, String(grounded.policyVersion));

// An UNGROUNDED source must be reported as a gap, never defaulted to a plausible basis.
const ungrounded = domains.find((d) => !d.lawfulBasis);
const gap = await resolveGovernanceStamp([ungrounded!.id], ORG);
console.log(`  "${ungrounded!.label}" → ${JSON.stringify(gap)}`);
check('an ungrounded source reports NO basis', /no lawful basis/i.test(gap.lawfulBasis ?? ''), String(gap.lawfulBasis));
check('it is never defaulted to consent', !/consent/i.test(gap.lawfulBasis ?? ''));

// MIXED: one grounded + one not. The record must not claim the grounded basis alone.
const mixed = await resolveGovernanceStamp([customers!.id, ungrounded!.id], ORG);
console.log(`  mixed → ${JSON.stringify(mixed)}`);
check('a mixed read names the basis AND the gap', /but 1 source has no basis/i.test(mixed.lawfulBasis ?? ''), String(mixed.lawfulBasis));
check('a mixed read takes the HIGHEST classification', ['confidential', 'restricted'].includes(String(mixed.dataClassification)), String(mixed.dataClassification));

// NO declared source (an ungrounded agent, or a denied read): nulls, but still the policy version.
const none = await resolveGovernanceStamp([], ORG);
console.log(`  no source → ${JSON.stringify(none)}`);
check('no source read → no classification claimed', none.dataClassification === null);
check('no source read → no basis claimed', none.lawfulBasis === null);
check('the policy version is stamped even with no data read', (none.policyVersion ?? 0) > 0, String(none.policyVersion));

// An unknown id must not silently resolve to something.
const bogus = await resolveGovernanceStamp(['dom_does_not_exist'], ORG);
check('an unknown domain id claims nothing', bogus.dataClassification === null && bogus.lawfulBasis === null, JSON.stringify(bogus));

console.log(`\n${fails.length ? `FAILED (${fails.length}): ${fails.join(' | ')}` : 'ALL CHECKS PASSED'}`);
process.exit(fails.length ? 1 : 0);
