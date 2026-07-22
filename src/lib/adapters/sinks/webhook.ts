// ─── Generic outbound WEBHOOK sink — signed JSON POST to an operator-configured URL ───────────────
//
// The UNIVERSAL outbound primitive: POST a signed JSON payload to any URL the operator names on the
// output step (ServiceNow, Jira, an internal service, anything that accepts a webhook). It is a CLOUD
// transport (an arbitrary external endpoint), so the run path egress-leashes + PII-masks the body
// BEFORE this is called (same as Resend), and this sink adds message INTEGRITY: an HMAC-SHA256
// signature over the exact bytes, keyed by a VAULTED secret, so the receiver can verify the payload
// came from us and wasn't tampered with.
//
// SOLID: buildWebhookPayload + signWebhookBody are PURE + unit-tested (deterministic given a fixed
// timestamp + secret). This file's only I/O is the single fetch in postWebhook + the vaulted-secret
// resolve. HONEST degrade: no URL → { configured:false }; no signing secret → { configured:false }
// (we never POST an UNSIGNED payload — an unsigned webhook is a forgeable action, refused honestly).

import { createHmac } from 'node:crypto';

// ─── vaulted signing secret ───────────────────────────────────────────────────────────────────────
// The HMAC secret lives in OpenBao under one org-scoped key (mirrors the Resend key pattern). An env
// OFFGRID_WEBHOOK_SECRET is the bootstrap fallback so a fresh deploy can sign before anyone writes the
// vault. Resolve is best-effort: vault first, then env.
export const WEBHOOK_SECRET_KEY = 'org/webhook_secret';

/** Resolve the webhook HMAC secret: OpenBao (webhook_secret) first, then OFFGRID_WEBHOOK_SECRET env. */
export async function resolveWebhookSecret(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    const vaulted = await openBaoSecrets.get(WEBHOOK_SECRET_KEY);
    if (typeof vaulted === 'string' && vaulted.trim()) return vaulted.trim();
  } catch {
    /* vault unreachable — fall through to env */
  }
  const fromEnv = (env.OFFGRID_WEBHOOK_SECRET ?? '').trim();
  return fromEnv || null;
}

/** Persist the webhook signing secret into the vault (only the vault holds it). Throws if not writable. */
export async function persistWebhookSecret(secret: string): Promise<void> {
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.set) throw new Error('secrets backend is not writable');
  await openBaoSecrets.set(WEBHOOK_SECRET_KEY, secret);
}

/** Remove the vaulted webhook secret (best-effort). Env fallback, if any, still applies. */
export async function removeWebhookSecret(): Promise<void> {
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    if (openBaoSecrets.remove) await openBaoSecrets.remove(WEBHOOK_SECRET_KEY);
  } catch {
    /* best-effort */
  }
}

// ─── config (PURE) ───────────────────────────────────────────────────────────────────────────────
export interface WebhookConfig {
  /** The operator-configured destination URL (http(s)://…). */
  url: string;
  /** Optional event name the receiver switches on (defaults to 'offgrid.app_run'). */
  event?: string;
}

export interface WebhookConfigResult {
  ok: boolean;
  config?: WebhookConfig;
  reason: string;
}

/**
 * Parse the webhook sink config from the output step. PURE. Requires an http(s):// `url`. Any other
 * scheme (or a missing/blank url) → not configured, so the sink degrades honestly. The URL is the
 * operator's own choice — the air-gap guarantee is that we only ever POST to the host THEY set.
 */
export function webhookConfigFromStep(config: Record<string, unknown> | undefined): WebhookConfigResult {
  const url = typeof config?.url === 'string' ? config.url.trim() : '';
  if (!url) {
    return { ok: false, reason: 'Webhook sink not configured — set the destination URL on the output step.' };
  }
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, reason: 'Webhook sink not configured — the URL must be an http(s):// endpoint.' };
  }
  const event = typeof config?.event === 'string' && config.event.trim() ? config.event.trim() : undefined;
  return { ok: true, config: { url, event }, reason: 'ok' };
}

// ─── payload shaping (PURE) ─────────────────────────────────────────────────────────────────────
export interface WebhookPayload {
  event: string;
  /** ISO-8601 emission time — part of the signed bytes (replay window on the receiver). */
  sentAt: string;
  runId: string;
  orgId: string;
  appId: string;
  /** The governed run outcome (already egress-leashed + PII-masked by the run path). */
  outcome: string;
}

export interface WebhookPayloadInput {
  runId: string;
  orgId: string;
  appId: string;
  outcome: string;
  event?: string;
}

/**
 * Shape the canonical webhook JSON payload. PURE + deterministic given a fixed `sentAt`. The exact
 * serialization of THIS object is what gets signed + sent, so the receiver signs the same bytes.
 */
export function buildWebhookPayload(input: WebhookPayloadInput, sentAt: string): WebhookPayload {
  return {
    event: input.event?.trim() || 'offgrid.app_run',
    sentAt,
    runId: input.runId,
    orgId: input.orgId,
    appId: input.appId,
    outcome: input.outcome,
  };
}

/**
 * The exact request body bytes (canonical JSON). PURE — one place that decides serialization so the
 * signed bytes and the sent bytes are byte-identical.
 */
export function serializeWebhookBody(payload: WebhookPayload): string {
  return JSON.stringify(payload);
}

/** HMAC-SHA256 signature over the body bytes, hex-encoded. PURE. */
export function signWebhookBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// The signature header the receiver verifies (scheme-prefixed, like Stripe/GitHub conventions).
export const WEBHOOK_SIGNATURE_HEADER = 'x-offgrid-signature';
export function signatureHeaderValue(signature: string): string {
  return `sha256=${signature}`;
}

// ─── result ───────────────────────────────────────────────────────────────────────────────────────
export interface WebhookSendResult {
  ok: boolean;
  configured: boolean;
  reason: string;
  /** The HTTP status the endpoint returned (for the audit trail), when a request was made. */
  status?: number;
}

/** Is the webhook sink usable for this step? Needs BOTH a valid URL AND a resolvable signing secret. */
export async function isWebhookSinkConfigured(
  config: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!webhookConfigFromStep(config).ok) return false;
  return (await resolveWebhookSecret(env)) !== null;
}

// ─── send (I/O) — the thin fetch. Never throws; returns a typed result. ───────────────────────────
/**
 * POST the SIGNED JSON payload to the operator's URL. THIN — it shapes + signs (pure) then does the
 * single fetch. HONEST degrade: no URL / no secret → { configured:false } (never an unsigned/faked
 * send); a non-2xx response → { ok:false } with the status. We refuse to POST without a signature —
 * an unsigned webhook is a forgeable action.
 *
 * GOVERNANCE NOTE: the egress-leash + PII-mask-before-send decisions are applied by the RUN PATH
 * before this is called (via planSinkGovernance), so `input.outcome` is already the masked,
 * leash-approved body. This function performs no governance itself — it is the pure-shape + sign +
 * wire step, exactly as the Resend/SMTP sinks are.
 */
export async function postWebhook(
  config: Record<string, unknown> | undefined,
  input: WebhookPayloadInput,
  now: () => Date = () => new Date(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookSendResult> {
  const cfg = webhookConfigFromStep(config);
  if (!cfg.ok) return { ok: false, configured: false, reason: cfg.reason };
  const secret = await resolveWebhookSecret(env);
  if (!secret) {
    return {
      ok: false,
      configured: false,
      reason: 'Webhook sink not configured — no signing secret (vault webhook_secret or OFFGRID_WEBHOOK_SECRET env).',
    };
  }
  const payload = buildWebhookPayload({ ...input, event: cfg.config!.event }, now().toISOString());
  const body = serializeWebhookBody(payload);
  const signature = signWebhookBody(body, secret);
  try {
    const res = await fetchImpl(cfg.config!.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signatureHeaderValue(signature),
        'x-offgrid-event': payload.event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { ok: false, configured: true, status: res.status, reason: `webhook POST failed (${res.status})` };
    }
    return { ok: true, configured: true, status: res.status, reason: `delivered to webhook (${res.status})` };
  } catch (e) {
    return { ok: false, configured: true, reason: `webhook POST failed: ${(e as Error).message}` };
  }
}
