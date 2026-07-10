// Demo DATA-CATALOG persona data — PURE, zero I/O. Warehouse/catalog assets + their PII
// classification + retention, distinct per flavour, so the Data → Catalog / Data-Quality / Governance
// surfaces read as a real BFSI book. Assets carry PII tags (PAN/AADHAAR/IFSC for the bank; PAN/POLICY
// for the insurer) so the classification bars and retention/RTBF views light up.
//
// The runner persists via createAsset (random ids ⇒ name-idempotent) + setClassification/setRetention
// (already upsert by asset+column / asset ⇒ naturally idempotent). planAssets is name-idempotent.
import type { TenantProfile } from '@/lib/tour-demo-seed';

export type ClassLevel = 'public' | 'internal' | 'confidential' | 'restricted';

export interface DemoAssetSeed {
  name: string;
  /** Physical source label shown in the catalog. */
  source: string;
  kind: 'table' | 'view' | 'stream' | 'file' | 'collection';
  owner: string;
  description: string;
  rowCount: number;
  /** Freshness SLA in hours (0 = none). */
  freshnessSlaHours: number;
  /** Sync health as last reported. */
  syncStatus: 'ok' | 'failed' | 'unknown';
  /** Asset-level classification. */
  level: ClassLevel;
  /** PII entity tags (guardrails vocabulary — PAN/AADHAAR/IFSC/EMAIL/PHONE/…). */
  piiTags: string[];
  /** Retention in days (0 = indefinite) + action at expiry. */
  retainDays: number;
  retainAction: 'delete' | 'anonymize' | 'archive';
}

// ── BANK assets (org_bharat) ──
export const BANK_ASSETS: readonly DemoAssetSeed[] = [
  { name: 'fact_transactions', source: 'Warehouse (ClickHouse)', kind: 'table', owner: 'data-eng@bharatunion.example', description: 'UPI/NEFT/IMPS transaction fact table — the reconciliation + fraud source of truth.', rowCount: 4820331, freshnessSlaHours: 6, syncStatus: 'ok', level: 'confidential', piiTags: ['ACCOUNT', 'IFSC'], retainDays: 2555, retainAction: 'archive' },
  { name: 'dim_customer', source: 'Core Banking (Postgres)', kind: 'table', owner: 'compliance@bharatunion.example', description: 'Customer master — identity, PAN, masked Aadhaar, KYC status.', rowCount: 318204, freshnessSlaHours: 24, syncStatus: 'ok', level: 'restricted', piiTags: ['PAN', 'AADHAAR', 'PHONE', 'EMAIL'], retainDays: 3650, retainAction: 'anonymize' },
  { name: 'loan_applications', source: 'Core Banking (Postgres)', kind: 'table', owner: 'lending@bharatunion.example', description: 'Personal-loan applications with FOIR, CIBIL band and decision.', rowCount: 54210, freshnessSlaHours: 12, syncStatus: 'ok', level: 'confidential', piiTags: ['PAN'], retainDays: 2555, retainAction: 'archive' },
  { name: 'kyc_documents', source: 'Object store (SeaweedFS)', kind: 'collection', owner: 'compliance@bharatunion.example', description: 'Uploaded OVDs (PAN card, masked Aadhaar, address proof) per customer.', rowCount: 291044, freshnessSlaHours: 0, syncStatus: 'ok', level: 'restricted', piiTags: ['PAN', 'AADHAAR'], retainDays: 3650, retainAction: 'delete' },
];

// ── INSURER assets (org_suraksha) ──
export const INSURER_ASSETS: readonly DemoAssetSeed[] = [
  { name: 'policies', source: 'Core Insurance (Postgres)', kind: 'table', owner: 'underwriting@suraksha.example', description: 'In-force life + health policies — sum assured, term, in-force date.', rowCount: 128940, freshnessSlaHours: 12, syncStatus: 'ok', level: 'confidential', piiTags: ['PAN', 'POLICY'], retainDays: 3650, retainAction: 'archive' },
  { name: 'claims_register', source: 'Core Insurance (Postgres)', kind: 'table', owner: 'claims@suraksha.example', description: 'Death + motor claims with FNOL, documents and settlement state.', rowCount: 22107, freshnessSlaHours: 6, syncStatus: 'ok', level: 'restricted', piiTags: ['PAN', 'AADHAAR', 'POLICY'], retainDays: 3650, retainAction: 'anonymize' },
  { name: 'premium_ledger', source: 'Warehouse (ClickHouse)', kind: 'table', owner: 'finance@suraksha.example', description: 'Premium payment history + persistency band per policy.', rowCount: 1904822, freshnessSlaHours: 24, syncStatus: 'ok', level: 'confidential', piiTags: ['POLICY'], retainDays: 2555, retainAction: 'archive' },
  { name: 'claim_documents', source: 'Object store (SeaweedFS)', kind: 'collection', owner: 'claims@suraksha.example', description: 'Claim paperwork + accident photos uploaded against each claim.', rowCount: 61230, freshnessSlaHours: 0, syncStatus: 'failed', level: 'restricted', piiTags: ['PAN', 'AADHAAR'], retainDays: 3650, retainAction: 'delete' },
];

/** The catalog assets for a tenant — bank vs insurer. */
export function assetsFor(profile: TenantProfile): readonly DemoAssetSeed[] {
  return profile.flavour === 'bank' ? BANK_ASSETS : INSURER_ASSETS;
}

/** Idempotent by NAME (case-insensitive): only the assets not already catalogued for the org. */
export function planAssets(
  specs: readonly DemoAssetSeed[],
  existingNames: readonly string[],
): { toCreate: DemoAssetSeed[]; present: DemoAssetSeed[] } {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const toCreate: DemoAssetSeed[] = [];
  const present: DemoAssetSeed[] = [];
  for (const a of specs) (have.has(a.name.trim().toLowerCase()) ? present : toCreate).push(a);
  return { toCreate, present };
}
