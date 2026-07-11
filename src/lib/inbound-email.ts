// ─── Forward-to-address INBOUND email → governed run (Builder Epic, Phase 4C) ─────────────────────
//
// Each app/agent can be given a UNIQUE inbound email address; anything forwarded there fires a
// GOVERNED run of that consumer. We do NOT run a mail server — the address maps to a WEBHOOK TRIGGER
// (reusing webhook-triggers.ts to mint/lookup — READ only), and the customer's provider (Resend
// inbound, or their own forwarding rule) POSTs the parsed email to a thin receive route which resolves
// the trigger and dispatches through the SAME submitAppRun / dispatchAgentRun path every other run
// uses. So contract + guardrails + PII + egress leash + audit all apply identically.
//
// THE ADDRESS SCHEME:  <token>@inbound.<host>
//   • <token> IS the webhook trigger's opaque token (wht_…) — one token, two ingress shapes (HTTP
//     webhook + inbound email). The token is the lookup key; there is no separate email registry.
//   • <host> is OFFGRID_INBOUND_EMAIL_DOMAIN (e.g. inbound.getoffgridai.co). Unset ⇒ inbound disabled.
//
// SOLID: address derivation (inboundAddressFor / tokenFromInboundAddress) + email-parse normalization
// (normalizeInboundEmail) are PURE + unit-tested. The receive route is the thin I/O that calls the
// existing trigger seam. This module re-uses buildTriggerInput('email', …) so the raw parsed email is
// normalized into the SAME flat app-run input the IMAP poller produces (DRY — one email-input rule).

import { buildTriggerInput, type EmailPayload } from '@/lib/trigger-dispatch';

// ─── config (PURE) ────────────────────────────────────────────────────────────────────────────────
export interface InboundConfigResult {
  ok: boolean;
  domain?: string;
  reason: string;
}

/**
 * Read the inbound-email domain from env. PURE. Requires OFFGRID_INBOUND_EMAIL_DOMAIN — the host the
 * customer points their forwarding/inbound-parse at (e.g. inbound.acme.co). Unset ⇒ inbound disabled
 * (we never invent a domain). A leading "inbound." is not forced — the operator sets the full host.
 */
export function inboundConfigFromEnv(env: NodeJS.ProcessEnv = process.env): InboundConfigResult {
  const raw = (env.OFFGRID_INBOUND_EMAIL_DOMAIN ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!raw) {
    return {
      ok: false,
      reason: 'Inbound email disabled — set OFFGRID_INBOUND_EMAIL_DOMAIN (e.g. inbound.yourco.com) to enable.',
    };
  }
  if (/\s/.test(raw) || raw.includes('/') || raw.includes('@')) {
    return { ok: false, reason: 'OFFGRID_INBOUND_EMAIL_DOMAIN must be a bare host (e.g. inbound.yourco.com).' };
  }
  return { ok: true, domain: raw, reason: 'ok' };
}

// ─── address derivation (PURE) ────────────────────────────────────────────────────────────────────

/** The unique inbound address for a trigger token: `<token>@<domain>`. PURE. Empty domain ⇒ ''. */
export function inboundAddressFor(token: string, domain: string): string {
  const t = (token ?? '').trim();
  const d = (domain ?? '').trim().toLowerCase();
  if (!t || !d) return '';
  return `${t}@${d}`;
}

/**
 * Extract the trigger token from an inbound recipient address. PURE.
 *
 * Accepts a bare "tok@inbound.acme.co", a display form "Name <tok@inbound.acme.co>", and Resend/Postmark
 * "+"-tagged forms "inbox+tok@inbound.acme.co" (the local part before "+" is ignored; the tag is the
 * token). The domain MUST match the configured inbound domain (case-insensitive) or we return null —
 * so an address for a different host can never resolve a token. Returns the token, or null.
 */
export function tokenFromInboundAddress(recipient: string, domain: string): string | null {
  const d = (domain ?? '').trim().toLowerCase();
  if (!d) return null;
  const addr = extractAddress(recipient);
  if (!addr) return null;
  const at = addr.lastIndexOf('@');
  if (at < 0) return null;
  const local = addr.slice(0, at).trim();
  const host = addr.slice(at + 1).trim().toLowerCase();
  if (host !== d) return null;
  // "+"-tag form: the token is the part after the LAST '+'; else the whole local part is the token.
  const plus = local.lastIndexOf('+');
  const token = (plus >= 0 ? local.slice(plus + 1) : local).trim();
  return token || null;
}

// Pull the bare address out of a "Name <addr>" or bare "addr" recipient string. PURE.
function extractAddress(recipient: string): string {
  const v = (recipient ?? '').trim();
  const m = /<([^>]+)>/.exec(v);
  return (m ? m[1] : v).trim();
}

// ─── inbound email parse → normalized payload (PURE) ────────────────────────────────────────────
export interface RawInboundEmail {
  from?: unknown;
  to?: unknown;
  recipient?: unknown; // Resend/SES inbound often names the envelope recipient here
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  messageId?: unknown;
  'message-id'?: unknown;
  date?: unknown;
  attachments?: unknown;
}

export interface NormalizedInbound {
  /** The webhook trigger token derived from the recipient (null if it doesn't match our domain). */
  token: string | null;
  /** The flat app-run input (buildTriggerInput('email',…)) — the SAME shape the IMAP poller yields. */
  input: Record<string, unknown>;
  /** Attachment metadata (name/type/size) — bounded; bytes are NOT threaded into the pipeline input. */
  attachments: { filename: string; contentType: string; size: number }[];
}

const MAX_ATTACHMENTS = 20;

/**
 * Parse a provider's inbound-parse POST body into {token, input, attachments}. PURE + defensive.
 *
 * The recipient is read from `to` (or `recipient`), the token derived against the configured domain
 * (tokenFromInboundAddress). The {from,subject,text} are normalized through buildTriggerInput('email',…)
 * so a single email-triggered app "just works" (its `input` is the body). HTML-only mail falls back to
 * the html as the text. Attachment METADATA is summarized (name/type/size) — we don't push raw bytes
 * through the pipeline input (that stays small + typed); a step that needs a file uses the run's refs.
 */
export function normalizeInboundEmail(raw: RawInboundEmail, domain: string): NormalizedInbound {
  const r = (raw ?? {}) as RawInboundEmail;
  const recipient = str(r.recipient) || str(r.to);
  const token = tokenFromInboundAddress(recipient, domain);
  const text = str(r.text) || stripHtml(str(r.html));
  const payload: EmailPayload = {
    from: str(r.from),
    to: recipient,
    subject: str(r.subject),
    text,
    messageId: str(r.messageId) || str(r['message-id']),
    date: str(r.date),
  };
  return {
    token,
    input: buildTriggerInput('email', payload),
    attachments: normalizeAttachments(r.attachments),
  };
}

function normalizeAttachments(raw: unknown): { filename: string; contentType: string; size: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ATTACHMENTS).map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    const filename = str(o.filename) || str(o.name) || 'attachment';
    const contentType = str(o.contentType) || str(o.content_type) || str(o.type) || 'application/octet-stream';
    const size =
      typeof o.size === 'number'
        ? o.size
        : typeof o.content === 'string'
          ? Math.floor((o.content.length * 3) / 4) // base64 → approx byte length
          : 0;
    return { filename, contentType, size };
  });
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// Very small HTML→text fallback for html-only mail: strip tags + collapse whitespace. PURE.
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
