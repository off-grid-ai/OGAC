// ─── Record the CURRENT ruleset as the first version in the history ────────────────────────────────
//
// Policy history starts recording on the next change. That leaves the surface empty for an org that
// hasn't touched its rules since — technically honest, but it reads like the feature is off, and there
// is no baseline for a later diff to be measured against.
//
// This records what is enforced RIGHT NOW as the first version. It does NOT invent history: past runs
// are left with no policy version, because we genuinely do not know which rules applied to them, and
// the run surface says exactly that rather than attributing them to this baseline.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/record-policy-baseline.mts [--apply]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { listPolicyRules } from '../src/lib/policy-rules.ts';
import { listPolicyVersions, recordPolicyVersion } from '../src/lib/policy-versions-store.ts';

const APPLY = process.argv.includes('--apply');
const ORGS = ['org_bharat', 'org_suraksha', 'default'];

for (const org of ORGS) {
  const rules = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM policy_rules WHERE org_id = ${org}`,
  );
  const count = rules.rows[0]?.n ?? 0;
  const existing = await listPolicyVersions(org, 1);
  if (existing.length) {
    console.log(`  ${org.padEnd(14)} already has history (latest v${existing[0].version}) — skipped`);
    continue;
  }
  if (count === 0) {
    console.log(`  ${org.padEnd(14)} no policy rules — nothing to baseline`);
    continue;
  }
  if (!APPLY) {
    console.log(`  ${org.padEnd(14)} would record v1 from ${count} live rule(s)`);
    continue;
  }
  const live = await listPolicyRules(org);
  const rec = await recordPolicyVersion(live, 'baseline (recorded from live rules)', org);
  console.log(`  ${org.padEnd(14)} recorded v${rec?.version ?? '?'} · ${rec?.summary ?? 'no change'} · fingerprint ${rec?.digest ?? '—'}`);
}
process.exit(0);
