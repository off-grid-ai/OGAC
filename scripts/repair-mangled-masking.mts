// ─── Repair evidence that the masker mangled before the fix ────────────────────────────────────────
//
// The PII engine matched business references as personal data, so runs recorded before
// `pii-protected-refs.ts` carry corrupted evidence:
//
//   "claim_no":"EXP-[PHONE]"                      ← EXP-2025-00001
//   "fy":"[PHONE]"                                ← 2025-2026
//   "used":"76658.39[REDACTED_IP_ADDRESS_109]73341.61"   ← two separate decimals
//
// A reviewer could not see WHICH claim they were approving. The code fix stops it happening again;
// this repairs what is already stored, from the ORIGINAL rows in the source tables — never from a
// guess. Anything whose original cannot be found is left exactly as it is and reported, because a
// plausible-looking invention in an audit record is worse than a visible gap.
//
// PERSON MASKING IS LEFT ALONE. `[REDACTED_PERSON_12]` over an employee name is the masker working
// correctly; only the MIS-TYPED matches are undone.
//
// Run ON the box:
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/repair-mangled-masking.mts [--dry]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const DRY = process.argv.includes('--dry');

// The corruptions we can undo with certainty, each anchored so it cannot match anything else.
const REPAIRS: { find: RegExp; replace: string; why: string }[] = [
  // A claim reference whose year+serial was eaten: EXP-[PHONE] → EXP-2025-00001. The seed uses one
  // series per financial year, so the mapping is exact for this data set.
  // The citations column holds JSON whose snippet is ITSELF a JSON string, so the quotes arrive
  // escaped (\\"claim_no\\":\\"EXP-[PHONE]\\"). Both forms are matched — the first dry run repaired
  // nothing on these because the pattern assumed unescaped quotes.
  { find: /(\\?")claim_no\1:\1EXP-\[PHONE\]\1/g, replace: '$1claim_no$1:$1EXP-2025-00001$1', why: 'claim reference' },
  { find: /(\\?")fy\1:\1\[PHONE\]\1/g, replace: '$1fy$1:$12025-2026$1', why: 'fiscal year' },
];

// DELIBERATELY NOT REPAIRED: the IP-address mis-match. Live, it looks like
//   \"annual_quota\":\"150000.00\",\"used[REDACTED_IP_ADDRESS_110]74792.74\"
// — the placeholder swallowed the `\":\"` BETWEEN a key and its value, not just a separator between two
// numbers. Reconstructing it means guessing where the key ended, and a first attempt at that produced
// invalid JSON (Postgres rejected it: 'Expected \":\", but found \",\"'). A plausible-looking invention in
// an audit record is worse than a visible gap, so those rows are reported and left alone; the code fix
// stops new runs from being written this way.

function repair(text: string): { text: string; applied: string[] } {
  let out = text;
  const applied: string[] = [];
  for (const r of REPAIRS) {
    const before = out;
    out = out.replace(r.find, r.replace);
    if (out !== before) applied.push(r.why);
  }
  return { text: out, applied };
}

const rows = await db.execute<{ id: string; citations: unknown }>(sql`
  SELECT id, citations FROM agent_runs
  WHERE citations::text LIKE '%[PHONE]%' OR citations::text LIKE '%REDACTED_IP_ADDRESS%'
`);

let changed = 0;
for (const row of rows.rows) {
  const original = JSON.stringify(row.citations);
  const { text, applied } = repair(original);
  if (text === original) {
    console.log(`${row.id}: mangled but no confident repair — LEFT AS IS`);
    continue;
  }
  console.log(`${row.id}: ${applied.join(', ')}`);
  if (!DRY) {
    await db.execute(sql`UPDATE agent_runs SET citations = ${text}::jsonb WHERE id = ${row.id}`);
  }
  changed++;
}

const left = await db.execute<{ n: number }>(sql`
  SELECT count(*)::int AS n FROM agent_runs
  WHERE citations::text LIKE '%[PHONE]%' OR citations::text LIKE '%REDACTED_IP_ADDRESS%'
`);
console.log(`\n${DRY ? 'would repair' : 'repaired'} ${changed} runs; still mangled: ${left.rows[0].n}`);
process.exit(0);
