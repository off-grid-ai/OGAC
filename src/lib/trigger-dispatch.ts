// ─── Trigger dispatch (Builder Epic #103, Phase 4C) — PURE, zero-I/O ──────────────────────────────
//
// Every input trigger (webhook / email / whatsapp / schedule) is a DIFFERENT WAY to start the SAME
// governed app-run. The adapters (route handler, IMAP poller, whatsapp gateway) do the I/O; this
// module owns the PURE rules that sit between "a raw inbound payload arrived" and "call submitAppRun":
//
//   1. buildTriggerInput(kind, payload) — normalize a raw per-kind payload into the flat
//      Record<string, unknown> `input` that runApp/submitAppRun consume. No I/O, deterministic.
//   2. triggerAvailability(kind, env) — decide whether a trigger kind is AVAILABLE (fully wired),
//      COMING SOON (valid kind but gated on on-prem config that is absent), or requires config.
//      This is the AIR-GAP gate in pure form: email/whatsapp are `coming-soon` until their on-prem
//      endpoint env is present — never auto-enabled, never reaching for a cloud provider.
//   3. per-kind on-prem config parsers (imapConfigFromEnv / whatsappConfigFromEnv) — read ONLY the
//      org-configured on-prem endpoint env vars, validate shape, and refuse anything that is not an
//      explicit on-prem URL. These are pure (env in → parsed config out); the adapters call them.
//
// SOLID: this is the unit-testable brain. It REUSES triggers.ts for kind validity + webhook paths;
// it never re-implements those rules. It has zero imports that touch I/O.

import type { TriggerKind } from '@/lib/app-model';
import {
  COMING_SOON_TRIGGER_KINDS,
  isConfiguredKind,
  isTriggerKind,
} from '@/lib/triggers';

// ─── 1. buildTriggerInput — raw per-kind payload → flat app-run input ─────────────────────────────
// Each kind delivers its payload in a different shape. We flatten every one into a plain record the
// app's inputForm / steps can read. The convention: a single primary text field is exposed as
// `input` (what most single-step apps read), plus kind-specific structured fields so richer apps can
// use them. Unknown/oversized junk is dropped defensively — this input crosses into the governed
// pipeline, so it stays small and typed.

export interface WebhookPayload {
  // The webhook body is arbitrary JSON. We keep a primary text field if the caller supplied one
  // under a common key, and pass the whole body through as `body` for step access.
  [k: string]: unknown;
}

export interface EmailPayload {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  messageId?: string;
  date?: string;
}

export interface WhatsAppPayload {
  from?: string;
  text?: string;
  messageId?: string;
  timestamp?: string;
}

const MAX_TEXT = 100_000; // cap any single text field crossing into the pipeline

function clampText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) : v;
}

/**
 * Normalize a raw trigger payload into the flat `input` record submitAppRun consumes.
 * Deterministic and defensive: no I/O, drops non-serializable / oversized content.
 *
 * `input` (the primary text) is derived per kind so a simple single-field app "just works" from any
 * trigger; structured fields are carried alongside for richer apps.
 */
export function buildTriggerInput(
  kind: TriggerKind,
  payload: unknown,
): Record<string, unknown> {
  switch (kind) {
    case 'webhook':
      return buildWebhookInput(payload as WebhookPayload);
    case 'email':
      return buildEmailInput(payload as EmailPayload);
    case 'whatsapp':
      return buildWhatsAppInput(payload as WhatsAppPayload);
    case 'schedule':
      // A scheduled fire carries no external payload; the app-run input is whatever was configured
      // on the schedule (handled by app-schedules.ts). Here we normalize any passed object through.
      return isPlainObject(payload) ? { ...(payload as Record<string, unknown>) } : {};
    case 'on-demand':
    default:
      return isPlainObject(payload) ? { ...(payload as Record<string, unknown>) } : {};
  }
}

function buildWebhookInput(body: WebhookPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(body)) {
    // A bare string / non-object body still gets a usable `input`.
    return { input: clampText(body) };
  }
  // Primary text: honor a common set of keys so the same webhook works whether the sender uses
  // `input`, `text`, `message`, `prompt`, or `content`.
  const primary =
    firstString(body, ['input', 'text', 'message', 'prompt', 'content', 'query']) ?? '';
  out.input = clampText(primary);
  // Carry the full body through (bounded) so multi-field apps can read structured fields.
  out.body = sanitizeBody(body);
  return out;
}

function buildEmailInput(msg: EmailPayload): Record<string, unknown> {
  const m = isPlainObject(msg) ? msg : {};
  // Primary text = the email body; subject is exposed separately + prepended isn't done here (apps
  // choose). We give the raw fields; the `input` primary is the body text.
  return {
    input: clampText(m.text),
    subject: clampText(m.subject),
    from: clampText(m.from),
    to: clampText(m.to),
    messageId: clampText(m.messageId),
    date: clampText(m.date),
  };
}

function buildWhatsAppInput(msg: WhatsAppPayload): Record<string, unknown> {
  const m = isPlainObject(msg) ? msg : {};
  return {
    input: clampText(m.text),
    from: clampText(m.from),
    messageId: clampText(m.messageId),
    timestamp: clampText(m.timestamp),
  };
}

// Pass a webhook body through, dropping functions/undefined and clamping strings. One level of
// clamping on top-level string values keeps a huge payload from crossing into the pipeline.
function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'function' || v === undefined) continue;
    out[k] = typeof v === 'string' ? clampText(v) : v;
  }
  return out;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─── 2. triggerAvailability — the air-gap gate, in pure form ──────────────────────────────────────
export type TriggerAvailabilityState = 'available' | 'coming-soon' | 'unknown-kind';

export interface TriggerAvailability {
  kind: TriggerKind | string;
  state: TriggerAvailabilityState;
  /** True only when the trigger can actually fire right now (wired + any required config present). */
  enabled: boolean;
  /** Human-readable reason, safe to surface in the console. */
  reason: string;
}

/**
 * Decide whether a trigger kind is usable given the current environment. PURE (env passed in).
 *
 * - on-demand / webhook / schedule → always AVAILABLE + enabled (webhook is a real inbound route;
 *   schedule is app-schedules.ts; both are wired without cloud dependencies).
 * - email → AVAILABLE + enabled ONLY when the on-prem IMAP endpoint env is present and valid;
 *   otherwise COMING SOON (never auto-enabled — air-gap safety).
 * - whatsapp → AVAILABLE + enabled ONLY when the on-prem WhatsApp gateway URL env is present and
 *   valid; otherwise COMING SOON.
 */
export function triggerAvailability(
  kind: TriggerKind | string,
  env: NodeJS.ProcessEnv = process.env,
): TriggerAvailability {
  if (!isTriggerKind(kind)) {
    return { kind, state: 'unknown-kind', enabled: false, reason: `Unknown trigger kind: ${kind}` };
  }
  if (isConfiguredKind(kind)) {
    return { kind, state: 'available', enabled: true, reason: 'Wired end-to-end.' };
  }
  // The two on-prem-gated kinds.
  if (kind === 'email') {
    const cfg = imapConfigFromEnv(env);
    return cfg.ok
      ? { kind, state: 'available', enabled: true, reason: `On-prem IMAP configured (${cfg.config!.host}).` }
      : { kind, state: 'coming-soon', enabled: false, reason: cfg.reason };
  }
  if (kind === 'whatsapp') {
    const cfg = whatsappConfigFromEnv(env);
    return cfg.ok
      ? { kind, state: 'available', enabled: true, reason: `On-prem WhatsApp gateway configured (${cfg.config!.url}).` }
      : { kind, state: 'coming-soon', enabled: false, reason: cfg.reason };
  }
  // Any other coming-soon kind (future-proof).
  return {
    kind,
    state: 'coming-soon',
    enabled: false,
    reason: COMING_SOON_TRIGGER_KINDS.includes(kind)
      ? 'Requires on-prem configuration.'
      : 'Not yet wired.',
  };
}

// ─── 3. On-prem config parsers — read ONLY org-configured on-prem endpoints ───────────────────────
//
// AIR-GAP GUARANTEE: these refuse to produce a config unless the operator has EXPLICITLY set an
// on-prem endpoint. There is no default host, no fallback to a cloud provider. An empty / missing
// env → disabled. This is why email/whatsapp are `coming-soon` out of the box: nothing is assumed.

export interface ImapConfig {
  host: string; // host or host:port or a full imap(s):// URL, as the operator set it
  user: string;
  pass: string;
  mailbox: string; // folder to poll (default INBOX)
  tls: boolean;
}

export interface ImapConfigResult {
  ok: boolean;
  config?: ImapConfig;
  reason: string;
}

/**
 * Parse the on-prem IMAP poller config from env. PURE. Requires OFFGRID_EMAIL_IMAP_URL (+ user/pass).
 * The URL must be an explicit host the operator set — we do not invent one. Cloud provider hostnames
 * are NOT special-cased or blocked by name (that would be brittle); the guarantee is structural:
 * we connect ONLY to what the operator typed, and if they typed nothing the trigger stays disabled.
 */
export function imapConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ImapConfigResult {
  const raw = (env.OFFGRID_EMAIL_IMAP_URL ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      reason: 'Email trigger disabled — set OFFGRID_EMAIL_IMAP_URL to your on-prem IMAP server to enable.',
    };
  }
  const user = (env.OFFGRID_EMAIL_IMAP_USER ?? '').trim();
  const pass = env.OFFGRID_EMAIL_IMAP_PASS ?? '';
  if (!user || !pass) {
    return {
      ok: false,
      reason: 'Email trigger disabled — OFFGRID_EMAIL_IMAP_USER and OFFGRID_EMAIL_IMAP_PASS are required.',
    };
  }
  const parsed = parseImapUrl(raw);
  if (!parsed) {
    return {
      ok: false,
      reason: 'Email trigger disabled — OFFGRID_EMAIL_IMAP_URL is not a valid host or imap(s):// URL.',
    };
  }
  const mailbox = (env.OFFGRID_EMAIL_IMAP_MAILBOX ?? 'INBOX').trim() || 'INBOX';
  return { ok: true, config: { host: parsed.host, user, pass, mailbox, tls: parsed.tls }, reason: 'ok' };
}

// Accept either a bare host[:port] or a full imap://host / imaps://host URL. Returns the host
// (without scheme) + whether TLS was requested (imaps:// or default true). Rejects http(s)/other
// schemes so the config can't point at a random web endpoint.
function parseImapUrl(raw: string): { host: string; tls: boolean } | null {
  const val = raw.trim();
  if (!val) return null;
  if (val.includes('://')) {
    const scheme = val.slice(0, val.indexOf('://')).toLowerCase();
    if (scheme !== 'imap' && scheme !== 'imaps') return null;
    const rest = val.slice(val.indexOf('://') + 3).replace(/\/+$/, '');
    if (!rest || /\s/.test(rest)) return null;
    return { host: rest, tls: scheme === 'imaps' };
  }
  // Bare host[:port] — must look like a host, no spaces, no path.
  if (/\s/.test(val) || val.includes('/')) return null;
  return { host: val, tls: true }; // default to implicit TLS for a bare host
}

export interface WhatsAppConfig {
  url: string; // on-prem gateway base URL (http(s)://host…)
  token?: string; // optional bearer for the on-prem gateway
  number?: string; // the WhatsApp number/id this gateway serves
}

export interface WhatsAppConfigResult {
  ok: boolean;
  config?: WhatsAppConfig;
  reason: string;
}

/**
 * Parse the on-prem WhatsApp gateway config from env. PURE. Requires OFFGRID_WHATSAPP_URL — an
 * explicit on-prem gateway the operator runs. We do NOT talk to the Meta cloud API; the only WhatsApp
 * integration is via a self-hosted gateway the operator points us at. Missing URL → disabled.
 */
export function whatsappConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppConfigResult {
  const raw = (env.OFFGRID_WHATSAPP_URL ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        'WhatsApp trigger disabled — set OFFGRID_WHATSAPP_URL to your on-prem WhatsApp gateway to enable.',
    };
  }
  if (!isOnPremHttpUrl(raw)) {
    return {
      ok: false,
      reason: 'WhatsApp trigger disabled — OFFGRID_WHATSAPP_URL must be an http(s):// gateway URL.',
    };
  }
  const token = (env.OFFGRID_WHATSAPP_TOKEN ?? '').trim() || undefined;
  const number = (env.OFFGRID_WHATSAPP_NUMBER ?? '').trim() || undefined;
  return { ok: true, config: { url: raw.replace(/\/+$/, ''), token, number }, reason: 'ok' };
}

// A structurally valid http(s) URL (the operator's on-prem gateway). We accept any host they set —
// the air-gap guarantee is that we only reach the host THEY configured, never a hardcoded cloud one.
function isOnPremHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host;
  } catch {
    return false;
  }
}
