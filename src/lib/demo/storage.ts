// Demo STORAGE persona data — PURE, zero I/O. Small, realistic text files the tenant "uploaded",
// distinct per flavour, to REPLACE the junk on the Workspace → Storage surface. Storage is backed by
// SeaweedFS (object store), NOT Postgres — object bytes need infra the operator runs. So the runner:
//   • writes these objects via files.saveFile IF SeaweedFS is reachable;
//   • otherwise FLAGS them (the data is here, the upload is infra) and the operator runs the object
//     upload step against their SeaweedFS.
// Content is synthetic Indian-BFSI text (INR, PAN/IFSC masked) — never real customer data.
import type { TenantProfile } from '@/lib/tour-demo-seed';

export interface DemoFileSeed {
  /** File name shown in the storage list. */
  name: string;
  mime: string;
  /** The synthetic file body (kept small — this is a demo artefact, not a real document). */
  content: string;
}

// ── BANK files (org_bharat) — account statements, KYC docs ──
export const BANK_FILES: readonly DemoFileSeed[] = [
  {
    name: 'account-statement-XXXX3391.csv',
    mime: 'text/csv',
    content:
      'date,description,ref,debit_inr,credit_inr,balance_inr\n' +
      '2026-06-01,UPI/rajesh@okhdfc,UTR3920011,,25000,142300\n' +
      '2026-06-03,NEFT/RETURN R03,UTR3920044,25000,,117300\n' +
      '2026-06-07,EMI/PERSONAL LOAN,LN88213,18450,,98850\n' +
      '2026-06-12,IMPS/self,IM771203,,50000,148850\n',
  },
  {
    name: 'kyc-checklist-medium-risk.md',
    mime: 'text/markdown',
    content:
      '# Re-KYC Checklist (Medium Risk)\n\n- PAN: ABCXX1234X (masked)\n- Aadhaar: XXXX XXXX 9021 (masked)\n' +
      '- Address proof: utility bill < 3 months\n- PEP/UAPA screen: clear\n- Periodicity: 8 years (medium risk)\n',
  },
  {
    name: 'dunning-notice-90dpd-template.txt',
    mime: 'text/plain',
    content:
      'Dear Customer, our records show your Personal Loan account ****-3391 is overdue by 90 days. ' +
      'Please regularise within 7 days per the RBI Fair Practices Code. This is a reminder, not a legal notice.',
  },
];

// ── INSURER files (org_suraksha) — claim photos (as references), policy PDFs ──
export const INSURER_FILES: readonly DemoFileSeed[] = [
  {
    name: 'policy-schedule-SL-2291043.txt',
    mime: 'text/plain',
    content:
      'SURAKSHA LIFE — Policy Schedule\nPolicy No: SL-2291043\nPlan: OYRT Term\nSum Assured (INR): 1,00,00,000\n' +
      'Commencement: 2021-04-15\nPremium (INR/yr): 18,400\nStatus: In-force\nPAN: ABCXX1234X (masked)\n',
  },
  {
    name: 'fnol-motor-claim-CLM88120.md',
    mime: 'text/markdown',
    content:
      '# FNOL — Motor Own-Damage\n\n- Claim No: CLM88120\n- Policy: SL-MTR-77120 (in-force)\n' +
      '- Loss: rear-end collision, third party involved\n- Estimate (INR): 1,40,000 (surveyor mandatory > 1,00,000)\n' +
      '- Licence valid at time of loss: yes\n- Recommendation: allocate surveyor\n',
  },
  {
    name: 'claim-photo-manifest-CLM88120.txt',
    mime: 'text/plain',
    content:
      'Claim CLM88120 — uploaded photo manifest\n1. rear-bumper-damage.jpg\n2. number-plate.jpg\n3. odometer.jpg\n4. driving-licence-masked.jpg\n',
  },
];

/** The storage files for a tenant — bank vs insurer. */
export function filesFor(profile: TenantProfile): readonly DemoFileSeed[] {
  return profile.flavour === 'bank' ? BANK_FILES : INSURER_FILES;
}
