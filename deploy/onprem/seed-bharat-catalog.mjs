#!/usr/bin/env node
// Seed the governed data CATALOG (data_assets + data_classifications) for the bharatunion tenant
// (org_id = org_bharat), one asset per bharatunion ClickHouse warehouse table.
//
// This mirrors src/lib/data-catalog-store.ts exactly: id prefixes (da_/dc_), column names, and the
// classification level vocabulary (public | internal | confidential | restricted) + PII entity tags.
// Sensitivity is `pii` in the task brief; the store's canonical vocabulary uses `confidential`/
// `restricted` for the top of the scale — we map customer/PAN/Aadhaar/account tables to `restricted`
// (they carry direct PII) or `confidential`, transactions/loans/claims to `internal`, product/branch
// reference data to `public`, matching data-classification.ts.
//
// Output: pure SQL on stdout. Pipe it into the console Postgres:
//   node deploy/onprem/seed-bharat-catalog.mjs | \
//     sshpass -e ssh admin@127.0.0.1 'docker exec -i offgrid-console-postgres-1 psql -U offgrid -d offgrid_console'
//
// Idempotent: DELETEs existing org_bharat warehouse-source assets (+ their classifications) first,
// then re-inserts. Deterministic: ids are derived from the table name, not random, so re-running
// produces identical rows.

const ORG = 'org_bharat';
const WAREHOUSE_CONNECTOR = 'bhcon_warehouse'; // the S3/MinIO warehouse object-store connector
const DB = 'bharatunion';

// Deterministic id from a stable key (no randomUUID → re-runnable). 12 hex chars like the store's
// randomUUID().slice(0,12), just derived instead of random.
function hash12(s) {
  // FNV-1a 64-bit-ish folded to 12 hex chars.
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0').slice(0, 12);
}
const assetId = (table) => `da_${hash12(`${ORG}:${DB}.${table}`)}`;
const classId = (table, col) => `dc_${hash12(`${ORG}:${DB}.${table}:${col ?? '*'}`)}`;

function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// level: public | internal | confidential | restricted (ascending sensitivity — data-classification.ts)
// One asset per warehouse table, with an asset-level default classification (column NULL) + the
// notable PII/sensitive columns called out explicitly.
const ASSETS = [
  {
    table: 'dim_customer',
    kind: 'table',
    rows: 20000,
    desc: 'Customer master — identity, PAN, KYC status, demographics. Direct PII; the most sensitive dimension.',
    level: 'restricted',
    piiTags: ['PAN', 'PERSON', 'DATE_TIME', 'LOCATION'],
    columns: [
      { column: 'pan', level: 'restricted', piiTags: ['PAN'] },
      { column: 'full_name', level: 'restricted', piiTags: ['PERSON'] },
      { column: 'dob', level: 'confidential', piiTags: ['DATE_TIME'] },
      { column: 'city', level: 'confidential', piiTags: ['LOCATION'] },
      { column: 'kyc_status', level: 'confidential', piiTags: [] },
    ],
  },
  {
    table: 'dim_branch',
    kind: 'table',
    rows: 600,
    desc: 'Branch reference dimension — IFSC, bank, city. Public reference data.',
    level: 'public',
    piiTags: [],
    columns: [{ column: 'ifsc', level: 'public', piiTags: [] }],
  },
  {
    table: 'dim_product',
    kind: 'table',
    rows: 33,
    desc: 'Product catalog — savings, loans, cards, insurance. Public reference data.',
    level: 'public',
    piiTags: [],
    columns: [],
  },
  {
    table: 'fact_account',
    kind: 'table',
    rows: 50000,
    desc: 'Account ledger — account numbers linked to customers, balances, status. Account identifiers + balances = confidential.',
    level: 'confidential',
    piiTags: ['ACCOUNT_NUMBER'],
    columns: [
      { column: 'account_no', level: 'restricted', piiTags: ['ACCOUNT_NUMBER'] },
      { column: 'balance_inr', level: 'confidential', piiTags: [] },
    ],
  },
  {
    table: 'fact_transaction',
    kind: 'table',
    rows: 600000,
    desc: 'Transaction fact — 600k debit/credit events by channel (UPI/NEFT/IMPS/ATM/POS), merchant category, and AML flag. Internal analytical data.',
    level: 'internal',
    piiTags: [],
    columns: [{ column: 'is_flagged', level: 'confidential', piiTags: [] }],
  },
  {
    table: 'fact_loan',
    kind: 'table',
    rows: 15000,
    desc: 'Loan book — principal, ROI, EMI, DPD and NPA status by product. Internal credit data.',
    level: 'internal',
    piiTags: [],
    columns: [{ column: 'dpd', level: 'confidential', piiTags: [] }],
  },
  {
    table: 'fact_claim',
    kind: 'table',
    rows: 8000,
    desc: 'Insurance claims — amount, status, and reason (health/motor). Reason text can reveal health conditions.',
    level: 'confidential',
    piiTags: ['MEDICAL'],
    columns: [{ column: 'reason', level: 'confidential', piiTags: ['MEDICAL'] }],
  },
  {
    table: 'fact_kyc_event',
    kind: 'table',
    rows: 30000,
    desc: 'KYC event log — onboarding, re-KYC, risk reviews and outcomes per customer. Compliance-sensitive.',
    level: 'confidential',
    piiTags: [],
    columns: [],
  },
];

const lines = [];
lines.push('BEGIN;');
lines.push('-- Idempotent reseed of org_bharat warehouse-source catalog assets.');

// Delete existing warehouse-source assets for this org + their dependent classifications/retention.
lines.push(
  `DELETE FROM data_classifications WHERE org_id = ${q(ORG)} AND asset_id IN (` +
    `SELECT id FROM data_assets WHERE org_id = ${q(ORG)} AND source = 'warehouse');`,
);
lines.push(
  `DELETE FROM retention_policies WHERE org_id = ${q(ORG)} AND asset_id IN (` +
    `SELECT id FROM data_assets WHERE org_id = ${q(ORG)} AND source = 'warehouse');`,
);
lines.push(`DELETE FROM data_assets WHERE org_id = ${q(ORG)} AND source = 'warehouse';`);

for (const a of ASSETS) {
  const id = assetId(a.table);
  const name = `${DB}.${a.table}`;
  lines.push(
    `INSERT INTO data_assets (id, org_id, name, source, connector_id, kind, owner, description, row_count, freshness_sla_hours, sync_status, created_at, updated_at) VALUES (` +
      `${q(id)}, ${q(ORG)}, ${q(name)}, 'warehouse', ${q(WAREHOUSE_CONNECTOR)}, ${q(a.kind)}, ` +
      `'data-platform@bharatunion.example', ${q(a.desc)}, ${a.rows}, 24, 'ok', now(), now());`,
  );

  // Asset-level default classification (column NULL).
  const defId = classId(a.table, null);
  lines.push(
    `INSERT INTO data_classifications (id, org_id, asset_id, "column", level, pii_tags, created_at, updated_at) VALUES (` +
      `${q(defId)}, ${q(ORG)}, ${q(id)}, NULL, ${q(a.level)}, ${q(JSON.stringify(a.piiTags))}::jsonb, now(), now());`,
  );

  // Per-column classifications.
  for (const c of a.columns) {
    const cid = classId(a.table, c.column);
    lines.push(
      `INSERT INTO data_classifications (id, org_id, asset_id, "column", level, pii_tags, created_at, updated_at) VALUES (` +
        `${q(cid)}, ${q(ORG)}, ${q(id)}, ${q(c.column)}, ${q(c.level)}, ${q(JSON.stringify(c.piiTags))}::jsonb, now(), now());`,
    );
  }
}

lines.push('COMMIT;');
process.stdout.write(lines.join('\n') + '\n');
