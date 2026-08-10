// ─── Seed the BANK's analytical warehouse (ClickHouse `bharatunion` database) ────────────────────
//
// WHY. The warehouse tenancy fix (src/lib/warehouse-tenancy.ts: assertQueryInScope) closed a
// cross-tenant leak: the SQL console used to hand `FROM <other tenant>.table` straight to ClickHouse.
// Part of the fix un-qualifies each tenant's starter queries so a bare table name resolves to the
// caller's OWN database (the connection default, see src/lib/adapters/warehouse.ts). The insurer's
// side was seeded (scripts/seed-suraksha-warehouse.mts → database `suraksha`). The BANK's starter
// queries (src/lib/dataplane-ui.ts BANK_STARTER_QUERIES) reference `fact_loan`, `fact_account`,
// `fact_transaction`, `fact_kyc_event`, `dim_product`, `dim_branch` — none of which exist inside
// `bharatunion` (the bank's OWN database, named by its tenant slug). Those tables live only in a
// `bfsi` database that belongs to NEITHER tenant. This script gives the bank a real, owned warehouse
// so its starter buttons work once unqualified, instead of erroring "table not found".
//
// WHAT. Creates 7 tables inside the EXISTING `bharatunion` ClickHouse database (already holds
// HR/pricing-shaped tables — employees, candidates, helpdesk_cases, pricing_rfq, claim_documents,
// competitor_products, job_requisitions, pricing_rate_card — all left untouched) in the bank's own
// dim_/fact_ book: customers, branches, products, accounts, loans, transactions, KYC events. Column
// names are chosen to match what BANK_STARTER_QUERIES actually selects (npa_flag, outstanding_amount,
// product_name, event_time, channel, is_flagged, branch_name/city) — the schema fits the query, not
// the other way round. Indian BFSI convention: INR amounts, PAN, masked Aadhaar, IFSC, Indian
// names/cities. Bank domain only — accounts, loans, NPA, transactions — no insurance concepts.
//
// Does NOT touch the `bfsi` database or any pre-existing `bharatunion` table.
//
// HOW. Talks straight to the ClickHouse HTTP interface (same env vars + auth as
// src/lib/adapters/warehouse.ts: OFFGRID_WAREHOUSE_URL / _USER / _PASSWORD) — no adapter import
// needed since this is a one-shot DDL+bulk-load script. Rows generated SERVER-SIDE with ClickHouse's
// own `numbers(N)` + random functions (INSERT ... SELECT ... FROM numbers(N)).
//
// IDEMPOTENT: CREATE DATABASE/TABLE IF NOT EXISTS, then TRUNCATE + re-INSERT each table on every run
// — safe to run twice; always ends at the same row counts (values reshuffle, shape never does).
//
// RUN (on the box, .env.local loaded):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-bharatunion-warehouse.mts

const env = process.env;
const CH_URL = (env.OFFGRID_WAREHOUSE_URL || 'http://127.0.0.1:8941').replace(/\/$/, '');
const CH_USER = env.OFFGRID_WAREHOUSE_USER || 'warehouse';
const CH_PASSWORD = env.OFFGRID_WAREHOUSE_PASSWORD || 'warehouse';
const DB = 'bharatunion';

async function ch(sql: string): Promise<string> {
  const res = await fetch(CH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      'X-ClickHouse-User': CH_USER,
      'X-ClickHouse-Key': CH_PASSWORD,
    },
    body: sql,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`clickhouse ${res.status} on:\n${sql}\n---\n${detail.slice(0, 500)}`);
  }
  return res.text();
}

// ── random-value SQL fragments (Indian BFSI convention) ─────────────────────────────────────────
const LETTERS = "['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z']";
const randLetter = () => `arrayElement(${LETTERS}, (rand() % 26) + 1)`;

// A syntactically-plausible PAN: AAAAA9999A.
const randPan = () =>
  `concat(${randLetter()}, ${randLetter()}, ${randLetter()}, ${randLetter()}, ${randLetter()}, toString(1000 + rand() % 9000), ${randLetter()})`;

// Masked Aadhaar: real ones only ever show the last 4 digits.
const randAadhaarMasked = () => `concat('XXXX XXXX ', toString(1000 + rand() % 9000))`;

const BANK_CODES = "['HDFC','ICIC','SBIN','AXIS','KKBK','PUNB','BARB','UTIB','IDFB','YESB']";
const randIfsc = () => `concat(arrayElement(${BANK_CODES}, (rand() % 10) + 1), '0', lpad(toString(rand() % 999999), 6, '0'))`;

const FIRST_NAMES =
  "['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Krishna','Ishaan','Rohan'," +
  "'Ananya','Diya','Saanvi','Aadhya','Kiara','Myra','Pari','Anika','Ira','Riya'," +
  "'Rajesh','Suresh','Ramesh','Mahesh','Vijay','Sanjay','Anil','Sunil','Deepak','Ashok'," +
  "'Priya','Neha','Pooja','Kavita','Sunita','Meena','Rekha','Anita','Shalini','Nisha']";
const LAST_NAMES =
  "['Sharma','Verma','Gupta','Iyer','Nair','Reddy','Menon','Rao','Patel','Shah'," +
  "'Kulkarni','Deshmukh','Joshi','Chatterjee','Banerjee','Mukherjee','Pillai','Naidu','Agarwal','Bose']";
const randFullName = () =>
  `concat(arrayElement(${FIRST_NAMES}, (rand() % 40) + 1), ' ', arrayElement(${LAST_NAMES}, (rand() % 20) + 1))`;

const CITY_STATE: [string, string][] = [
  ['Mumbai', 'Maharashtra'],
  ['Pune', 'Maharashtra'],
  ['Delhi', 'Delhi'],
  ['Bengaluru', 'Karnataka'],
  ['Chennai', 'Tamil Nadu'],
  ['Kolkata', 'West Bengal'],
  ['Hyderabad', 'Telangana'],
  ['Ahmedabad', 'Gujarat'],
  ['Jaipur', 'Rajasthan'],
  ['Lucknow', 'Uttar Pradesh'],
  ['Chandigarh', 'Punjab'],
  ['Kochi', 'Kerala'],
  ['Bhopal', 'Madhya Pradesh'],
  ['Patna', 'Bihar'],
  ['Guwahati', 'Assam'],
];
const CITIES = `[${CITY_STATE.map(([c]) => `'${c}'`).join(',')}]`;
const STATES_ALIGNED = `[${CITY_STATE.map(([, s]) => `'${s}'`).join(',')}]`;
// Pick one city index and reuse it for the matching state so city/state stay consistent per row.
const randCityIdx = () => `((rand() % ${CITY_STATE.length}) + 1)`;

const ZONES = "['North','South','East','West']";

// Product catalogue: deposit products (1-6) feed fact_account; loan/card products (7-14) feed
// fact_loan. Fixed, curated names — deterministic by product_id, not random.
const PRODUCT_NAMES =
  "['Savings Account - Regular','Savings Account - Premium','Current Account - MSME'," +
  "'Current Account - Corporate','Fixed Deposit','Recurring Deposit'," +
  "'Personal Loan','Home Loan','Gold Loan','Auto Loan','Education Loan','MSME Business Loan'," +
  "'Credit Card - Classic','Credit Card - Platinum']";
const PRODUCT_CATEGORIES =
  "['Deposit','Deposit','Deposit','Deposit','Deposit','Deposit'," +
  "'Loan','Loan','Loan','Loan','Loan','Loan','Card','Card']";

// ── table DDL + seed (row targets per the task's scale guide) ───────────────────────────────────
interface TableSpec {
  name: string;
  ddl: string;
  rows: number;
  insertSelect: string; // the SELECT body for `INSERT INTO bharatunion.<name> SELECT ... FROM numbers(N)`
  orderBy: string;
}

const TABLES: TableSpec[] = [
  {
    name: 'dim_customer',
    rows: 20_000,
    orderBy: 'customer_id',
    ddl: `
      customer_id UInt32,
      pan String,
      aadhaar_masked String,
      full_name String,
      gender LowCardinality(String),
      dob Date32,
      city LowCardinality(String),
      state LowCardinality(String),
      segment LowCardinality(String),
      kyc_status LowCardinality(String),
      onboarded_at DateTime`,
    insertSelect: `
      SELECT
        number + 1 AS customer_id,
        ${randPan()} AS pan,
        ${randAadhaarMasked()} AS aadhaar_masked,
        ${randFullName()} AS full_name,
        arrayElement(['Male','Female'], (rand() % 2) + 1) AS gender,
        toDate32('1955-01-01') + toIntervalDay(rand() % 21000) AS dob,
        arrayElement(${CITIES}, ${randCityIdx()}) AS city,
        arrayElement(${STATES_ALIGNED}, ${randCityIdx()}) AS state,
        arrayElement(['Retail','MSME','Corporate','NRI'], (rand() % 4) + 1) AS segment,
        arrayElement(['verified','pending','mismatch'], (rand() % 100 < 85 ? 1 : (rand() % 2) + 2)) AS kyc_status,
        now() - toIntervalDay(rand() % 2000) AS onboarded_at
      FROM numbers(20000)`,
  },
  {
    name: 'dim_branch',
    rows: 130,
    orderBy: 'branch_id',
    ddl: `
      branch_id UInt32,
      ifsc String,
      branch_name String,
      city LowCardinality(String),
      state LowCardinality(String),
      zone LowCardinality(String)`,
    insertSelect: `
      SELECT
        number + 1 AS branch_id,
        ${randIfsc()} AS ifsc,
        concat(arrayElement(${CITIES}, ${randCityIdx()}), ' Branch') AS branch_name,
        arrayElement(${CITIES}, ${randCityIdx()}) AS city,
        arrayElement(${STATES_ALIGNED}, ${randCityIdx()}) AS state,
        arrayElement(${ZONES}, (rand() % 4) + 1) AS zone
      FROM numbers(130)`,
  },
  {
    name: 'dim_product',
    rows: 14,
    orderBy: 'product_id',
    ddl: `
      product_id UInt32,
      category LowCardinality(String),
      product_name String,
      active UInt8`,
    insertSelect: `
      SELECT
        number + 1 AS product_id,
        arrayElement(${PRODUCT_CATEGORIES}, number + 1) AS category,
        arrayElement(${PRODUCT_NAMES}, number + 1) AS product_name,
        if(rand() % 100 < 92, 1, 0) AS active
      FROM numbers(14)`,
  },
  {
    name: 'fact_account',
    rows: 50_000,
    orderBy: 'account_id',
    ddl: `
      account_id UInt32,
      account_no String,
      customer_id UInt32,
      product_id UInt32,
      branch_id UInt32,
      balance_inr Decimal(18, 2),
      status LowCardinality(String),
      opened_at DateTime`,
    insertSelect: `
      SELECT
        number + 1 AS account_id,
        concat('BU-ACC-', lpad(toString(number + 1), 9, '0')) AS account_no,
        (number % 20000) + 1 AS customer_id,
        (number % 6) + 1 AS product_id,
        (number % 130) + 1 AS branch_id,
        toDecimal64(500 + (rand() % 4999500), 2) AS balance_inr,
        arrayElement(['active','active','active','dormant','closed'], (rand() % 5) + 1) AS status,
        now() - toIntervalDay(rand() % 3600) AS opened_at
      FROM numbers(50000)`,
  },
  {
    name: 'fact_loan',
    rows: 15_000,
    orderBy: 'loan_id',
    ddl: `
      loan_id UInt32,
      loan_no String,
      customer_id UInt32,
      product_id UInt32,
      branch_id UInt32,
      principal_amount_inr Decimal(18, 2),
      outstanding_amount Decimal(18, 2),
      npa_flag UInt8,
      roi_pct Decimal(6, 2),
      tenure_months UInt16,
      disbursed_at Date,
      status LowCardinality(String)`,
    insertSelect: `
      SELECT
        number + 1 AS loan_id,
        concat('BU-LN-', lpad(toString(number + 1), 8, '0')) AS loan_no,
        (number % 20000) + 1 AS customer_id,
        6 + (number % 8) + 1 AS product_id,
        (number % 130) + 1 AS branch_id,
        toDecimal64(principal, 2) AS principal_amount_inr,
        toDecimal64(principal * (0.1 + (rand() % 90) / 100.0), 2) AS outstanding_amount,
        is_npa AS npa_flag,
        toDecimal64(850 + (rand() % 1350), 2) AS roi_pct,
        arrayElement([12, 24, 36, 60, 84, 120, 180, 240], (rand() % 8) + 1) AS tenure_months,
        toDate('2016-01-01') + toIntervalDay(rand() % 3600) AS disbursed_at,
        multiIf(
          is_npa = 1, 'npa',
          rand() % 100 < 4, 'written-off',
          rand() % 100 < 15, 'closed',
          'active'
        ) AS status
      FROM (
        SELECT
          number,
          50000 + (rand() % 4950000) AS principal,
          if(rand() % 100 < 8, 1, 0) AS is_npa
        FROM numbers(15000)
      )`,
  },
  {
    name: 'fact_transaction',
    rows: 600_000,
    orderBy: 'txn_id',
    ddl: `
      txn_id UInt64,
      account_id UInt32,
      customer_id UInt32,
      channel LowCardinality(String),
      direction LowCardinality(String),
      amount_inr Decimal(18, 2),
      is_flagged UInt8,
      ts DateTime`,
    insertSelect: `
      SELECT
        number + 1 AS txn_id,
        (number % 50000) + 1 AS account_id,
        ((number % 50000) % 20000) + 1 AS customer_id,
        arrayElement(['UPI','NEFT','IMPS','RTGS','ATM','POS','Branch','NetBanking'], (rand() % 8) + 1) AS channel,
        arrayElement(['credit','debit'], (rand() % 2) + 1) AS direction,
        toDecimal64(50 + (rand() % 499950), 2) AS amount_inr,
        if(rand() % 100 < 3, 1, 0) AS is_flagged,
        now() - toIntervalDay(rand() % 730) - toIntervalSecond(rand() % 86400) AS ts
      FROM numbers(600000)`,
  },
  {
    name: 'fact_kyc_event',
    rows: 30_000,
    orderBy: 'event_id',
    ddl: `
      event_id UInt32,
      customer_id UInt32,
      event_time DateTime,
      event_type LowCardinality(String),
      outcome LowCardinality(String)`,
    insertSelect: `
      SELECT
        number + 1 AS event_id,
        (number % 20000) + 1 AS customer_id,
        now() - toIntervalDay(rand() % 720) - toIntervalSecond(rand() % 86400) AS event_time,
        arrayElement(['onboarding','re-kyc','address-update','nominee-update'], (rand() % 4) + 1) AS event_type,
        arrayElement(['verified','verified','verified','mismatch','pending'], (rand() % 5) + 1) AS outcome
      FROM numbers(30000)`,
  },
];

async function main() {
  console.log(`== database ${DB} (existing HR/pricing tables left untouched) ==`);
  await ch(`CREATE DATABASE IF NOT EXISTS ${DB}`);

  for (const t of TABLES) {
    console.log(`-- ${DB}.${t.name} (target ${t.rows.toLocaleString()} rows)`);
    await ch(`CREATE TABLE IF NOT EXISTS ${DB}.${t.name} (${t.ddl}\n) ENGINE = MergeTree ORDER BY (${t.orderBy})`);
    // Idempotent re-run: clear then re-load rather than append, so a second run never doubles counts.
    await ch(`TRUNCATE TABLE ${DB}.${t.name}`);
    await ch(`INSERT INTO ${DB}.${t.name} ${t.insertSelect}`);
  }

  console.log('== verifying ==');
  const countsText = await ch(
    `SELECT name, total_rows FROM system.tables WHERE database = '${DB}' ORDER BY name FORMAT JSON`,
  );
  console.log(countsText);
}

main()
  .then(() => {
    console.log('done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
