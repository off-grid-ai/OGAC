#!/usr/bin/env node
// Seed a large, realistic Indian BFSI dataset into the live ClickHouse warehouse.
//
// Usage:  node deploy/onprem/seed-warehouse.mjs
//
// Env:
//   WAREHOUSE_URL   default http://192.168.1.60:8124   (use http://127.0.0.1:8124 on S1 loopback)
//   WAREHOUSE_USER  default warehouse
//   WAREHOUSE_PASS  default warehouse
//
// Idempotent: TRUNCATEs each table before load; RNG is seeded so output is deterministic.
// No external deps — Node stdlib + global fetch only.

const WAREHOUSE_URL = process.env.WAREHOUSE_URL || 'http://192.168.1.60:8124';
const WAREHOUSE_USER = process.env.WAREHOUSE_USER || 'warehouse';
const WAREHOUSE_PASS = process.env.WAREHOUSE_PASS || 'warehouse';
// Target database. Default `bfsi` keeps the original generic-seed behaviour unchanged; set
// WAREHOUSE_DB=<slug> to seed a per-tenant warehouse (e.g. WAREHOUSE_DB=bharatunion).
const WAREHOUSE_DB = process.env.WAREHOUSE_DB || 'bfsi';
if (!/^[a-z][a-z0-9_]*$/.test(WAREHOUSE_DB)) {
  throw new Error(`Invalid WAREHOUSE_DB "${WAREHOUSE_DB}" — must be a safe identifier ([a-z][a-z0-9_]*).`);
}
const DB = WAREHOUSE_DB;

// ------------------------------------------------------------------ HTTP
async function ch(sql, { format } = {}) {
  const url = new URL(WAREHOUSE_URL);
  url.searchParams.set('user', WAREHOUSE_USER);
  url.searchParams.set('password', WAREHOUSE_PASS);
  const res = await fetch(url, { method: 'POST', body: sql });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ClickHouse HTTP ${res.status}: ${text.slice(0, 2000)}\n--- SQL ---\n${sql.slice(0, 500)}`);
  }
  return text;
}

async function insertJSONEachRow(table, rows) {
  // rows: array of objects. Bulk insert as newline-delimited JSON.
  const header = `INSERT INTO ${table} FORMAT JSONEachRow\n`;
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  await ch(header + body);
}

// ------------------------------------------------------------------ seeded PRNG (mulberry32)
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(0x0ff9c1de);
const rnd = () => rng();
const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weightedPick(pairs) {
  // pairs: [ [value, weight], ... ]
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let x = rnd() * total;
  for (const [v, w] of pairs) {
    if ((x -= w) <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
// log-normal-ish positive amount, seeded
function logNormalAmount(medianMin, medianMax) {
  const median = medianMin + rnd() * (medianMax - medianMin);
  const sigma = 0.9;
  // Box-Muller with seeded rng
  const u1 = Math.max(rnd(), 1e-9);
  const u2 = rnd();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1, Math.round(median * Math.exp(sigma * z)));
}

// ------------------------------------------------------------------ Indian reference data
const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Kabir', 'Ayaan', 'Dhruv', 'Aryan', 'Karan', 'Rahul', 'Amit', 'Suresh', 'Ramesh', 'Vijay',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Pari', 'Anika', 'Navya', 'Aarohi', 'Myra', 'Ira',
  'Priya', 'Pooja', 'Neha', 'Kavya', 'Sneha', 'Deepika', 'Lakshmi', 'Meena', 'Sunita', 'Anjali',
  'Farhan', 'Zoya', 'Imran', 'Ayesha', 'Rehan', 'Fatima', 'Bilal', 'Zara', 'Rizwan', 'Sana',
  'Gurpreet', 'Harpreet', 'Manpreet', 'Simran', 'Jaspreet', 'Ravi', 'Manish', 'Sanjay', 'Nikhil', 'Varun',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Reddy', 'Nair', 'Menon', 'Iyer', 'Iyengar',
  'Patel', 'Shah', 'Mehta', 'Desai', 'Joshi', 'Chowdhury', 'Banerjee', 'Mukherjee', 'Das', 'Bose',
  'Rao', 'Naidu', 'Pillai', 'Kaur', 'Gill', 'Sidhu', 'Khan', 'Ahmed', 'Sheikh', 'Ansari',
  'Agarwal', 'Bansal', 'Mittal', 'Malhotra', 'Kapoor', 'Chopra', 'Bhatt', 'Trivedi', 'Pandey', 'Mishra',
];
// city -> state
const CITIES = [
  ['Mumbai', 'Maharashtra'], ['Pune', 'Maharashtra'], ['Nagpur', 'Maharashtra'],
  ['Delhi', 'Delhi'], ['New Delhi', 'Delhi'],
  ['Bengaluru', 'Karnataka'], ['Mysuru', 'Karnataka'],
  ['Chennai', 'Tamil Nadu'], ['Coimbatore', 'Tamil Nadu'], ['Madurai', 'Tamil Nadu'],
  ['Hyderabad', 'Telangana'], ['Warangal', 'Telangana'],
  ['Kolkata', 'West Bengal'], ['Howrah', 'West Bengal'],
  ['Ahmedabad', 'Gujarat'], ['Surat', 'Gujarat'], ['Vadodara', 'Gujarat'],
  ['Jaipur', 'Rajasthan'], ['Jodhpur', 'Rajasthan'],
  ['Lucknow', 'Uttar Pradesh'], ['Kanpur', 'Uttar Pradesh'], ['Noida', 'Uttar Pradesh'],
  ['Gurugram', 'Haryana'], ['Faridabad', 'Haryana'],
  ['Chandigarh', 'Chandigarh'], ['Ludhiana', 'Punjab'], ['Amritsar', 'Punjab'],
  ['Kochi', 'Kerala'], ['Thiruvananthapuram', 'Kerala'],
  ['Bhopal', 'Madhya Pradesh'], ['Indore', 'Madhya Pradesh'],
  ['Patna', 'Bihar'], ['Bhubaneswar', 'Odisha'], ['Guwahati', 'Assam'],
  ['Visakhapatnam', 'Andhra Pradesh'], ['Vijayawada', 'Andhra Pradesh'],
];
const BANKS = [
  'HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank',
  'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India', 'IndusInd Bank',
];
// bank -> IFSC 4-letter prefix
const BANK_IFSC = {
  'HDFC Bank': 'HDFC', 'ICICI Bank': 'ICIC', 'State Bank of India': 'SBIN', 'Axis Bank': 'UTIB',
  'Kotak Mahindra Bank': 'KKBK', 'Punjab National Bank': 'PUNB', 'Bank of Baroda': 'BARB',
  'Canara Bank': 'CNRB', 'Union Bank of India': 'UBIN', 'IndusInd Bank': 'INDB',
};
const MERCHANT_CATS = [
  'grocery', 'fuel', 'utilities', 'ecommerce', 'dining', 'travel', 'healthcare', 'education',
  'entertainment', 'insurance_premium', 'rent', 'salary_credit', 'investment', 'jewellery',
  'electronics', 'apparel', 'telecom', 'government', 'atm_withdrawal', 'p2p_transfer',
];
const CLAIM_REASONS = [
  'Hospitalization - cardiac', 'Hospitalization - accident', 'Vehicle collision', 'Theft',
  'Natural calamity - flood', 'Fire damage', 'Critical illness', 'Maternity', 'Death benefit',
  'Dental treatment', 'Surgery - orthopedic', 'Third-party liability',
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
function randLetters(n) { let s = ''; for (let i = 0; i < n; i++) s += LETTERS[randInt(0, 25)]; return s; }
function randDigits(n) { let s = ''; for (let i = 0; i < n; i++) s += DIGITS[randInt(0, 9)]; return s; }
function randAlnum(n) { const A = LETTERS + DIGITS; let s = ''; for (let i = 0; i < n; i++) s += A[randInt(0, A.length - 1)]; return s; }
// PAN: [A-Z]{5}[0-9]{4}[A-Z]
function genPan() { return randLetters(5) + randDigits(4) + randLetters(1); }
// IFSC: [A-Z]{4}0[A-Z0-9]{6}
function genIfsc(bank) { return (BANK_IFSC[bank] || randLetters(4)) + '0' + randAlnum(6); }

// date helpers -> ClickHouse-friendly strings
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function fmtDateTime(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }
const NOW = new Date('2026-07-04T12:00:00Z').getTime();
const DAY = 86400000;
function daysAgo(n) { return new Date(NOW - n * DAY); }

// ------------------------------------------------------------------ schema
const DDL = `
CREATE DATABASE IF NOT EXISTS ${DB};

CREATE TABLE IF NOT EXISTS ${DB}.dim_customer (
  customer_id UInt32,
  pan String,
  full_name String,
  gender LowCardinality(String),
  dob Date32,
  city LowCardinality(String),
  state LowCardinality(String),
  segment LowCardinality(String),
  kyc_status LowCardinality(String),
  onboarded_at DateTime
) ENGINE = MergeTree ORDER BY customer_id;

CREATE TABLE IF NOT EXISTS ${DB}.dim_branch (
  branch_id UInt32,
  ifsc String,
  bank_name LowCardinality(String),
  branch_name String,
  city LowCardinality(String),
  state LowCardinality(String)
) ENGINE = MergeTree ORDER BY branch_id;

CREATE TABLE IF NOT EXISTS ${DB}.dim_product (
  product_id UInt32,
  category LowCardinality(String),
  name String,
  active UInt8
) ENGINE = MergeTree ORDER BY product_id;

CREATE TABLE IF NOT EXISTS ${DB}.fact_account (
  account_id UInt32,
  account_no String,
  customer_id UInt32,
  product_id UInt32,
  branch_id UInt32,
  balance_inr Decimal(18,2),
  status LowCardinality(String),
  opened_at DateTime
) ENGINE = MergeTree ORDER BY (customer_id, account_id);

CREATE TABLE IF NOT EXISTS ${DB}.fact_transaction (
  txn_id UInt64,
  account_id UInt32,
  ts DateTime,
  amount_inr Decimal(18,2),
  direction LowCardinality(String),
  channel LowCardinality(String),
  merchant_category LowCardinality(String),
  city LowCardinality(String),
  is_flagged UInt8
) ENGINE = MergeTree PARTITION BY toYYYYMM(ts) ORDER BY (account_id, ts);

CREATE TABLE IF NOT EXISTS ${DB}.fact_loan (
  loan_id UInt32,
  customer_id UInt32,
  product_id UInt32,
  principal_inr Decimal(18,2),
  roi_pct Decimal(6,2),
  tenure_months UInt16,
  emi_inr Decimal(18,2),
  disbursed_at Date,
  dpd UInt16,
  status LowCardinality(String)
) ENGINE = MergeTree ORDER BY (customer_id, loan_id);

CREATE TABLE IF NOT EXISTS ${DB}.fact_claim (
  claim_id UInt32,
  customer_id UInt32,
  product_id UInt32,
  claim_amount_inr Decimal(18,2),
  filed_at Date,
  status LowCardinality(String),
  reason String
) ENGINE = MergeTree ORDER BY (customer_id, claim_id);

CREATE TABLE IF NOT EXISTS ${DB}.fact_kyc_event (
  event_id UInt32,
  customer_id UInt32,
  ts DateTime,
  event_type LowCardinality(String),
  outcome LowCardinality(String)
) ENGINE = MergeTree ORDER BY (customer_id, event_id);
`;

// ------------------------------------------------------------------ counts
const N_CUSTOMER = 20000;
const N_BRANCH = 600;
const N_ACCOUNT = 50000;
const N_TXN = 600000;
const N_LOAN = 15000;
const N_CLAIM = 8000;
const N_KYC = 30000;

const BATCH = 5000;

// generated dimension caches (for FK realism)
let branches = [];
let products = [];
let accountIds = []; // list of {account_id, city}
let customerIds = [];

// ------------------------------------------------------------------ generators
function genCustomers() {
  const rows = [];
  for (let i = 1; i <= N_CUSTOMER; i++) {
    const [city, state] = pick(CITIES);
    const gender = weightedPick([['M', 52], ['F', 47], ['O', 1]]);
    const fn = pick(FIRST_NAMES);
    const ln = pick(LAST_NAMES);
    const ageYears = randInt(19, 78);
    const dob = new Date(NOW - ageYears * 365 * DAY - randInt(0, 364) * DAY);
    const onboardDaysAgo = randInt(1, 365 * 8);
    rows.push({
      customer_id: i,
      pan: genPan(),
      full_name: `${fn} ${ln}`,
      gender,
      dob: fmtDate(dob),
      city, state,
      segment: weightedPick([['retail', 70], ['hni', 8], ['sme', 15], ['corporate', 7]]),
      kyc_status: weightedPick([['verified', 82], ['pending', 12], ['expired', 6]]),
      onboarded_at: fmtDateTime(daysAgo(onboardDaysAgo)),
    });
    customerIds.push(i);
  }
  return rows;
}

function genBranches() {
  const rows = [];
  for (let i = 1; i <= N_BRANCH; i++) {
    const bank = pick(BANKS);
    const [city, state] = pick(CITIES);
    const b = {
      branch_id: i,
      ifsc: genIfsc(bank),
      bank_name: bank,
      branch_name: `${city} ${pick(['Main', 'Central', 'MG Road', 'Nagar', 'Market', 'Industrial Area', 'City Centre', 'East', 'West'])} Branch`,
      city, state,
    };
    rows.push(b);
    branches.push(b);
  }
  return rows;
}

const PRODUCT_DEFS = [
  ['savings', ['Regular Savings', 'Salary Savings', 'Senior Citizen Savings', 'Zero-Balance Savings', 'Womens Savings']],
  ['current', ['Business Current', 'Premium Current', 'Startup Current']],
  ['credit_card', ['Platinum Credit Card', 'Cashback Credit Card', 'Travel Credit Card', 'Business Credit Card', 'Fuel Credit Card']],
  ['personal_loan', ['Personal Loan Express', 'Personal Loan Flexi', 'Wedding Loan']],
  ['home_loan', ['Home Loan Regular', 'Home Loan Balance Transfer', 'Plot Loan']],
  ['auto_loan', ['Car Loan', 'Two-Wheeler Loan', 'Used Car Loan']],
  ['term_deposit', ['Fixed Deposit', 'Recurring Deposit', 'Tax-Saver FD']],
  ['life_insurance', ['Term Life Plan', 'ULIP Growth', 'Endowment Plan', 'Money-Back Plan']],
  ['health_insurance', ['Family Floater Health', 'Individual Health', 'Critical Illness Cover', 'Senior Health Plan']],
];
function genProducts() {
  const rows = [];
  let id = 1;
  for (const [cat, names] of PRODUCT_DEFS) {
    for (const name of names) {
      const p = { product_id: id, category: cat, name, active: weightedPick([[1, 92], [0, 8]]) };
      rows.push(p);
      products.push(p);
      id++;
    }
  }
  return rows;
}

// products usable for deposit/transaction accounts
const ACCOUNT_PRODUCT_CATS = ['savings', 'current', 'credit_card', 'term_deposit'];
const LOAN_PRODUCT_CATS = ['personal_loan', 'home_loan', 'auto_loan'];
const INSURANCE_PRODUCT_CATS = ['life_insurance', 'health_insurance'];

function genAccounts() {
  const rows = [];
  const acctProducts = products.filter((p) => ACCOUNT_PRODUCT_CATS.includes(p.category));
  for (let i = 1; i <= N_ACCOUNT; i++) {
    const custId = randInt(1, N_CUSTOMER);
    const prod = pick(acctProducts);
    const branch = pick(branches);
    let balance;
    if (prod.category === 'credit_card') {
      balance = -logNormalAmount(2000, 40000); // outstanding
      if (rnd() < 0.4) balance = 0; // paid off
    } else if (prod.category === 'term_deposit') {
      balance = logNormalAmount(50000, 500000);
    } else {
      balance = logNormalAmount(3000, 120000);
    }
    rows.push({
      account_id: i,
      account_no: randDigits(randInt(11, 14)),
      customer_id: custId,
      product_id: prod.product_id,
      branch_id: branch.branch_id,
      balance_inr: (balance).toFixed(2),
      status: weightedPick([['active', 80], ['dormant', 12], ['frozen', 3], ['closed', 5]]),
      opened_at: fmtDateTime(daysAgo(randInt(1, 365 * 7))),
    });
    accountIds.push({ account_id: i, city: branch.city });
  }
  return rows;
}

function genTransactionsBatch(startId, count) {
  const rows = [];
  const debitCats = MERCHANT_CATS.filter((c) => c !== 'salary_credit');
  for (let k = 0; k < count; k++) {
    const acct = accountIds[randInt(0, accountIds.length - 1)];
    const direction = weightedPick([['debit', 68], ['credit', 32]]);
    const channel = weightedPick([
      ['UPI', 42], ['NEFT', 12], ['IMPS', 10], ['ATM', 12], ['POS', 14], ['cheque', 3], ['branch', 7],
    ]);
    let merchant;
    let amount;
    if (direction === 'credit') {
      merchant = weightedPick([['salary_credit', 30], ['p2p_transfer', 25], ['investment', 10], ['government', 8], ['insurance_premium', 5]]);
      amount = merchant === 'salary_credit' ? logNormalAmount(25000, 120000) : logNormalAmount(500, 25000);
    } else {
      merchant = pick(debitCats);
      if (channel === 'ATM') amount = randInt(1, 20) * 500;
      else if (channel === 'UPI') amount = logNormalAmount(50, 2000);
      else amount = logNormalAmount(200, 15000);
    }
    // spread over last ~18 months (548 days)
    const ts = daysAgo(randInt(0, 548) + rnd());
    rows.push({
      txn_id: startId + k,
      account_id: acct.account_id,
      ts: fmtDateTime(ts),
      amount_inr: amount.toFixed(2),
      direction,
      channel,
      merchant_category: merchant,
      city: acct.city,
      is_flagged: rnd() < 0.005 ? 1 : 0,
    });
  }
  return rows;
}

function genLoans() {
  const rows = [];
  const loanProducts = products.filter((p) => LOAN_PRODUCT_CATS.includes(p.category));
  for (let i = 1; i <= N_LOAN; i++) {
    const prod = pick(loanProducts);
    let principal, roi, tenure;
    if (prod.category === 'home_loan') { principal = logNormalAmount(1500000, 8000000); roi = 8 + rnd() * 2.5; tenure = pick([120, 180, 240, 300, 360]); }
    else if (prod.category === 'auto_loan') { principal = logNormalAmount(300000, 1500000); roi = 9 + rnd() * 3; tenure = pick([36, 48, 60, 84]); }
    else { principal = logNormalAmount(50000, 1500000); roi = 11 + rnd() * 6; tenure = pick([12, 24, 36, 48, 60]); }
    roi = Math.round(roi * 100) / 100;
    const r = roi / 1200;
    const emi = Math.round((principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1));
    const status = weightedPick([['active', 78], ['closed', 15], ['npa', 7]]);
    let dpd = 0;
    if (status === 'npa') dpd = randInt(91, 720);
    else if (status === 'active') dpd = weightedPick([[0, 82], [randInt(1, 30), 12], [randInt(31, 89), 6]]);
    rows.push({
      loan_id: i,
      customer_id: randInt(1, N_CUSTOMER),
      product_id: prod.product_id,
      principal_inr: principal.toFixed(2),
      roi_pct: roi.toFixed(2),
      tenure_months: tenure,
      emi_inr: emi.toFixed(2),
      disbursed_at: fmtDate(daysAgo(randInt(30, 365 * 6))),
      dpd,
      status,
    });
  }
  return rows;
}

function genClaims() {
  const rows = [];
  const insProducts = products.filter((p) => INSURANCE_PRODUCT_CATS.includes(p.category));
  for (let i = 1; i <= N_CLAIM; i++) {
    const prod = pick(insProducts);
    rows.push({
      claim_id: i,
      customer_id: randInt(1, N_CUSTOMER),
      product_id: prod.product_id,
      claim_amount_inr: logNormalAmount(15000, 400000).toFixed(2),
      filed_at: fmtDate(daysAgo(randInt(1, 540))),
      status: weightedPick([['filed', 15], ['under_review', 20], ['approved', 18], ['rejected', 12], ['paid', 35]]),
      reason: pick(CLAIM_REASONS),
    });
  }
  return rows;
}

function genKycEvents() {
  const rows = [];
  for (let i = 1; i <= N_KYC; i++) {
    rows.push({
      event_id: i,
      customer_id: randInt(1, N_CUSTOMER),
      ts: fmtDateTime(daysAgo(randInt(0, 365 * 8))),
      event_type: weightedPick([['onboard', 35], ['re_kyc', 25], ['document_update', 25], ['risk_review', 15]]),
      outcome: weightedPick([['pass', 78], ['fail', 8], ['manual', 14]]),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ load helpers
async function loadTable(table, rows) {
  await ch(`TRUNCATE TABLE IF EXISTS ${table}`);
  for (let i = 0; i < rows.length; i += BATCH) {
    await insertJSONEachRow(table, rows.slice(i, i + BATCH));
    process.stdout.write(`\r  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}   `);
  }
  process.stdout.write('\n');
}

// stream a large synthetic table without materializing all rows at once
async function loadStreamed(table, total, genBatchFn) {
  await ch(`TRUNCATE TABLE IF EXISTS ${table}`);
  let done = 0;
  while (done < total) {
    const n = Math.min(BATCH, total - done);
    const rows = genBatchFn(done + 1, n);
    await insertJSONEachRow(table, rows);
    done += n;
    process.stdout.write(`\r  ${table}: ${done}/${total}   `);
  }
  process.stdout.write('\n');
}

// ------------------------------------------------------------------ main
async function main() {
  console.log(`Warehouse: ${WAREHOUSE_URL} (user=${WAREHOUSE_USER}) db=${DB}`);
  console.log(`Creating schema (${DB}.*) ...`);
  // run DDL statements one at a time
  for (const stmt of DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await ch(stmt);
  }

  console.log('Generating + loading dimensions ...');
  await loadTable(`${DB}.dim_customer`, genCustomers());
  await loadTable(`${DB}.dim_branch`, genBranches());
  await loadTable(`${DB}.dim_product`, genProducts());

  console.log('Generating + loading facts ...');
  await loadTable(`${DB}.fact_account`, genAccounts());
  await loadStreamed(`${DB}.fact_transaction`, N_TXN, genTransactionsBatch);
  await loadTable(`${DB}.fact_loan`, genLoans());
  await loadTable(`${DB}.fact_claim`, genClaims());
  await loadTable(`${DB}.fact_kyc_event`, genKycEvents());

  // ---------------------------------------------------------------- verify
  const expected = {
    [`${DB}.dim_customer`]: N_CUSTOMER,
    [`${DB}.dim_branch`]: N_BRANCH,
    [`${DB}.dim_product`]: products.length,
    [`${DB}.fact_account`]: N_ACCOUNT,
    [`${DB}.fact_transaction`]: N_TXN,
    [`${DB}.fact_loan`]: N_LOAN,
    [`${DB}.fact_claim`]: N_CLAIM,
    [`${DB}.fact_kyc_event`]: N_KYC,
  };

  console.log('\nVerification (expected vs actual):');
  console.log('  table'.padEnd(28), 'expected'.padStart(10), 'actual'.padStart(10), '  ok');
  let ok = true;
  for (const [table, exp] of Object.entries(expected)) {
    const actual = parseInt((await ch(`SELECT count() FROM ${table}`)).trim(), 10);
    const match = actual === exp;
    if (!match) ok = false;
    console.log('  ' + table.padEnd(26), String(exp).padStart(10), String(actual).padStart(10), '  ' + (match ? 'OK' : 'MISMATCH'));
  }

  if (!ok) {
    console.error('\nFAILED: one or more tables did not reach target volume.');
    process.exit(1);
  }
  console.log('\nAll tables at target volume.');
}

main().catch((e) => { console.error('\n' + (e && e.stack || e)); process.exit(1); });
