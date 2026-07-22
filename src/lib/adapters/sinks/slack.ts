// ─── SLACK output sink — post a message to a channel via a vaulted incoming-webhook URL ───────────
//
// Deliver an app-run's outcome to Slack. Slack "Incoming Webhooks" are the simplest governed path: a
// per-workspace secret URL that accepts a JSON `{ text }` POST and posts it to the channel the webhook
// was created for. It is a CLOUD transport (hooks.slack.com), so — exactly like Resend/webhook — the
// run path egress-leashes + PII-masks the body BEFORE this is called. The secret URL is VAULTED
// (org/slack_webhook_url in OpenBao) with an env fallback (SLACK_WEBHOOK_URL) for bootstrap.
//
// SOLID: buildSlackPayload is PURE + unit-tested (maps our message → Slack's request body, with an
// optional channel override + injection-safe text). This file's only I/O is the single fetch in
// postSlack + the vaulted-URL resolve. HONEST degrade: no webhook URL → { configured:false }; a
// non-ok Slack response → { ok:false } with the reason. Never a fake success.

// ─── vaulted incoming-webhook URL ─────────────────────────────────────────────────────────────────
// The full secret webhook URL lives in OpenBao under one org-scoped key (mirrors the Resend key
// pattern — only the vault holds the material). Env SLACK_WEBHOOK_URL is the bootstrap fallback.
export const SLACK_WEBHOOK_KEY = 'org/slack_webhook_url';

/** Resolve the Slack incoming-webhook URL: OpenBao (slack_webhook_url) first, then SLACK_WEBHOOK_URL. */
export async function resolveSlackWebhookUrl(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    const vaulted = await openBaoSecrets.get(SLACK_WEBHOOK_KEY);
    if (typeof vaulted === 'string' && vaulted.trim()) return vaulted.trim();
  } catch {
    /* vault unreachable — fall through to env */
  }
  const fromEnv = (env.SLACK_WEBHOOK_URL ?? '').trim();
  return fromEnv || null;
}

/** Persist the Slack webhook URL into the vault (only the vault holds it). Throws if not writable. */
export async function persistSlackWebhookUrl(url: string): Promise<void> {
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.set) throw new Error('secrets backend is not writable');
  await openBaoSecrets.set(SLACK_WEBHOOK_KEY, url);
}

/** Remove the vaulted Slack webhook URL (best-effort). Env fallback, if any, still applies. */
export async function removeSlackWebhookUrl(): Promise<void> {
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    if (openBaoSecrets.remove) await openBaoSecrets.remove(SLACK_WEBHOOK_KEY);
  } catch {
    /* best-effort */
  }
}

// ─── payload shaping (PURE) ─────────────────────────────────────────────────────────────────────
export interface SlackPayload {
  text: string;
  /** Optional channel override (e.g. "#ops-alerts") — the webhook's default channel is used if unset. */
  channel?: string;
  /** A display name for the bot post (fixed so a run outcome can't spoof another identity). */
  username: string;
}

export interface SlackMessageInput {
  text: string;
  /** Operator-set channel override on the output step config (optional). */
  channel?: string;
}

/**
 * Shape our message into Slack's incoming-webhook request body. PURE + deterministic.
 * - the bot username is FIXED ("Off Grid AI") — a run outcome cannot impersonate another sender.
 * - a channel override is passed through only when it names a real "#channel" or "@user" target;
 *   anything else is dropped (the webhook's default channel then applies) — no injection surface.
 */
export function buildSlackPayload(input: SlackMessageInput): SlackPayload {
  const payload: SlackPayload = { text: input.text ?? '', username: 'Off Grid AI' };
  const channel = (input.channel ?? '').trim();
  if (/^[#@][\w-]+$/.test(channel)) payload.channel = channel;
  return payload;
}

// ─── result ───────────────────────────────────────────────────────────────────────────────────────
export interface SlackSendResult {
  ok: boolean;
  configured: boolean;
  reason: string;
  status?: number;
}

/** Is the Slack sink usable? Needs a resolvable incoming-webhook URL. */
export async function isSlackSinkConfigured(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return (await resolveSlackWebhookUrl(env)) !== null;
}

// ─── send (I/O) — the thin fetch. Never throws; returns a typed result. ───────────────────────────
/**
 * POST the message to Slack's incoming-webhook URL. THIN — it shapes the payload (pure) + does the
 * single fetch. HONEST degrade: no webhook URL → { configured:false } (never a fake success); a
 * non-2xx Slack response → { ok:false } with the reason.
 *
 * GOVERNANCE NOTE: the egress-leash + PII-mask-before-send decisions are applied by the RUN PATH
 * before this is called (via planSinkGovernance), so `input.text` is already the masked,
 * leash-approved body. This function performs no governance itself — pure-shape + wire, like Resend.
 */
export async function postSlack(
  input: SlackMessageInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SlackSendResult> {
  const url = await resolveSlackWebhookUrl(env);
  if (!url) {
    return {
      ok: false,
      configured: false,
      reason: 'Slack sink not configured — no incoming-webhook URL (vault slack_webhook_url or SLACK_WEBHOOK_URL env).',
    };
  }
  if (!input.text?.trim()) {
    return { ok: false, configured: true, reason: 'no message — the Slack sink needs a non-empty body' };
  }
  const payload = buildSlackPayload(input);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const bodyText = await res.text().catch(() => '');
    // Slack returns 200 + "ok" on success; a non-200 (or an error body like "invalid_payload") fails.
    if (!res.ok || bodyText.trim().toLowerCase() !== 'ok') {
      return {
        ok: false,
        configured: true,
        status: res.status,
        reason: `Slack post failed (${res.status})${bodyText ? `: ${bodyText.slice(0, 120)}` : ''}`,
      };
    }
    return { ok: true, configured: true, status: res.status, reason: 'posted to Slack' };
  } catch (e) {
    return { ok: false, configured: true, reason: `Slack post failed: ${(e as Error).message}` };
  }
}
