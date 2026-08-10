// ─── Seed the INSURER's analytical warehouse (ClickHouse `suraksha` database) ───────────────────
//
// WHY. The public one-pager sends buyers to /data/warehouse on the insurer demo tenant
// (suraksha-onprem-console.getoffgridai.co). That page scopes the catalog to the viewer's own
// ClickHouse database (src/lib/warehouse-scope.ts → currentWarehouseDatabase() → the tenant slug
// `suraksha`, see src/lib/warehouse-tenancy.ts). The BANK tenant's book (`bfsi` / `bharatunion`) was
// seeded; the insurer's own database was never created at all, so the page rendered "the warehouse is
// online but holds no tables yet" with a 0/0/0/0 stat rail — the root cause diagnosed for this task.
//
// WHAT. Creates ClickHouse database `suraksha` with 8 tables in the SAME dim_/fact_ MergeTree
// convention as the live `bfsi` schema (verified against it — see the DESCRIBE TABLE dump in this
// task's investigation), but every concept is a LIFE INSURER's book — policyholders, advisors,
// branches, products, policies, premium payments (with persistency), claims, and re-KYC events —
// never bank concepts (no accounts/transactions/loans/NPA on this tenant, per dataplane-ui.ts's rule).
// Indian BFSI convention throughout: INR amounts, PAN, masked Aadhaar, IFSC, Indian names/cities.
//
// HOW. Talks straight to the ClickHouse HTTP interface (same env vars + auth as
// src/lib/adapters/warehouse.ts: OFFGRID_WAREHOUSE_URL / _USER / _PASSWORD) — no adapter import needed
// since this is a one-shot DDL+bulk-load script, not a request-scoped read. Rows are generated
// SERVER-SIDE with ClickHouse's own `numbers(N)` + random functions (INSERT ... SELECT ... FROM
// numbers(N)) rather than shipped as giant literal INSERT statements.
//
// IDEMPOTENT: CREATE DATABASE/TABLE IF NOT EXISTS, then TRUNCATE + re-INSERT each table on every run
// — safe to run twice; always ends at the same row counts (values reshuffle, shape never does).
//
// RUN (on the box, .env.local loaded):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-suraksha-warehouse.mts

const env = process.env;
const CH_URL = (env.OFFGRID_WAREHOUSE_URL || 'http://127.0.0.1:8941').replace(/\/$/, '');
const CH_USER = env.OFFGRID_WAREHOUSE_USER || 'warehouse';
const CH_PASSWORD = env.OFFGRID_WAREHOUSE_PASSWORD || 'warehouse';
const DB = 'suraksha';

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

// ── table DDL + seed (row targets span a few hundred to a few hundred thousand, per the task) ────
interface TableSpec {
  name: string;
  ddl: string;
  rows: number;
  insertSelect: string; // the SELECT body for `INSERT INTO suraksha.<name> SELECT ... FROM numbers(N)`
  orderBy: string;
}

const TABLES: TableSpec[] = [
  {
    name: 'dim_customer', // policyholders
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
        arrayElement(['Retail','Corporate','NRI','Senior Citizen'], (rand() % 4) + 1) AS segment,
        arrayElement(['verified','pending','mismatch'], (rand() % 100 < 85 ? 1 : (rand() % 2) + 2)) AS kyc_status,
        now() - toIntervalDay(rand() % 2000) AS onboarded_at
      FROM numbers(20000)`,
  },
  {
    name: 'dim_agent', // advisors
    rows: 800,
    orderBy: 'agent_id',
    ddl: `
      agent_id UInt32,
      agent_code String,
      full_name String,
      branch_id UInt32,
      city LowCardinality(String),
      tier LowCardinality(String),
      joined_at Date,
      active UInt8`,
    insertSelect: `
      SELECT
        number + 1 AS agent_id,
        concat('IRDAI-', toString(100000 + number)) AS agent_code,
        ${randFullName()} AS full_name,
        (number % 120) + 1 AS branch_id,
        arrayElement(${CITIES}, ${randCityIdx()}) AS city,
        arrayElement(['Bronze','Silver','Gold','Platinum'], (rand() % 4) + 1) AS tier,
        toDate('2016-01-01') + toIntervalDay(rand() % 3600) AS joined_at,
        if(rand() % 100 < 92, 1, 0) AS active
      FROM numbers(800)`,
  },
  {
    name: 'dim_branch', // branches
    rows: 120,
    orderBy: 'branch_id',
    ddl: `
      branch_id UInt32,
      branch_code String,
      branch_name String,
      city LowCardinality(String),
      state LowCardinality(String),
      zone LowCardinality(String)`,
    insertSelect: `
      SELECT
        number + 1 AS branch_id,
        concat('SL-BR-', lpad(toString(number + 1), 4, '0')) AS branch_code,
        concat(arrayElement(${CITIES}, ${randCityIdx()}), ' Branch') AS branch_name,
        arrayElement(${CITIES}, ${randCityIdx()}) AS city,
        arrayElement(${STATES_ALIGNED}, ${randCityIdx()}) AS state,
        arrayElement(${ZONES}, (rand() % 4) + 1) AS zone
      FROM numbers(120)`,
  },
  {
    name: 'dim_product', // insurance plans
    rows: 24,
    orderBy: 'product_id',
    ddl: `
      product_id UInt32,
      category LowCardinality(String),
      name String,
      active UInt8`,
    insertSelect: `
      SELECT
        number + 1 AS product_id,
        arrayElement(['Term','ULIP','Endowment','Pension','Health Rider'], (rand() % 5) + 1) AS category,
        concat('Suraksha ', arrayElement(['Term','ULIP','Endowment','Pension','Health Rider'], (rand() % 5) + 1), ' Plan ', toString(number + 1)) AS name,
        if(rand() % 100 < 90, 1, 0) AS active
      FROM numbers(24)`,
  },
  {
    name: 'fact_policy', // policies
    rows: 40_000,
    orderBy: 'policy_id',
    ddl: `
      policy_id UInt32,
      policy_no String,
      customer_id UInt32,
      product_id UInt32,
      agent_id UInt32,
      branch_id UInt32,
      sum_assured Decimal(18, 2),
      premium_amount_inr Decimal(18, 2),
      premium_frequency LowCardinality(String),
      status LowCardinality(String),
      issued_at Date,
      maturity_date Date`,
    insertSelect: `
      SELECT
        number + 1 AS policy_id,
        concat('SL-POL-', lpad(toString(number + 1), 8, '0')) AS policy_no,
        (number % 20000) + 1 AS customer_id,
        (number % 24) + 1 AS product_id,
        (number % 800) + 1 AS agent_id,
        (number % 120) + 1 AS branch_id,
        toDecimal64(50000 + (rand() % 4950000), 2) AS sum_assured,
        toDecimal64(2000 + (rand() % 98000), 2) AS premium_amount_inr,
        arrayElement(['Monthly','Quarterly','Half-Yearly','Yearly'], (rand() % 4) + 1) AS premium_frequency,
        arrayElement(['in-force','in-force','in-force','lapsed','matured','surrendered'], (rand() % 6) + 1) AS status,
        toDate('2015-01-01') + toIntervalDay(rand() % 4000) AS issued_at,
        toDate('2015-01-01') + toIntervalDay(rand() % 4000) + toIntervalYear(5 + rand() % 25) AS maturity_date
      FROM numbers(40000)`,
  },
  {
    name: 'fact_premium', // premium payments (persistency)
    rows: 250_000,
    orderBy: 'premium_id',
    ddl: `
      premium_id UInt64,
      policy_id UInt32,
      customer_id UInt32,
      due_date Date,
      amount_inr Decimal(18, 2),
      is_paid UInt8,
      payment_mode LowCardinality(String),
      payer_ifsc String,
      persistency_band LowCardinality(String)`,
    insertSelect: `
      SELECT
        number + 1 AS premium_id,
        (number % 40000) + 1 AS policy_id,
        ((number % 40000) % 20000) + 1 AS customer_id,
        toDate('2019-01-01') + toIntervalDay(rand() % 2400) AS due_date,
        toDecimal64(2000 + (rand() % 98000), 2) AS amount_inr,
        if(rand() % 100 < 78, 1, 0) AS is_paid,
        arrayElement(['NACH','UPI','Cheque','NEFT'], (rand() % 4) + 1) AS payment_mode,
        ${randIfsc()} AS payer_ifsc,
        arrayElement(['13th-month','25th-month','37th-month','49th-month','61st-month'], (rand() % 5) + 1) AS persistency_band
      FROM numbers(250000)`,
  },
  {
    name: 'fact_claim', // claims
    rows: 6_000,
    orderBy: 'claim_id',
    ddl: `
      claim_id UInt32,
      policy_id UInt32,
      customer_id UInt32,
      claim_type LowCardinality(String),
      claim_amount_inr Decimal(18, 2),
      settled_amount_inr Decimal(18, 2),
      status LowCardinality(String),
      filed_at Date`,
    insertSelect: `
      SELECT
        number + 1 AS claim_id,
        (number % 40000) + 1 AS policy_id,
        ((number % 40000) % 20000) + 1 AS customer_id,
        arrayElement(['Death','Maturity','Surrender','Health Rider'], (rand() % 4) + 1) AS claim_type,
        toDecimal64(50000 + (rand() % 4950000), 2) AS claim_amount_inr,
        if(rand() % 100 < 70, toDecimal64(50000 + (rand() % 4950000), 2), toDecimal64(0, 2)) AS settled_amount_inr,
        arrayElement(['filed','under-review','approved','settled','rejected'], (rand() % 5) + 1) AS status,
        toDate('2020-01-01') + toIntervalDay(rand() % 2100) AS filed_at
      FROM numbers(6000)`,
  },
  {
    name: 'fact_kyc_event', // re-KYC / onboarding events
    rows: 30_000,
    orderBy: 'event_id',
    ddl: `
      event_id UInt32,
      customer_id UInt32,
      ts DateTime,
      event_type LowCardinality(String),
      outcome LowCardinality(String)`,
    insertSelect: `
      SELECT
        number + 1 AS event_id,
        (number % 20000) + 1 AS customer_id,
        now() - toIntervalDay(rand() % 720) AS ts,
        arrayElement(['onboarding','re-kyc','address-update','nominee-update'], (rand() % 4) + 1) AS event_type,
        arrayElement(['verified','verified','verified','mismatch','pending'], (rand() % 5) + 1) AS outcome
      FROM numbers(30000)`,
  },
];

async function main() {
  console.log(`== creating database ${DB} ==`);
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
