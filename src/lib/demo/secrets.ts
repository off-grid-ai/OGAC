// Demo SECRETS persona data — PURE, zero I/O. Non-real secret specs a tenant would hold (connector
// credentials, a webhook signing key), distinct per flavour. Secret VALUES live in OpenBao (the vault
// the operator runs), NEVER in Postgres or git — so the runner FLAGS these for the operator to write
// with `bao kv put` rather than persisting a value. This module carries only the NAME + PATH + a
// human note, and an explicitly FAKE placeholder value the operator replaces.
import type { TenantProfile } from '@/lib/tour-demo-seed';

export interface DemoSecretSeed {
  /** Logical name shown in the UI. */
  name: string;
  /** OpenBao KV path the operator writes to. */
  path: string;
  /** A clearly non-real placeholder — the operator replaces it with the real value. */
  placeholder: string;
  note: string;
}

// ── BANK secrets (org_bharat) ──
export const BANK_SECRETS: readonly DemoSecretSeed[] = [
  { name: 'Core Banking DB password', path: 'secret/org_bharat/connectors/corebank', placeholder: 'REPLACE_ME_corebank_pw', note: 'Password for the core-banking Postgres connector.' },
  { name: 'CIBIL bureau API key', path: 'secret/org_bharat/tools/cibil', placeholder: 'REPLACE_ME_cibil_key', note: 'Bureau API key for the CIBIL score-check tool (approval-gated).' },
  { name: 'Payment gateway webhook signing secret', path: 'secret/org_bharat/tools/paymentgw-webhook', placeholder: 'REPLACE_ME_paymentgw_signing_secret', note: 'Verifies inbound payment-gateway callback signatures (NEFT/IMPS/UPI settlement webhooks).' },
  { name: 'SMS/OTP gateway API key', path: 'secret/org_bharat/tools/sms-otp', placeholder: 'REPLACE_ME_sms_otp_key', note: 'API key for the SMS/OTP vendor used by collections and KYC re-verification flows.' },
];

// ── INSURER secrets (org_suraksha) ──
export const INSURER_SECRETS: readonly DemoSecretSeed[] = [
  { name: 'Core Insurance DB password', path: 'secret/org_suraksha/connectors/coreins', placeholder: 'REPLACE_ME_coreins_pw', note: 'Password for the core-insurance Postgres connector.' },
  { name: 'Policy-admin MySQL password', path: 'secret/org_suraksha/connectors/policyadmin', placeholder: 'REPLACE_ME_policyadmin_pw', note: 'Password for the advisor/HR policy-admin MySQL connector.' },
  { name: 'IRDAI reporting SFTP password', path: 'secret/org_suraksha/connectors/irdai-sftp', placeholder: 'REPLACE_ME_irdai_sftp_pw', note: 'Password for the SFTP drop used for periodic IRDAI regulatory reporting.' },
  { name: 'Payment gateway webhook signing secret', path: 'secret/org_suraksha/tools/paymentgw-webhook', placeholder: 'REPLACE_ME_paymentgw_signing_secret', note: 'Verifies inbound premium-payment callback signatures from the payment gateway.' },
];

/** The secret specs for a tenant — bank vs insurer. */
export function secretsFor(profile: TenantProfile): readonly DemoSecretSeed[] {
  return profile.flavour === 'bank' ? BANK_SECRETS : INSURER_SECRETS;
}
