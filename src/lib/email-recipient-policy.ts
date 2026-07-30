// ─── Deliverable-recipient policy — pure ────────────────────────────────────────────────────────────
//
// Founder report: "I'm seeing failures in resend", with ops@bharatunion.example as the address. That domain
// is unroutable by construction — `.example` is RESERVED by RFC 2606 precisely so it can never resolve — so
// every send to it fails at the provider, after the run has already decided to send.
//
// Searching for the value found nothing: not in the repo, and not in any of 696 text/jsonb columns in the
// database. So there is no config entry to correct. It reaches the sink as typed input on a run, which means
// the durable fix is not a find-and-replace but a RULE: refuse an address that cannot receive mail, and say so
// before calling the provider.
//
// Two behaviours, and the distinction matters:
//   • REDIRECT — a demo tenant with an operator inbox configured sends there instead, so demo flows complete
//     end to end and the operator sees what a customer would have received.
//   • BLOCK — no redirect configured ⇒ refuse with a legible reason rather than attempting a send that will
//     fail. A provider error buried in a log is the failure-as-emptiness defect again: the run reports
//     "sent", the mail never arrives, and nobody learns why.

/** Reserved by RFC 2606 / RFC 6761 — these can never receive mail, anywhere. */
const UNDELIVERABLE_TLDS = ['example', 'invalid', 'test', 'localhost'];

/** Reserved second-level names (example.com/net/org are reserved for documentation). */
const UNDELIVERABLE_DOMAINS = ['example.com', 'example.net', 'example.org'];

export interface RecipientDecision {
  /** The address to actually send to, when sending is allowed. */
  to: string | null;
  /** True when the original address was replaced. */
  redirected: boolean;
  /** True when no send should be attempted. */
  blocked: boolean;
  /** Always populated — what happened and why, for the step detail and the audit line. */
  reason: string;
}

/** Is this address structurally incapable of receiving mail? */
export function isUndeliverable(address: string): boolean {
  // Whitespace ANYWHERE is malformed — a space in the local part is just as unroutable as one in the domain,
  // and it is the shape a pasted address arrives in.
  if (!address || /\s/.test(address)) return true;
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) return true; // no domain at all
  const domain = address.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  if (!domain || domain.includes(' ')) return true;
  if (UNDELIVERABLE_DOMAINS.includes(domain)) return true;
  const tld = domain.split('.').pop() ?? '';
  return UNDELIVERABLE_TLDS.includes(tld);
}

/**
 * Decide where an email actually goes.
 *
 * `redirectTo` is the operator inbox for demo tenants (e.g. OFFGRID_DEMO_EMAIL_REDIRECT). Absent, an
 * undeliverable address BLOCKS rather than being silently dropped — a sink that swallows a send reports
 * success for mail that never existed.
 */
export function resolveRecipient(address: string, redirectTo?: string | null): RecipientDecision {
  const to = (address ?? '').trim();
  if (!to) return { to: null, blocked: true, redirected: false, reason: 'no recipient was provided' };
  if (!isUndeliverable(to)) return { to, blocked: false, redirected: false, reason: `sending to ${to}` };

  const fallback = (redirectTo ?? '').trim();
  if (fallback && !isUndeliverable(fallback)) {
    return {
      to: fallback,
      blocked: false,
      redirected: true,
      reason: `${to} cannot receive mail (reserved domain), so it was sent to the operator inbox ${fallback} instead`,
    };
  }
  return {
    to: null,
    blocked: true,
    redirected: false,
    reason: `${to} cannot receive mail — its domain is reserved and will never resolve, so no send was attempted`,
  };
}
