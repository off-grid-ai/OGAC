// ─── Demo seed: governed analytical MODELS (views) over each tenant's own warehouse ───────────────
//
// WHY. /data/warehouse/models manages governed views/materialized views over the tenant's OWN
// ClickHouse database (suraksha — 12 tables/349k rows via scripts/seed-suraksha-warehouse.mts;
// bharatunion — 7 analytics tables via scripts/seed-bharatunion-warehouse.mts, plus pre-existing
// HR/pricing tables). Live check on 2026-08-11 found:
//   • org_suraksha: 0 models — genuinely empty, "create one" placeholder.
//   • org_bharat: 1 stray model ("claims_daily", database:"default", body `SELECT today() AS d, N AS
//     claims`) — a leftover integration-test artifact. It is domain-wrong for a BANK tenant (a
//     "claims" view belongs to the insurer, never the bank — see CLAUDE.md's "never mix them" rule)
//     AND it points at ClickHouse's `default` database rather than the bank's own `bharatunion`
//     database, so it isn't a real governed model over the tenant's warehouse at all. This script
//     drops it (through the real deleteModelLive path — DROP VIEW + remove the store rows) before
//     seeding the real ones.
//
// WHAT. Three real, useful governed VIEWs per tenant, over each tenant's own database, matching the
// tenant's domain (insurer: persistency, claims, premium collection · bank: NPA exposure, deposits,
// transaction volume) — built from the tables those seed scripts already created.
//
// HOW. Calls createModelLive/deleteModelLive directly — the EXACT function the "New model" button
// and the model's "Delete" action call (src/app/api/v1/admin/warehouse/models/route.ts,
// .../[id]/route.ts) — so each model is applied live to ClickHouse (CREATE OR REPLACE VIEW) and
// recorded with its real DDL + a version history + rollback trail, never a raw INSERT.
//
// IDEMPOTENT: skips a model whose (orgId, name) already exists; only drops the stray "claims_daily"
// once (a re-run finds it already gone and does nothing).
//
// RUN (on the box, .env.local loaded):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-warehouse-models.mts
import './worker-env.mts';
import { listModels } from '../src/lib/schema-model-store.ts';
import { createModelLive, deleteModelLive, type CreateInput } from '../src/lib/warehouse-model-service.ts';

const log = (...a: unknown[]) => console.log('[seed:warehouse-models]', ...a);

// The leftover test artifact found live on org_bharat — wrong domain (claims on a bank), wrong
// database ("default" instead of "bharatunion"). Removed by NAME + DATABASE so this only ever
// touches that exact stray row, never a real model an operator might later name the same thing.
const STRAY_BHARAT_MODEL = { orgId: 'org_bharat', name: 'claims_daily', database: 'default' };

interface Seed {
  orgId: string;
  database: string;
  name: string;
  note: string;
  input: Omit<CreateInput, 'note'>;
}

const SURAKSHA_MODELS: readonly Seed[] = [
  {
    orgId: 'org_suraksha',
    database: 'suraksha',
    name: 'persistency_by_band',
    note: 'Premium persistency (% of due premiums paid) by policy-month band.',
    input: {
      name: 'persistency_by_band',
      kind: 'view',
      database: 'suraksha',
      definition: {
        selectSql:
          'SELECT persistency_band, count() AS due_count, sum(is_paid) AS paid_count, ' +
          'round(100 * sum(is_paid) / count(), 2) AS persistency_pct, ' +
          'sum(amount_inr) AS due_amount_inr ' +
          'FROM fact_premium GROUP BY persistency_band ORDER BY persistency_band',
      },
    },
  },
  {
    orgId: 'org_suraksha',
    database: 'suraksha',
    name: 'claims_settled_by_type',
    note: 'Claims filed vs settled amount, by claim type and status.',
    input: {
      name: 'claims_settled_by_type',
      kind: 'view',
      database: 'suraksha',
      definition: {
        selectSql:
          'SELECT claim_type, status, count() AS claims, sum(claim_amount_inr) AS claimed_inr, ' +
          'sum(settled_amount_inr) AS settled_inr ' +
          'FROM fact_claim GROUP BY claim_type, status ORDER BY claim_type, status',
      },
    },
  },
  {
    orgId: 'org_suraksha',
    database: 'suraksha',
    name: 'premium_collection_by_month',
    note: 'Premium due vs collected, by calendar month.',
    input: {
      name: 'premium_collection_by_month',
      kind: 'view',
      database: 'suraksha',
      definition: {
        selectSql:
          'SELECT toStartOfMonth(due_date) AS month, sum(amount_inr) AS due_inr, ' +
          'sum(if(is_paid, amount_inr, 0)) AS collected_inr ' +
          'FROM fact_premium GROUP BY month ORDER BY month',
      },
    },
  },
];

const BHARAT_MODELS: readonly Seed[] = [
  {
    orgId: 'org_bharat',
    database: 'bharatunion',
    name: 'npa_exposure_by_product',
    note: 'Outstanding loan exposure and NPA share, by product.',
    input: {
      name: 'npa_exposure_by_product',
      kind: 'view',
      database: 'bharatunion',
      definition: {
        selectSql:
          'SELECT p.product_name, p.category, count() AS loans, ' +
          'sum(l.outstanding_amount) AS outstanding_inr, ' +
          'sum(if(l.npa_flag = 1, l.outstanding_amount, 0)) AS npa_outstanding_inr, ' +
          'round(100 * sum(if(l.npa_flag = 1, 1, 0)) / count(), 2) AS npa_pct ' +
          'FROM fact_loan AS l JOIN dim_product AS p ON l.product_id = p.product_id ' +
          'GROUP BY p.product_name, p.category ORDER BY npa_outstanding_inr DESC',
      },
    },
  },
  {
    orgId: 'org_bharat',
    database: 'bharatunion',
    name: 'deposits_by_branch',
    note: 'Active-account deposit balances, by branch.',
    input: {
      name: 'deposits_by_branch',
      kind: 'view',
      database: 'bharatunion',
      definition: {
        selectSql:
          "SELECT b.branch_name, b.city, count() AS accounts, sum(a.balance_inr) AS total_deposits_inr " +
          'FROM fact_account AS a JOIN dim_branch AS b ON a.branch_id = b.branch_id ' +
          "WHERE a.status = 'active' GROUP BY b.branch_name, b.city ORDER BY total_deposits_inr DESC",
      },
    },
  },
  {
    orgId: 'org_bharat',
    database: 'bharatunion',
    name: 'transaction_volume_by_channel',
    note: 'Transaction count and amount, by channel and direction.',
    input: {
      name: 'transaction_volume_by_channel',
      kind: 'view',
      database: 'bharatunion',
      definition: {
        selectSql:
          'SELECT channel, direction, count() AS txns, sum(amount_inr) AS amount_inr ' +
          'FROM fact_transaction GROUP BY channel, direction ORDER BY amount_inr DESC',
      },
    },
  },
];

async function pruneStray(): Promise<void> {
  const existing = await listModels(STRAY_BHARAT_MODEL.orgId);
  const stray = existing.find(
    (m) => m.name === STRAY_BHARAT_MODEL.name && m.database === STRAY_BHARAT_MODEL.database,
  );
  if (!stray) {
    log(`no stray "${STRAY_BHARAT_MODEL.name}" model on ${STRAY_BHARAT_MODEL.orgId} — nothing to prune`);
    return;
  }
  const result = await deleteModelLive(stray.id, STRAY_BHARAT_MODEL.orgId);
  if (!result.ok) {
    log(`FAILED to drop stray model ${stray.id}: ${JSON.stringify(result)}`);
    return;
  }
  log(`dropped stray model ${stray.id} (${stray.name} on ${stray.database ?? '?'})`);
}

async function seedOne(seed: Seed): Promise<void> {
  const existing = await listModels(seed.orgId);
  if (existing.some((m) => m.name === seed.name)) {
    log(`skip (already exists): ${seed.orgId}/${seed.name}`);
    return;
  }
  const result = await createModelLive({ ...seed.input, note: seed.note }, seed.orgId);
  if (!result.ok) {
    log(`FAILED to create ${seed.orgId}/${seed.name}: ${JSON.stringify(result)}`);
    return;
  }
  log(`created: ${seed.orgId}/${seed.name} (id=${result.value.id}, database=${result.value.database})`);
}

async function main(): Promise<void> {
  await pruneStray();
  for (const seed of [...SURAKSHA_MODELS, ...BHARAT_MODELS]) {
    await seedOne(seed);
  }
  log('done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[seed:warehouse-models] FATAL', e);
    process.exit(1);
  });
