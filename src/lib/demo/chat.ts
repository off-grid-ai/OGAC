// Demo CHAT persona data — PURE, zero I/O. Governed Workspace conversations a tenant viewer sees on
// the Chat surface, distinct per flavour (bank vs insurer). Each conversation has a title, the model
// it ran on, and an ordered set of turns; assistant turns carry CITATIONS into the org knowledge base
// so the chat reads as GROUNDED (the citation `name` matches a seeded knowledge doc/collection name).
//
// The runner persists these into chat_conversations + chat_messages, scoped to the tenant org, bound
// to the tenant's default governed pipeline (so Workspace chat reads "governed", never "Ungoverned").
// Idempotent by deterministic id (planById in tour-demo-seed): a re-run creates nothing new.
import { hash12, type TenantProfile } from '@/lib/tour-demo-seed';

export interface DemoChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Knowledge citations on an assistant turn — {name, position, score}, name = a seeded doc/collection. */
  citations?: { name: string; position: number; score: number }[];
}

export interface DemoChatSeed {
  /** Stable key — the idempotency root within an org. */
  key: string;
  title: string;
  /** The model this conversation ran on (matches the tenant's gateway default). */
  model: string;
  messages: DemoChatMessage[];
}

const cite = (name: string, score = 0.9): { name: string; position: number; score: number } => ({
  name,
  position: 1,
  score,
});

// ── BANK conversations (org_bharat) — NEFT reconciliation, dunning, KYC re-verification ──
export const BANK_CHATS: readonly DemoChatSeed[] = [
  {
    key: 'neft-return-recon',
    title: 'NEFT return reconciliation',
    model: 'qwen2.5:14b',
    messages: [
      { role: 'user', content: 'We have 42 NEFT returns from yesterday with reason code R03. How should the ops team reconcile these against the outward batch?' },
      {
        role: 'assistant',
        content:
          'R03 means the beneficiary account is closed or does not exist. Match each return to its outward UTR in the batch file, mark the parent transaction as returned, and initiate an auto-refund to the remitter within the RBI-mandated T+1 window. For the 42 returns, group by remitter and raise a single credit advice per remitter where possible. Flag any where the remitter account is itself dormant for manual review.',
        citations: [cite('Motor Claim FNOL SOP (IRDAI-aligned)', 0.72), cite('BFSI Policies & SOPs', 0.88)],
      },
    ],
  },
  {
    key: 'dpd-90-dunning',
    title: '90-DPD dunning notice draft',
    model: 'qwen2.5:14b',
    messages: [
      { role: 'user', content: 'Draft a 90-DPD dunning notice for a personal-loan account. Keep it RBI Fair Practices Code compliant and mask the PAN.' },
      {
        role: 'assistant',
        content:
          'Dear Customer, our records show your Personal Loan account ****-3391 is overdue by 90 days as on date, with an outstanding of the EMIs plus applicable charges. As per the RBI Fair Practices Code we request you to regularise the account within 7 days to avoid classification as an NPA and reporting to CIBIL. Your PAN ABCXX1234X is on file. Please contact your relationship manager to discuss a repayment plan. This is a reminder, not a legal notice.',
        citations: [cite('Personal Loan Underwriting Guidelines', 0.81), cite('BFSI Policies & SOPs', 0.9)],
      },
    ],
  },
  {
    key: 'kyc-reverify',
    title: 'KYC re-verification questions',
    model: 'qwen2.5:14b',
    messages: [
      { role: 'user', content: 'A medium-risk customer onboarded 8 years ago. Is Re-KYC due, and what documents do we need?' },
      {
        role: 'assistant',
        content:
          'Yes. Under the RBI KYC Master Direction, medium-risk customers are due for periodic Re-KYC every 8 years, so this customer is now due. Collect a fresh Officially Valid Document set: PAN (mandatory), a masked Aadhaar or alternate OVD for address, and a recent photograph. Re-screen against PEP/UAPA lists. If the address is unchanged and self-declared, a positive confirmation is acceptable per the simplified Re-KYC route.',
        citations: [cite('KYC & Periodic Re-KYC Policy (RBI Master Direction)', 0.95), cite('BFSI Policies & SOPs', 0.87)],
      },
    ],
  },
];

// ── INSURER conversations (org_suraksha) — FNOL summary, health top-up, policy-lapse revival ──
export const INSURER_CHATS: readonly DemoChatSeed[] = [
  {
    key: 'motor-fnol-summary',
    title: 'Motor claim FNOL summary',
    model: 'llama3.1:70b',
    messages: [
      { role: 'user', content: 'Summarise this motor FNOL for the claims officer: policyholder reported a rear-end collision, third-party involved, claim estimate around 1.4 lakh.' },
      {
        role: 'assistant',
        content:
          'FNOL summary: own-damage motor claim, rear-end collision with a third party involved. Estimated quantum approximately 1,40,000, which is above the 1,00,000 surveyor threshold, so a surveyor is mandatory before settlement. Confirm the policy is in force and the premium is paid, and verify the driving licence was valid at the time of loss. If the licence was invalid the claim must be repudiated per the SOP. Recommend surveyor allocation, not cashless.',
        citations: [cite('Death-Claim Assessment SOP', 0.7), cite('Insurance Policies & SOPs', 0.9)],
      },
    ],
  },
  {
    key: 'health-topup-eligibility',
    title: 'Health top-up eligibility',
    model: 'llama3.1:70b',
    messages: [
      { role: 'user', content: 'Customer has a 5 lakh base health cover and wants a 20 lakh top-up with a 5 lakh deductible. Are they eligible?' },
      {
        role: 'assistant',
        content:
          'A super top-up with a 5,00,000 deductible sitting above a 5,00,000 base cover is a standard and eligible structure, since the deductible equals the base sum insured, so there is no coverage gap. Eligibility is subject to the age band and medical underwriting per the OYRT-style rate card. For a healthy applicant in the standard band, recommend proceeding to underwriting; load or defer only on adverse medical findings.',
        citations: [cite('Life Underwriting OYRT Rate Card Guide', 0.86), cite('Insurance Policies & SOPs', 0.83)],
      },
    ],
  },
  {
    key: 'policy-lapse-revival',
    title: 'Policy lapse revival options',
    model: 'llama3.1:70b',
    messages: [
      { role: 'user', content: 'A life policy lapsed 14 months ago after 3 years of premiums. What are the revival options?' },
      {
        role: 'assistant',
        content:
          'The policy is past the grace period but within the standard revival window (typically up to 5 years from the first unpaid premium). Options: ordinary revival with all arrears plus interest and a fresh declaration of good health, or a special revival scheme if health has changed. Since 3 full years of premiums were paid the policy has acquired a paid-up value, so the customer can also choose to keep it paid-up rather than revive. Recommend an advisor call to confirm the health declaration and quote the arrears.',
        citations: [cite('Grievance Redressal Policy (IRDAI)', 0.68), cite('Insurance Policies & SOPs', 0.88)],
      },
    ],
  },
];

/** The chat conversations for a tenant — bank vs insurer. */
export function chatsFor(profile: TenantProfile): readonly DemoChatSeed[] {
  return profile.flavour === 'bank' ? BANK_CHATS : INSURER_CHATS;
}

/** Deterministic conversation id (stable across re-runs → idempotent). */
export function chatId(orgId: string, key: string): string {
  return `conv_${hash12(`${orgId}:chat:${key}`)}`;
}

/** Deterministic message id for the nth turn of a conversation. */
export function chatMessageId(orgId: string, key: string, index: number): string {
  return `msg_${hash12(`${orgId}:chatmsg:${key}:${index}`)}`;
}
