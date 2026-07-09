// Trust & Security Center — the thin I/O adapter.
//
// SOLID: this is the ONLY layer allowed to touch env / config / other libs. It collects a live
// `PostureInputs` snapshot from REAL deployment facts, then hands it to the PURE derivation in
// trust-center.ts. Kept deliberately thin — no derivation logic here, just reads. Excluded from the
// unit-coverage denominator (env/config glue); the pure layer it feeds is fully tested.
//
// HONESTY of the reads: each fact is the truthful current state, degrading conservatively. Where a
// production-readiness item is still open (PRODUCTION_READINESS.md — secrets-vault persistence,
// automated backups, DR replica, org-wide PII floor, verified multi-tenant isolation), the read
// returns the honest value so the surface shows "in-progress"/"planned", never a false "implemented".

import { googleEnabled, keycloakEnabled, microsoftEnabled } from '@/auth.config';
import { openBaoConfigured } from '@/lib/adapters/secrets';
import { computeCompliance } from '@/lib/compliance';
import { siemConfigured } from '@/lib/siem';
import { EMPTY_INPUTS, type PostureInputs } from '@/lib/trust-center';

// The dev default signing key in sign.ts. If OFFGRID_SIGNING_KEY is unset it falls back to this —
// provenance signatures would be forgeable, so we treat that as "not truly implemented".
const DEV_SIGNING_KEY = 'offgrid-dev-signing-key';

// A boolean env flag: only an explicit "true"/"1" is on. Unset/anything-else is off (conservative).
function envOn(name: string): boolean {
  const v = process.env[name];
  return v === 'true' || v === '1';
}

// A truthful posture snapshot from the live deployment. Facts that are always-true properties of the
// codebase (security headers in next.config, rate-limit in middleware, coverage gate in CI) are
// asserted directly; facts that depend on runtime config are read from env / adapters / compliance.
export async function collectPostureInputs(): Promise<PostureInputs> {
  // Reuse the existing compliance computation for the audit / PII-masking / guardrails / egress /
  // grounding facts (DRY — one source of truth for those control verdicts).
  const compliance = await computeCompliance().catch(() => null);
  const controlStatus = (id: string): boolean =>
    compliance?.controls.find((c) => c.id === id)?.status === 'satisfied';

  const ssoConfigured = googleEnabled || microsoftEnabled || keycloakEnabled;
  const secretsVault = openBaoConfigured();
  const provenanceSigning = Boolean(
    process.env.OFFGRID_SIGNING_KEY && process.env.OFFGRID_SIGNING_KEY !== DEV_SIGNING_KEY,
  );
  // On-prem is the deployment default; a pinned org (single-tenant box) also implies on-prem.
  const onPrem = envOn('OFFGRID_ON_PREM') || Boolean(process.env.OFFGRID_ORG);

  return {
    ...EMPTY_INPUTS,
    // Static codebase guarantees (verifiable by inspecting next.config.mjs / middleware.ts / CI).
    securityHeaders: true,
    rateLimit: true,
    coverageGate: true,
    // Runtime-config facts.
    wafEnabled: envOn('OFFGRID_WAF_ENABLED'),
    ssoConfigured,
    secretsVault,
    secretsVaultPersistent: envOn('OFFGRID_OPENBAO_PERSISTENT'), // readiness R1 — off until set
    siemStreaming: siemConfigured(),
    provenanceSigning,
    onPrem,
    egressLeash: true, // the egress leash is always enforced (least-permissive-wins in policy)
    // Reused from the live compliance verdicts.
    auditImmutable: controlStatus('audit'),
    piiRedaction: controlStatus('pii-masking'),
    guardrails: controlStatus('input-guardrails'),
    // Open production-readiness items — honest defaults (off unless explicitly attested by env).
    piiFloorEnforced: envOn('OFFGRID_PII_FLOOR'), // readiness G1/G2
    backupsAutomated: envOn('OFFGRID_BACKUPS_AUTOMATED'), // readiness R2
    drReplica: envOn('OFFGRID_DR_REPLICA'), // readiness R3
    tenantIsolationVerified: envOn('OFFGRID_TENANT_ISOLATION_VERIFIED'), // readiness P0
  };
}
