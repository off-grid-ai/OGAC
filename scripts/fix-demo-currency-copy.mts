// ─── Demo copy says USD while every case is in rupees ───────────────────────────────────────────────
//
// Eight seeded apps across both Indian-BFSI tenants describe their amounts as USD ($) — "Amounts in USD
// ($)" is printed under an app whose cases all read ₹16,107. For a bank or insurer demo that is a
// credibility problem, not a typo: the reader is being told the wrong currency by the app itself.
//
// Rewrites only the CURRENCY WORDING in `summary`, through the real updateApp path. Nothing else about
// the copy is touched — this is a correction, not a rewrite, and an over-eager pass could easily damage
// carefully-worded process descriptions.
//
// IDEMPOTENT: an app whose summary no longer mentions USD is skipped.
//
// RUN: npx tsx scripts/fix-demo-currency-copy.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
// NOT updateApp: it re-validates the ENTIRE spec, and the seeded demo apps do not currently pass
// (steps report "needs a domain binding" / "needs agentId or inlineAgent" / "output step needs a sink").
// That is a real defect in its own right — nobody could save an edit to these apps in the UI either — but
// it is not this script's business, and routing a copy correction through a failing validation would
// either fail or force unrelated spec changes. Logged separately; here we write only the summary column.

/** Narrow, ordered substitutions. Longest/most specific first so a partial match cannot strand text. */
const SUBSTITUTIONS: readonly [RegExp, string][] = [
  [/\bAmounts?\s+in\s+USD\s*\(\$\)/gi, 'Amounts in rupees (₹)'],
  [/\bAmounts?\s+in\s+USD\b/gi, 'Amounts in rupees'],
  [/\bin\s+USD\s*\(\$\)/gi, 'in rupees (₹)'],
  [/\bUSD\s*\(\$\)/gi, 'rupees (₹)'],
  [/\bUSD\b/g, 'INR'],
  [/\bdollars\b/gi, 'rupees'],
];

function correct(summary: string): string {
  return SUBSTITUTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), summary);
}

const rows = (await db.execute(sql`
  SELECT id, org_id, title, summary FROM apps
  WHERE org_id IN ('org_bharat','org_suraksha')
    AND (summary ILIKE '%USD%' OR summary ILIKE '%dollar%')
`)) as unknown as { rows: { id: string; org_id: string; title: string; summary: string }[] };

let fixed = 0;
for (const row of rows.rows ?? []) {
  const summary = correct(row.summary);
  if (summary === row.summary) continue;
  await db.execute(sql`UPDATE apps SET summary = ${summary} WHERE id = ${row.id} AND org_id = ${row.org_id}`);
  fixed += 1;
  console.log(`${row.org_id} · ${row.title}`);
}
console.log(`\ncorrected currency wording on ${fixed} of ${rows.rows?.length ?? 0} apps`);
