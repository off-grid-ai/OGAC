// ─── BFSI seed app → pipeline binding (PURE) ──────────────────────────────────────────────────────
//
// The BFSI demo seeds a handful of governed apps (Motor-Claim FNOL, Loan Underwriting, KYC,
// Reimbursement, Fraud, Cross-Sell) AND a matching library of sample pipelines (pipelines-seed.ts,
// SAMPLE_PIPELINES). Without a binding the apps render as "Ungoverned" — they should read
// "Runs on: <pipeline>". This module is the PURE, zero-I/O rule that decides WHICH seed pipeline a
// seed app runs on, matched by the app's TITLE. The seed scripts inject the live pipeline name→id map
// and apply this decision idempotently (set pipeline_id on create AND on already-present apps).
//
// SOLID: the decision (title → pipeline key) lives here and is unit-tested; the I/O (fetch pipelines,
// PATCH apps) lives in the seed entry points. Keep the keys in lock-step with SAMPLE_PIPELINES.

/** App title (as seeded) → the SAMPLE_PIPELINES `key` its work runs on. Titles are matched
 *  case-insensitively and trimmed. Every seed app that has a governing pipeline appears here. */
const APP_TITLE_TO_PIPELINE_KEY: ReadonlyArray<readonly [title: string, pipelineKey: string]> = [
  ['Motor Claim FNOL Triage', 'motor-claim-fnol'],
  ['Personal Loan Underwriting Assist', 'loan-underwriting'],
  ['KYC & Re-KYC Verification', 'kyc-verification'],
  ['Reimbursement Approval', 'reimbursement-governance'],
  ['Fraud Screening', 'fraud-screening'],
  ['Cross-Sell Advisor', 'cross-sell-advisor'],
];

/** The pipeline NAME each SAMPLE_PIPELINES key carries — used to resolve a live pipeline id by name
 *  when the seed only knows names (the HTTP seed lists pipelines and gets names, not keys). Kept in
 *  sync with SAMPLE_PIPELINES in pipelines-seed.ts. */
const PIPELINE_KEY_TO_NAME: Readonly<Record<string, string>> = {
  'reimbursement-governance': 'Reimbursement Governance',
  'motor-claim-fnol': 'Motor-Claim FNOL',
  'loan-underwriting': 'Loan Underwriting',
  'kyc-verification': 'KYC Verification',
  'fraud-screening': 'Fraud Screening',
  'cross-sell-advisor': 'Cross-Sell Advisor',
};

const norm = (s: string): string => s.trim().toLowerCase();

/** The SAMPLE_PIPELINES key a seed app title runs on, or null if the title isn't a governed seed app. */
export function pipelineKeyForAppTitle(title: string): string | null {
  const t = norm(title);
  for (const [appTitle, key] of APP_TITLE_TO_PIPELINE_KEY) {
    if (norm(appTitle) === t) return key;
  }
  return null;
}

/** The pipeline display NAME a seed app title runs on, or null. (key → name indirection.) */
export function pipelineNameForAppTitle(title: string): string | null {
  const key = pipelineKeyForAppTitle(title);
  return key ? (PIPELINE_KEY_TO_NAME[key] ?? null) : null;
}

/**
 * Resolve the pipeline id a seed app should bind to, given the live map of pipeline NAME → id (as the
 * HTTP seed reads from GET /api/v1/admin/pipelines). Returns null when the app has no governing
 * pipeline OR the matching pipeline isn't present in the org yet (seed the pipelines first). Names are
 * matched case-insensitively/trimmed so a live rename of casing doesn't break the binding.
 */
export function resolvePipelineIdForApp(
  title: string,
  pipelineIdByName: Map<string, string>,
): string | null {
  const name = pipelineNameForAppTitle(title);
  if (!name) return null;
  // Case-insensitive lookup over the injected name→id map.
  const wanted = norm(name);
  for (const [n, id] of pipelineIdByName) {
    if (norm(n) === wanted) return id;
  }
  return null;
}

/** Every app title that has a governing pipeline (for tests / enumeration). */
export function governedSeedAppTitles(): string[] {
  return APP_TITLE_TO_PIPELINE_KEY.map(([title]) => title);
}
