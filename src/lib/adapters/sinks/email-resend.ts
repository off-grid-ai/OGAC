// ─── Email output sink — RESEND HTTP API send (governed cloud delivery) ───────────────────────────
//
// The `output:email` sink can deliver an app-run's result via Resend (https://resend.com) as an
// alternative to the on-prem SMTP sink (email-smtp.ts). Resend is a CLOUD provider, so unlike the
// air-gapped SMTP path this sink is DELIBERATELY egress-leashed + PII-masked-before-send + audited:
// the run path decides (via the same pure enforcement authority every other cloud call uses) whether
// the send may leave the box at all, and the OUTBOUND body/subject are masked BEFORE they cross the
// wire. This mirrors the model-call governance exactly, only the "external endpoint" here is Resend's
// /emails API instead of a model gateway.
//
// SOLID: payload shaping (buildResendPayload) is PURE + unit-tested — it maps our EmailMessage into
// the exact Resend request body (to/from/subject/html/text, reply_to, tags). This file's only I/O is
// the single fetch in sendViaResend + the vaulted-key resolve. The API key is a VAULTED org setting
// (resend_api_key in OpenBao) with an env fallback (RESEND_API_KEY) for bootstrap — NEVER hardcoded.
// Every op is graceful: it returns a typed SendEmailResult, never throws into the executor.

import type { EmailMessage } from '@/lib/adapters/sinks/email-smtp';

// ─── vaulted API key ────────────────────────────────────────────────────────────────────────────
// The key lives in OpenBao under a single org-scoped key (mirrors webhook/connector secret_ref: only
// the vault holds the material). Env RESEND_API_KEY is the bootstrap fallback so a fresh deploy can
// send before anyone writes the vault. Resolve is best-effort: vault first, then env.
export const RESEND_SECRET_KEY = 'org/resend_api_key';

/** Resolve the Resend API key: OpenBao (resend_api_key) first, then RESEND_API_KEY env. Null if none. */
export async function resolveResendApiKey(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    const vaulted = await openBaoSecrets.get(RESEND_SECRET_KEY);
    if (typeof vaulted === 'string' && vaulted.trim()) return vaulted.trim();
  } catch {
    /* vault unreachable — fall through to env */
  }
  const fromEnv = (env.RESEND_API_KEY ?? '').trim();
  return fromEnv || null;
}

/** Persist the Resend API key into the vault (only the vault holds it). Throws if vault isn't writable. */
export async function persistResendApiKey(key: string): Promise<void> {
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.set) throw new Error('secrets backend is not writable');
  await openBaoSecrets.set(RESEND_SECRET_KEY, key);
}

/** Remove the vaulted Resend API key (best-effort). Env fallback, if any, still applies. */
export async function removeResendApiKey(): Promise<void> {
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    if (openBaoSecrets.remove) await openBaoSecrets.remove(RESEND_SECRET_KEY);
  } catch {
    /* best-effort */
  }
}

// ─── config (PURE) ────────────────────────────────────────────────────────────────────────────────
export interface ResendConfig {
  /** Verified sender, e.g. "Off Grid <bot@mail.corp>" or "bot@mail.corp". */
  from: string;
}

export interface ResendConfigResult {
  ok: boolean;
  config?: ResendConfig;
  reason: string;
}

/**
 * Parse the Resend sink's non-secret config from env. PURE. Requires a From address (RESEND_FROM,
 * falling back to OFFGRID_SMTP_FROM so the two sinks can share a sender). The API key is resolved
 * separately (vault-first) — it is NOT read here, so config parsing stays free of secret handling.
 */
export function resendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ResendConfigResult {
  const from = (env.RESEND_FROM ?? env.OFFGRID_SMTP_FROM ?? '').trim();
  if (!from) {
    return {
      ok: false,
      reason: 'Resend sink not configured — set RESEND_FROM (a verified sender address) to enable.',
    };
  }
  return { ok: true, config: { from }, reason: 'ok' };
}

// ─── payload shaping (PURE) ─────────────────────────────────────────────────────────────────────
export interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  reply_to?: string;
  tags?: { name: string; value: string }[];
  attachments?: { filename: string; content: string }[]; // base64 content per Resend's API
}

export interface ResendShapeOptions {
  replyTo?: string;
  /** Free-form tags for Resend analytics; sanitized to the [A-Za-z0-9_-] Resend allows. */
  tags?: Record<string, string>;
  /** When true, a minimal HTML body is derived from the text (paragraphs) so rich clients render it. */
  html?: boolean;
}

/**
 * Shape our EmailMessage into the exact Resend /emails request body. PURE + deterministic.
 *
 * - `to` becomes an array (Resend accepts a list); a comma/semicolon-separated string is split.
 * - header-injection is neutralised on `from`/`subject`/`reply_to` (CR/LF stripped) — the same guard
 *   the SMTP MIME builder applies, so a run outcome can never inject a header.
 * - tags are sanitized to Resend's allowed charset (name+value: [A-Za-z0-9_-], truncated).
 * - attachments are base64-encoded (Resend takes `content` as base64) with the filename preserved.
 * - an optional derived HTML body escapes the text + wraps paragraphs (no raw HTML injection).
 */
export function buildResendPayload(
  from: string,
  msg: EmailMessage,
  opts: ResendShapeOptions = {},
): ResendPayload {
  const payload: ResendPayload = {
    from: sanitizeHeader(from),
    to: splitRecipients(msg.to),
    subject: sanitizeHeader(msg.subject),
    text: msg.text ?? '',
  };
  if (opts.replyTo && opts.replyTo.trim()) payload.reply_to = sanitizeHeader(opts.replyTo);
  if (opts.html) payload.html = textToHtml(msg.text ?? '');
  const tags = shapeTags(opts.tags);
  if (tags.length > 0) payload.tags = tags;
  const atts = msg.attachments ?? [];
  if (atts.length > 0) {
    payload.attachments = atts.map((a) => ({
      filename: sanitizeHeader(a.filename),
      content: Buffer.from(a.bytes).toString('base64'),
    }));
  }
  return payload;
}

// Split a recipient string ("a@x, b@y") or pass a single address through as a one-element list.
function splitRecipients(to: string): string[] {
  return (to ?? '')
    .split(/[;,]/)
    .map((s) => sanitizeHeader(s))
    .filter((s) => s.length > 0);
}

function sanitizeHeader(v: string): string {
  return (v ?? '').replace(/[\r\n]+/g, ' ').trim();
}

// Resend tag names/values must match [A-Za-z0-9_-]; sanitize + cap length, drop anything left empty.
function shapeTags(tags: Record<string, string> | undefined): { name: string; value: string }[] {
  if (!tags) return [];
  const out: { name: string; value: string }[] = [];
  for (const [rawName, rawValue] of Object.entries(tags)) {
    const name = sanitizeTagToken(rawName);
    const value = sanitizeTagToken(rawValue);
    if (name) out.push({ name, value });
  }
  return out;
}

function sanitizeTagToken(v: string): string {
  return (v ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

// Minimal, injection-safe text→HTML: escape entities, split on blank lines into <p>, <br> single NLs.
function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paras = esc.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`);
  return paras.join('\n');
}

// ─── result ───────────────────────────────────────────────────────────────────────────────────────
export interface SendEmailResult {
  ok: boolean;
  configured: boolean;
  reason: string;
  /** Resend's message id when the send succeeded (for the audit trail). */
  id?: string;
}

/** Is the Resend sink usable? Needs BOTH a From address AND a resolvable API key. */
export async function isResendSinkConfigured(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!resendConfigFromEnv(env).ok) return false;
  return (await resolveResendApiKey(env)) !== null;
}

// ─── send (I/O) — the thin fetch. Never throws; returns a typed result. ───────────────────────────
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Send via the Resend HTTP API. THIN — it shapes the payload (pure) and does the single fetch.
 * HONEST degrade: no From / no key → { configured:false } (never a fake success); no recipient →
 * a configured-but-refused result; a non-2xx Resend response → { ok:false } with the reason.
 *
 * GOVERNANCE NOTE: the PII-mask-before-send + egress-leash decisions are applied by the RUN PATH
 * before this is called (mirroring the SMTP sink + the model-call path), so the `msg` handed here is
 * already the masked, leash-approved body. This function performs no governance itself — it is the
 * pure-shape + wire step, exactly as the SMTP sendEmail is.
 */
export async function sendViaResend(
  msg: EmailMessage,
  opts: ResendShapeOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SendEmailResult> {
  const cfg = resendConfigFromEnv(env);
  if (!cfg.ok) return { ok: false, configured: false, reason: cfg.reason };
  const apiKey = await resolveResendApiKey(env);
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      reason: 'Resend sink not configured — no API key (vault resend_api_key or RESEND_API_KEY env).',
    };
  }
  if (!msg.to || !msg.to.trim()) {
    return { ok: false, configured: true, reason: 'no recipient — the email sink needs a `to` address' };
  }
  const payload = buildResendPayload(cfg.config!.from, msg, opts);
  try {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, configured: true, reason: `Resend send failed (${res.status}): ${extractError(bodyText)}` };
    }
    const id = extractId(bodyText);
    return { ok: true, configured: true, reason: `sent via Resend${id ? ` (id ${id})` : ''}`, id };
  } catch (e) {
    return { ok: false, configured: true, reason: `Resend send failed: ${(e as Error).message}` };
  }
}

function extractId(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { id?: unknown };
    return typeof j.id === 'string' ? j.id : undefined;
  } catch {
    return undefined;
  }
}

function extractError(body: string): string {
  try {
    const j = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof j.message === 'string') return j.message;
    if (typeof j.error === 'string') return j.error;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 200) || 'no response body';
}
