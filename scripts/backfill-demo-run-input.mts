// ─── Give the demo tenants' runs a real case to be about ────────────────────────────────────────────
//
// WHY. ~100 seeded app_runs across both demo tenants had no `input` recorded, so the work screen had
// nothing to summarise and every one of those rows read "Case ab12cd". A queue of near-identical rows
// is unusable for the non-technical persona in docs/APP_AS_PRODUCT.md: you cannot tell which case is
// yours, whether two rows are the same claim, or what any of them concern.
//
// WHAT. Fills `input` per PROCESS with synthetic Indian-BFSI content (INR, PAN, IFSC-shaped, Indian
// names) so each case reads like the real work the app automates.
//
// Every generated input carries BOTH:
//   - `subject` — the human line the work screen shows, with the currency symbol. The symbol belongs
//     in tenant DATA, not in the generic formatter, which cannot know a tenant's currency.
//   - structured fields — what the review and run-detail screens read.
//
// SAFETY. Only rows whose input is genuinely absent ({} / null) are touched; a run carrying real input
// is never overwritten. Deterministic: the sample is chosen by hashing the run id, so a re-run produces
// the SAME content and the script is idempotent. Nothing but `input` is written — statuses, timestamps
// and step traces are left exactly as they are.
//
// RUN: npx tsx scripts/backfill-demo-run-input.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

/** Stable index from a run id — same run always gets the same case. */
function pick<T>(runId: string, list: readonly T[]): T {
  let h = 2166136261;
  for (let i = 0; i < runId.length; i++) {
    h ^= runId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return list[h % list.length] as T;
}

const NAMES = [
  'Priya Sharma', 'Sanjay Rao', 'Fatima Khan', 'Ishaan Kulkarni', 'Ananya Iyer',
  'Rahul Menon', 'Kavya Reddy', 'Arjun Nair', 'Meera Joshi', 'Vikram Desai',
  'Neha Gupta', 'Aditya Bose', 'Sneha Pillai', 'Rohan Chatterjee', 'Divya Krishnan',
] as const;

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** One generator per process. Keyed on the app title, matched case-insensitively by substring. */
const GENERATORS: readonly { match: RegExp; build: (runId: string) => Record<string, unknown> }[] = [
  {
    match: /reimbursement/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const kind = pick(id + 'k', ['Travel', 'Client meal', 'Training course', 'Home office', 'Mobile bill'] as const);
      const amount = 2500 + (pick(id + 'a', [1, 3, 7, 11, 19, 24, 37, 48] as const) * 1237);
      return {
        subject: `${kind} reimbursement — ${name}, ${inr(amount)}`,
        employee_name: name, expense_type: kind, claim_amount: amount,
        cost_centre: pick(id + 'c', ['Retail Banking', 'Operations', 'Risk', 'Sales'] as const),
      };
    },
  },
  {
    match: /kyc/i,
    build: (id) => {
      const name = pick(id, NAMES);
      return {
        subject: `Re-KYC verification — ${name}`,
        customer_name: name,
        pan: `${['ABCDE', 'PQRSX', 'LMNOP', 'ZYXWV'][id.charCodeAt(0) % 4]}${1000 + (id.charCodeAt(1) % 9000)}F`,
        branch: pick(id + 'b', ['Andheri East', 'Koramangala', 'Salt Lake', 'Banjara Hills'] as const),
        ifsc: `BHUN0${100000 + (id.charCodeAt(2) % 899999)}`.slice(0, 11),
      };
    },
  },
  {
    match: /loan underwriting|underwriting assist/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const amount = 150000 + pick(id + 'l', [1, 4, 9, 14, 22, 31] as const) * 87000;
      return {
        subject: `Personal loan application — ${name}, ${inr(amount)}`,
        applicant_name: name, loan_amount: amount,
        tenure_months: pick(id + 't', [24, 36, 48, 60] as const),
        cibil_band: pick(id + 'g', ['750-800', '700-749', '650-699', '800+'] as const),
      };
    },
  },
  {
    match: /fraud/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const amount = 5000 + pick(id + 'f', [2, 6, 13, 27, 44] as const) * 4300;
      return {
        subject: `Suspicious transaction — ${name}, ${inr(amount)}`,
        customer_name: name, transaction_amount: amount,
        channel: pick(id + 'ch', ['UPI', 'NEFT', 'IMPS', 'Card not present'] as const),
        flag_reason: pick(id + 'r', ['Unusual location', 'Velocity spike', 'New beneficiary', 'Odd hour'] as const),
      };
    },
  },
  {
    match: /fnol|motor.?claim/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const amount = 18000 + pick(id + 'm', [1, 5, 11, 20, 33] as const) * 12500;
      return {
        subject: `Motor claim intimation — ${name}, ${inr(amount)} estimate`,
        policyholder_name: name, estimated_amount: amount,
        vehicle: pick(id + 'v', ['Maruti Swift', 'Hyundai i20', 'Tata Nexon', 'Honda City'] as const),
        policy_number: `MTR${400000 + (id.charCodeAt(0) * 37) % 599999}`,
      };
    },
  },
  {
    match: /delinquency|collections/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const amount = 8000 + pick(id + 'd', [1, 3, 8, 17, 29] as const) * 6400;
      return {
        subject: `Overdue account — ${name}, ${inr(amount)}`,
        customer_name: name, overdue_amount: amount,
        days_past_due: pick(id + 'p', [12, 31, 46, 68, 91] as const),
      };
    },
  },
  {
    match: /death.?claim/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const assured = 500000 + pick(id + 's', [1, 2, 5, 9] as const) * 750000;
      return {
        subject: `Death claim assessment — nominee ${name}, ${inr(assured)} sum assured`,
        claimant_name: name, sum_assured: assured,
        policy_number: `SLF${700000 + (id.charCodeAt(0) * 53) % 299999}`,
      };
    },
  },
  {
    match: /renewal|persistency/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const premium = 12000 + pick(id + 'r', [1, 3, 6, 11] as const) * 9500;
      return {
        subject: `Renewal due — ${name}, ${inr(premium)} premium`,
        policyholder_name: name, premium,
        days_to_lapse: pick(id + 'x', [7, 14, 21, 30] as const),
      };
    },
  },
  {
    match: /grievance/i,
    build: (id) => {
      const name = pick(id, NAMES);
      const issue = pick(id + 'g', [
        'Claim settled lower than expected',
        'Premium debited twice',
        'Policy document not received',
        'Agent unreachable for endorsement',
      ] as const);
      return {
        subject: `${issue} — ${name}`,
        customer_name: name, grievance: issue,
        channel: pick(id + 'c', ['Email', 'WhatsApp', 'Branch walk-in', 'Call centre'] as const),
      };
    },
  },
  {
    match: /cross.?sell/i,
    build: (id) => {
      const name = pick(id, NAMES);
      return {
        subject: `Next-best-product review — ${name}`,
        customer_name: name,
        segment: pick(id + 's', ['Priority', 'Affluent salary', 'Self-employed', 'Mass retail'] as const),
      };
    },
  },
];

const rows = (await db.execute(sql`
  SELECT r.id, r.app_id, a.title, r.org_id
  FROM app_runs r JOIN apps a ON a.id = r.app_id
  WHERE r.org_id IN ('org_bharat','org_suraksha')
    AND (r.input IS NULL OR r.input::text IN ('{}', 'null', '""'))
`)) as unknown as { rows: { id: string; title: string; org_id: string }[] };

let filled = 0;
const unmatched = new Map<string, number>();

for (const row of rows.rows ?? []) {
  const generator = GENERATORS.find((g) => g.match.test(row.title));
  if (!generator) {
    // Reported, never guessed: inventing a generic case for an unknown process would put words in the
    // mouth of a workflow we do not understand.
    unmatched.set(row.title, (unmatched.get(row.title) ?? 0) + 1);
    continue;
  }
  const input = generator.build(row.id);
  await db.execute(sql`UPDATE app_runs SET input = ${JSON.stringify(input)}::jsonb WHERE id = ${row.id}`);
  filled += 1;
}

console.log(`filled input on ${filled} of ${rows.rows?.length ?? 0} runs that had none`);
if (unmatched.size > 0) {
  console.log('no generator for these processes (left untouched):');
  for (const [title, n] of unmatched) console.log(`  - ${title} (${n} runs)`);
}
