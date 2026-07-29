// ─── Generate a COHERENT reimbursement dataset: employees, their quota, and their claims ──────────────
//
// "Reimbursement Approval" read the ERP's VENDOR invoices — a table with no employee in it — and then read
// the employee quota table. Nothing joined the two, so the reads returned twenty unrelated invoices and
// twenty unrelated employees, and the agent could only say it had insufficient data. It was right.
//
// The missing entity is the claim itself: one employee, one category, one amount, a status. And the two
// tables have to AGREE — same employee ids, same names, and a quota line for every category a claim can be
// filed under. Seeding them separately is how you get a claim from "Kabir Joshi" checked against a quota row
// that says "Aarav Iyer", or a Training claim with no Training quota to check against. So both tables are
// emitted from ONE source here, and consistency is a property of the generator rather than a hope.
//
// Emits SQL on stdout. Deterministic — no Date.now(), no Math.random(): a re-run produces byte-identical
// SQL, so re-seeding is idempotent and reviewable.
//
// RUN: npx tsx scripts/gen-expense-claims-sql.mts <database> > claims.sql

const database = process.argv[2] ?? 'policyadmin';

// Indian BFSI demo data (see the tenant seeding note): Indian names, INR amounts, real expense categories.
const FIRST = ['Ananya', 'Aarav', 'Vikram', 'Meera', 'Neha', 'Rohan', 'Priya', 'Kabir', 'Ishita', 'Arjun',
  'Divya', 'Siddharth', 'Kavya', 'Nikhil', 'Sneha', 'Rahul', 'Pooja', 'Aditya', 'Ritu', 'Manish'];
const LAST = ['Gupta', 'Iyer', 'Sharma', 'Reddy', 'Mehta', 'Desai', 'Nair', 'Patel', 'Joshi', 'Rao',
  'Chatterjee', 'Kulkarni', 'Bose', 'Malhotra', 'Pillai'];
const CATEGORIES = ['Travel', 'Medical', 'LTA', 'Communication', 'Training', 'Relocation'] as const;
/** Annual entitlement per category, in INR — a real policy has different limits per head. */
const ANNUAL_QUOTA: Record<string, number> = {
  Travel: 150000,
  Medical: 100000,
  LTA: 120000,
  Communication: 36000,
  Training: 200000,
  Relocation: 250000,
};
const PURPOSE: Record<string, string[]> = {
  Travel: ['Client visit — Mumbai to Bengaluru', 'Branch audit travel — Pune', 'Regional review — Hyderabad'],
  Medical: ['Diagnostic tests — dependent parent', 'Day-care procedure', 'Annual health check-up'],
  LTA: ['Family leave travel — Kochi', 'Leave travel — Jaipur', 'Leave travel — Guwahati'],
  Communication: ['Broadband reimbursement — Q1', 'Mobile plan reimbursement — Q2', 'Home office internet'],
  Training: ['CFA Level II registration', 'Risk analytics certification', 'AML compliance course'],
  Relocation: ['Household shifting — Chennai posting', 'Temporary accommodation — 14 days', 'Transfer travel'],
};
// A real desk is mostly open work with a tail of settled claims — settled ones are what the case picker
// filters out, so the demo needs both to prove the filter is doing something.
const STATUSES = ['submitted', 'submitted', 'submitted', 'submitted', 'under_review', 'approved', 'rejected', 'paid'];

const EMPLOYEES = 60;
const CLAIMS = 240;

/** Deterministic pseudo-random in [0,1) from an integer — replaces Math.random so re-runs are identical. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function pick<T>(items: readonly T[], seed: number): T {
  return items[Math.floor(rand(seed) * items.length) % items.length];
}
function esc(value: string): string {
  return value.replace(/'/g, "''");
}

// ── One roster, used by BOTH tables. This is what keeps the names consistent. ──
const employeeName = new Map<number, string>();
for (let id = 1; id <= EMPLOYEES; id++) {
  employeeName.set(id, `${pick(FIRST, id * 3 + 1)} ${pick(LAST, id * 7 + 2)}`);
}

// ── Quota: one line per employee PER CATEGORY, so every claim has a line to check against. ──
const quotaRows: string[] = [];
const remainingByKey = new Map<string, number>();
let quotaId = 0;
for (let employeeId = 1; employeeId <= EMPLOYEES; employeeId++) {
  for (const category of CATEGORIES) {
    quotaId += 1;
    const annual = ANNUAL_QUOTA[category];
    // Spend between 0% and 85% of the entitlement, so some employees are comfortably within quota and
    // some are close to the edge — a demo where every claim passes proves nothing.
    const used = Math.round(annual * rand(quotaId * 37 + 3) * 0.85 * 100) / 100;
    const remaining = Math.round((annual - used) * 100) / 100;
    remainingByKey.set(`${employeeId}:${category}`, remaining);
    quotaRows.push(
      `(${quotaId},${employeeId},'${esc(employeeName.get(employeeId)!)}','${category}',${annual.toFixed(2)},${used.toFixed(2)},${remaining.toFixed(2)},'2025-2026','bh_seed')`,
    );
  }
}

// ── Claims: reference the roster, and land on both sides of the remaining quota. ──
const claimRows: string[] = [];
for (let i = 1; i <= CLAIMS; i++) {
  const employeeId = 1 + (i % EMPLOYEES);
  const category = pick(CATEGORIES, i * 11 + 3);
  const purpose = pick(PURPOSE[category], i * 13 + 5);
  const remaining = remainingByKey.get(`${employeeId}:${category}`) ?? 50000;
  // Every 5th claim deliberately EXCEEDS what is left, so the app has genuine rejections to show and the
  // approver is making a real decision rather than rubber-stamping.
  const overspend = i % 5 === 0;
  const factor = overspend ? 1.15 + rand(i * 41) * 0.6 : 0.15 + rand(i * 43) * 0.7;
  const amount = Math.max(1200, Math.round(remaining * factor * 100) / 100);
  const status = pick(STATUSES, i * 23 + 9);
  const day = 1 + Math.floor(rand(i * 29 + 11) * 27);
  const month = 1 + Math.floor(rand(i * 31 + 13) * 12);
  const year = month >= 4 ? 2025 : 2026;
  const submitted = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const claimNo = `EXP-${year}-${String(i).padStart(5, '0')}`;

  claimRows.push(
    `(${i},'${claimNo}',${employeeId},'${esc(employeeName.get(employeeId)!)}','${category}','${esc(purpose)}',${amount.toFixed(2)},'${status}','${submitted}','2025-2026','bh_seed')`,
  );
}

console.log(`USE \`${database}\`;`);

console.log(`CREATE TABLE IF NOT EXISTS expense_claims (
  id INT PRIMARY KEY,
  claim_no VARCHAR(32) NOT NULL,
  employee_id INT NOT NULL,
  employee_name VARCHAR(128) NOT NULL,
  category VARCHAR(32) NOT NULL,
  purpose VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(24) NOT NULL,
  submitted_at DATE NOT NULL,
  fy VARCHAR(16) NOT NULL,
  source VARCHAR(32) NOT NULL,
  INDEX idx_employee (employee_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

// Reshaped, not appended: the previous quota rows had one arbitrary category per employee, so a claim in
// any other category had nothing to check against. Same schema, coherent contents. Demo tenants only.
console.log(`DELETE FROM employee_quota WHERE source = 'bh_seed' OR source IS NULL;`);
console.log(
  `INSERT INTO employee_quota (id,employee_id,employee_name,category,annual_quota,used,remaining,fy,source) VALUES\n${quotaRows.join(',\n')}\nON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id), employee_name=VALUES(employee_name), category=VALUES(category), annual_quota=VALUES(annual_quota), used=VALUES(used), remaining=VALUES(remaining);`,
);
console.log(
  `INSERT INTO expense_claims (id,claim_no,employee_id,employee_name,category,purpose,amount,status,submitted_at,fy,source) VALUES\n${claimRows.join(',\n')}\nON DUPLICATE KEY UPDATE claim_no=VALUES(claim_no), employee_id=VALUES(employee_id), employee_name=VALUES(employee_name), category=VALUES(category), purpose=VALUES(purpose), amount=VALUES(amount), status=VALUES(status), submitted_at=VALUES(submitted_at);`,
);
// The connector's own user must be able to read it — the grant is part of the seed, not a manual step.
console.log(`GRANT SELECT ON \`${database}\`.expense_claims TO 'policyadmin'@'%';`);
console.log('FLUSH PRIVILEGES;');
