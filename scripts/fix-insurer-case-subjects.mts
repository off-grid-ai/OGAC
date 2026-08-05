import './worker-env.mts';
import { Client } from 'pg';

// The Policy Underwriting Assist app is a LIFE INSURER's proposal-underwriting surface, but every one
// of its seeded cases was worded as lending — "Personal loan application — Priya Sharma, ₹13,68,000".
// A stranger reading the insurer tenant sees a bank product on an insurance app.
//
// The replacement subjects are NOT invented: they are read from surdom_policies, the domain this app's
// own first step reads, so the queue names the same proposals the app would actually pick up. Amounts
// stay in rupees with Indian digit grouping, matching the other insurer surfaces.
const APPLY = process.argv.includes('--apply');
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

/** Indian digit grouping (last three, then pairs) — matches how the other insurer rows read. */
function inr(n: number): string {
  const s = Math.round(n).toString();
  if (s.length <= 3) return s;
  const head = s.slice(0, -3);
  const tail = s.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

// The insurer's policies live behind the surcon_coreins connector, not in the console DB, so they are
// read through the APP'S OWN case-candidates endpoint — the same path the person clicking "pick a case"
// uses. That guarantees the subjects name proposals this app can actually pick up, rather than fiction
// invented next to the real data.
// Read from a capture of that endpoint's response (fetch() cannot set `host`, which is how the console
// binds a request to a tenant, so the capture is taken with curl against the tenant subdomain).
const { readFileSync } = await import('node:fs');
const payload = JSON.parse(readFileSync('/tmp/policies.json', 'utf8')) as {
  data?: { record?: Record<string, unknown> }[];
};
const policies = {
  rows: (payload.data ?? [])
    .map((d) => d.record ?? {})
    .filter((r) => r.holder_name && r.sum_assured_inr && r.status !== 'lapsed'),
};
if (policies.rows.length === 0) throw new Error('no policies read — refusing to invent subjects');

const runs = await c.query(
  `select id, status, input from app_runs where app_id='app_c38d2c5e' order by started_at`,
);

console.log(`${runs.rows.length} run(s), ${policies.rows.length} real policy record(s)\n`);
let i = 0;
for (const r of runs.rows) {
  const p = policies.rows[i % policies.rows.length];
  i++;
  const sum = Number(p.sum_assured_inr);
  const subject = `Life proposal — ${p.holder_name}, ₹${inr(sum)} sum assured (${p.plan_type})`;
  const input = {
    ...(r.input as Record<string, unknown>),
    subject,
    policy_number: p.policy_no,
    holder_name: p.holder_name,
    plan_type: p.plan_type,
    sum_assured: sum,
    annual_premium: Number(p.annual_premium_inr),
  };
  // The lending-shaped keys the old fiction carried must GO, not just be shadowed by a new subject —
  // they are rendered as the case's fields on the run detail and would still read as a loan.
  for (const k of ['loan_amount', 'applicant_name', 'tenure_months', 'foir', 'cibil', 'emi']) {
    delete (input as Record<string, unknown>)[k];
  }
  console.log(`${r.id} [${r.status}]`);
  console.log(`   was: ${String((r.input as Record<string, unknown>).subject ?? '')}`);
  console.log(`   now: ${subject}`);
  if (APPLY) {
    await c.query(`update app_runs set input = $2 where id = $1`, [r.id, JSON.stringify(input)]);
  }
}
console.log(APPLY ? '\nAPPLIED.' : '\nDRY RUN — pass --apply.');
await c.end();
